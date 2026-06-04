# Daily Deep Health Check — Design Spec

**Date:** 2026-06-03
**Author:** Ohad (+ Claude)
**Status:** Draft for review

## Goal

Proactively verify, on a schedule, that every core building block of Swellyo still works — **before** a real user (≈500 WAU) hits a broken flow. This is the "is the system alive?" layer. It is **separate** from Sentry, which reacts to real-user errors after they happen.

## Strategy: test dependencies, not paths

The 12 user paths (from the dependency map) share ~9 underlying building blocks. We test each **building block once** instead of writing 12 overlapping path tests. If a block is down, we know exactly which paths it takes with it.

| # | Building block | Covers paths |
|---|---|---|
| 1 | Supabase **DB** (read/write) | signup, boot, matching, onboarding, push |
| 2 | Supabase **Auth** (admin API) | sign in, boot |
| 3 | **Edge function platform** | swelly chat, matching, group trips, video |
| 4 | **OpenAI** | swelly chat, matching, group trips |
| 5 | **AWS S3** | profile video, DM media |
| 6 | Supabase **Storage** | DM media |
| 7 | Supabase **Realtime** | DMs |
| 8 | **Google Places / Geocoding** | maps picker |
| 9 | **Expo Push API** (reachability only) | DMs, push, group trips |

> Note: Google/Apple **OAuth** interactive sign-in cannot be fully tested headlessly. We test that Supabase Auth itself is up (block #2); the OAuth handshake is out of scope for the daily check.

## Architecture

```
┌──────────────┐   schedule + alert    ┌─────────────────────────┐
│ UptimeRobot  │ ───── pings ────────▶ │  Edge fn: health-check  │
│ (external)   │ ◀──── ok / fail ───── │  (Deno, runs all checks)│
└──────────────┘                       └─────────┬───────────────┘
       │                                          │ probes
       │ email + phone push on fail               ▼
       └──────────────▶ (you)         DB · Auth · OpenAI · S3 ·
                                       Storage · Realtime · Google · Expo
```

- **The brain** = one Supabase Edge Function `health-check` (Deno/TS). It runs every check in parallel and returns a JSON report + an HTTP status (200 if all critical checks pass, 503 if any fail).
- **The scheduler + alerter + external backstop** = **UptimeRobot** (free tier). It calls the function URL on a schedule. A keyword/HTTP-status monitor fires **email + phone push** when the response is not healthy.
  - Why UptimeRobot owns scheduling: it lives **outside** Supabase, so if all of Supabase is down (function included), it still detects "no healthy response" and alerts. This is the backstop the internal cron can't be.
- **Supabase pg_cron (optional, Phase 2):** a purely-internal daily invocation, only if we want a server-side run independent of UptimeRobot. Not required for v1 — UptimeRobot covers scheduling + alerting.

### Why not put alerting inside the function / pg_cron?
If the alert sender lives inside Supabase, a full Supabase outage kills the alerter too. Delegating "did I get a healthy response?" to an external pinger (UptimeRobot) is the only way to catch a total outage. So v1 leans on UptimeRobot for alerts; the function just reports status.

## The `health-check` Edge Function

### Response shape
```json
{
  "ok": true,
  "ranAt": "2026-06-03T08:00:00Z",
  "checks": [
    { "name": "supabase_db", "ok": true,  "ms": 42 },
    { "name": "openai",      "ok": false, "ms": 5000, "error": "timeout" }
  ]
}
```
- HTTP **200** when every *critical* check passes; **503** when any critical check fails.
- Body always contains the per-check breakdown for debugging.
- UptimeRobot alerts on: HTTP ≠ 200 **or** body missing `"ok":true`.

### Security
- The function requires a secret token (header `x-healthcheck-token` or `?token=`), stored as a Supabase Edge Function secret. Without it → 401.
- Prevents public abuse and stops anyone from POSTing fake "healthy" responses.

### The permanent test user
- A single, pre-created **demo health-check user** (`demo-healthcheck@swellyo.test` — `demo*` email auto-flags `is_demo_user = true` via DB trigger).
- Properties: `is_demo_user = true` (excluded from matching + analytics), `finished_onboarding = true` (**critical** — stops the hourly abandonment-reminder push cron from targeting it), **no `expo_push_token`** (belt-and-suspenders: no push can physically fire).
- Daily checks **read/write this existing user's rows** — they do **not** create or delete users. Creating+deleting a user every day is fragile (a failed delete silently accumulates junk).
- Created once via a one-time setup step (script or manual), documented in the plan.

## Checks — Phase 1 (build now: the "can't be down" core)

| Check | How | Pass criteria |
|---|---|---|
| `supabase_db` | `SELECT` the permanent health-check surfer row + a tiny write to a `health_check_log` row | row returned + write succeeds < 2s |
| `supabase_auth` | Auth admin API: fetch the permanent user by id | user returned |
| `edge_platform` | Implicit — the function running at all proves the platform is up | n/a (covered) |
| `openai` | Invoke `swelly-chat-demo` with a fixed tiny prompt | non-empty response < 8s |
| `aws_s3` | PUT a tiny object to a `healthcheck/` key, then DELETE it (or HEAD a known object) | 200 on both |

## Checks — Phase 2 (add after Phase 1 is proven)

| Check | How | Pass criteria |
|---|---|---|
| `supabase_storage` | Upload + delete a tiny file in a `healthcheck` bucket | both succeed |
| `realtime` | Subscribe to a channel, expect `SUBSCRIBED` | status within 5s |
| `google_geocode` | Geocode a fixed address (e.g. "Tel Aviv") | ≥1 result + key valid |
| `expo_push` | Reachability/validation only — **never send a real push** | API reachable / token format endpoint responds |

## Signup-creation test (separate, runs weekly — not daily)

Verifies the user-creation path itself, using **Option 3 (create directly as demo)**:

1. `auth.admin.createUser` with email `demo-signup-test-<ts>@swellyo.test`.
2. Insert `public.users` + `public.surfers` rows with `is_demo_user = true`, `finished_onboarding = true`, **no push token**.
3. Assert: surfer row exists, `is_demo_user` auto-flagged true, `age` computed from DOB by the age trigger.
4. **Delete** via `auth.admin.deleteUser(id)` (cascades clean child rows).

> Honest caveat: real signup builds the `public.users`/`surfers` rows from **client code** (`saveUser`), not an `auth.users` trigger. So this server-side test verifies "auth user creation + surfer DB triggers fire" — not the exact client signup flow. Documented as a known gap.

Runs weekly (not daily) because creation/deletion is the fragile, side-effect-prone part.

## Error handling

- Each check is wrapped in its own try/catch with a timeout; one failing check never aborts the others.
- A check that throws → `{ ok: false, error }` in the report, contributes to overall `ok: false`.
- Checks are tagged critical vs non-critical; only critical failures flip HTTP to 503 (so a flaky Google quota blip doesn't page you at 3am unless you want it to).

## Out of scope (YAGNI)

- Full Google/Apple OAuth interactive flow.
- Real push delivery to a device.
- pg_cron internal scheduling (Phase 2, optional).
- A custom dashboard — UptimeRobot's UI + the JSON response are enough at 500 WAU.
- Sentry Log Drains / paid infra alerting.

## Success criteria

- One deployed `health-check` Edge Function returning the JSON report + correct HTTP status.
- A permanent demo health-check user exists, correctly flagged and onboarding-complete.
- UptimeRobot monitor configured to ping it and alert via email + phone push on failure.
- Phase 1 checks pass against production; a deliberately broken dependency (e.g. bad OpenAI key) produces a 503 + alert.
