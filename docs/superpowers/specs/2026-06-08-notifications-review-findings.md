# Notifications — Adversarial Review Findings (2026-06-08)

Three "annoying senior dev" agents reviewed: (1) the implementation design spec, (2) the existing notification code, (3) notification leak-safety. Consolidated below.

---

## 0. Headline reality

- The notification system (`notifications` table + 11 Postgres triggers, migration `20260601010000`) is **~75% confirmed LIVE on prod** (migration dated after the CLI freeze; a follow-up migration `20260602120000` references real prod events; an SQL test harness exists). So "the new flow" is largely **already real code**, not just a design.
- There are **two physically separate planes**:
  - **Plane A — in-app feed**: triggers insert into `notifications`. **No push.** Gated by `trg_notifications_only_ohad` (drops every row not destined for ohad, in prod).
  - **Plane B — Expo push**: 5+ edge functions call Expo Push directly, wired to **DB webhooks** (not the triggers). **NOT gated at all.**
- The only-ohad gate covers Plane A only. **Plane B has zero gate.**

---

## 1. SAFETY — how a test could spam real users

| Leak path | Trigger | Who gets hit | Safe w/ ohad alone? |
|---|---|---|---|
| DM/group message | INSERT `messages` → webhook → `send-push-notification` | All convo members w/ token, except sender | Only if convo has no other real members |
| Group-trip join request | INSERT `group_trip_join_requests` → `send-trip-request-notification` | Trip host | Only if ohad is host (not requester) |
| **Surftrip join request** | INSERT `surftrip_join_requests` → `send-surftrip-request-notification` | **ALL hosts+admins** | **No** — fans out to every co-admin |
| Reaction | INSERT `message_reactions` → `send-reaction-notification` | Message author | Only if ohad reacts to his own msg |
| Trip/surftrip removal | client calls `send-*-removed-notification` | Removed user | Only if ohad is the removed one |
| **Hourly onboarding cron** | pg_cron `:00` → `notify-abandoned-onboarding` | **ALL unfinished users w/ token** | **No — fires on its own, independent of tests** |
| Manual blast | POST `notify-onboarding-blast` | Entire unfinished user base | **No — never call during testing** |
| Plane A feed (gate OFF) | the 11 triggers | All participants/admins | Only while gate ENABLED |

**Hard verdict:**
- The **existing SQL test** `supabase/tests/notifications_test.sql` is **SAFE**: wrapped in `BEGIN…ROLLBACK`, fires no pushes (push is webhook-wired to other tables; pg_net sends are rolled back too), and restores the gate atomically.
- The **only way to 100%-guarantee zero real-user notifications** while testing Plane B push code is to **not hit the network**: mocked `fetch`, OR a local stack with no real push tokens.
- The **hourly cron is an independent background leak** — no trip/convo isolation stops it. During any live-DB test window: `SELECT cron.unschedule('notify-abandoned-onboarding-hourly')` or confirm zero eligible candidates.

### No-leak checklist (before ANY live-DB notification test)
1. Expo send mocked, OR local stack with no real tokens.
2. `trg_notifications_only_ohad` ENABLED (`SELECT tgenabled FROM pg_trigger WHERE tgname='trg_notifications_only_ohad'` → `O`). Never disable outside a rolled-back txn.
3. Test trip/surftrip has ohad as sole host+participant.
4. Test convo has ohad as only member with a token.
5. Onboarding cron suspended or confirmed empty for the window.
6. ohad not sharing any convo with real users; not acting on real users' content.

---

## 2. REAL BUGS in existing code (regressions worth a test each)

- **B1 — `join_request_received` / `join_request_decided` / `gear_request_received` / `commitment_request_received` snapshots omit `trip_title`.** `renderNotification` falls back to the literal `"the trip"`. Users never see the real trip name. (`notification_center.sql` ~249,271; `notificationsService.ts:208,249`)
- **B2 — `personal_gear_updated` shows "Someone updated your gear".** `actor_id` is null by design and `data` has no `actor_name`, so the host is never named. (`notification_center.sql:148`)
- **B3 — `notificationsService.markAllRead` has no `recipient_id` filter** — relies entirely on RLS. Code smell; a service-role/misconfig would mark the whole table read. (`notificationsService.ts:113`)
- **B4 — mute check in `send-trip-request-notification` uses a fragile `metadata->>trip_id` filter**; if no linked conversation exists, the mute check is skipped and the host is always pushed. (`send-trip-request-notification` ~41)

---

## 3. DESIGN HOLES (fix in the spec before implementing the queue/dispatcher)

**Critical**
- **No row-locking** in the dispatcher → overlapping 1-min cron runs double-send. Needs `SELECT … FOR UPDATE SKIP LOCKED` + `pending→processing→sent/failed` state machine (the spec only has `pending/sent/skipped`).
- **Cron→edge-function auth unspecified** — dispatcher must not be publicly callable; needs a service-role JWT in the cron SQL (and a rotation story).
- **Quiet-hours timezone is load-bearing but undefined.** No TZ column, no default, no recompute when a user sets TZ later. UTC default silently breaks US users.

**High**
- **"Shadow" mode undefined** → if both paths send for real, every user gets doubles during rollout. Must be specified as "suppress sends in shadow."
- **Frequency cap is racy + ambiguous scope** (per-trip vs across-trips), and unclear whether urgent counts against it.
- **`dedup_key` needs a UNIQUE constraint** + defined on-conflict behavior, else it's just a label.
- **Batching window duration never defined.**
- **Dedup-vs-read race**: must treat null/uncommitted `notification_id` as "send anyway," not "already read."
- **Edge fn 150s timeout**: large batch + Expo latency → partial processing; needs the `processing` state to recover safely.

**Medium**
- "Back off after 2 ignored re-engagement pushes" needs **open-tracking** that doesn't exist yet.
- "A friend started a trip" — **"friend" is undefined** in the data model (no friend graph).
- `collapseId` is a **best-effort OS hint**, not a guarantee of "newest replaces older."
- Priority-0 bypassing quiet hours would **wake users at 2am for a trip cancellation** — tighten what justifies bypass.
- `~3/day across all trips` cap is **too low for multi-trip users** (drops legit T-1 reminders).
- `payload` jsonb holds **PII**; define retention/purge + log sanitization.
- Re-engagement cron scan has **no index/complexity budget**.

---

## 4. Recommended test strategy (given current tooling)

Tooling found: supabase CLI 2.90.0; **Docker NOT running** (no local stack right now); **no jest/deno** test infra; node 24.

- **Plane A (in-app triggers)** → extend `notifications_test.sql` (ROLLBACK-safe) with regression assertions for B1/B2 and recipient-exclusion correctness. Run against a **local stack** (needs Docker) or **prod inside the rolled-back txn** (needs DB creds; verified safe).
- **Plane B (push edge functions)** → mocked-`fetch` unit tests (zero network) to assert recipient fan-out + B4. Needs deno (install) or a node harness extracting the logic.
- **Never** run anything that lets pg_net actually send, and keep the onboarding cron suspended during any live-DB window.
