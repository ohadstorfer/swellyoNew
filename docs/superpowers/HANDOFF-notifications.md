# HANDOFF — Group-Trip Notifications (Phases 1 & 2)

**Read this first, then the plans/specs it points to. This is the single source of truth for the current state.**
Date of handoff: 2026-06-09. Branch: `ohad`. Everything below is **uncommitted** (Ohad commits manually — do NOT `git commit`/`push` unless he asks).

---

## 0.5 LATEST STATE (2026-06-10 — read this first, supersedes anything below)

The system is **LIVE on prod** and verified end-to-end with real pushes. Current facts:

- **Live, no shadow, no gate.** All push types are **priority 0 (urgent)** — Ohad flattened priorities (`20260611000000_all_pushes_urgent.sql`, applied). SR1 batch / SR2 cap / SR3 quiet hours are **dormant** (dispatcher code intact; P1 branches never run). Restore the `20260610000050` mapping before opening trips to real users.
- **Verified working with real pushes:** join declined ✓, commit approved ✓, admin update ✓, trip_reminder week stage via the daily scan ✓ (scan cron was temporarily moved, reminder arrived, cron reverted to `7 6 * * *`). SR4 read_in_feed observed ✓. Timezone capture works (Ohad = America/Argentina/Buenos_Aires — he's in Argentina).
- **Bug found & fixed in testing:** double "Your packing list" pushes — legacy `trg_personal_gear` (on group_trip_participants.personal_gear_by_host) duplicated the new shared trigger AND self-notified members on their own checkbox toggles. **Dropped** (`20260611000100_drop_legacy_personal_gear_trigger.sql`, applied).
- **Legacy join-request webhook deleted** by Ohad (verified gone from pg_trigger). `send-trip-removed-notification` deployed with direct Expo send REMOVED — the queue is the sole sender for everything except chat/reactions.
- **Editable notification texts:** new `notification_templates` table (`20260611000200_notification_templates.sql` — ⚠️ **PENDING apply by Ohad**; everything falls back to hardcoded defaults until then). Dispatcher (deployed) + app bell renderer (`notificationsService.ts`) both read it with fallback. Editor UI: **`notification-texts-editor.html`** (project root) — edit texts → Copy SQL → paste/run. Push texts apply in ~1 min; bell texts on next app open.
- **Git:** Phases 1+2 committed & pushed to main (`d6155ab` → merge `1f00219`). **Uncommitted in tree:** the 3 new migrations (`20260611000000/000100/000200`), dispatcher template support (`render.ts`/`index.ts`), bell template support (`notificationsService.ts`), `notification-texts-editor.html`, testing-guide updates.
- **Testing guide:** `notifications-testing-guide.html` (live-mode expectations; Ohad+Eyal by name; Smart 2/4 marked OFF).
- **Tap deep-links (2026-06-10, uncommitted):** tapping a notification (push OR bell row) now opens the right trip AND lands on the right tab/section. Single mapping fn `tripFocusForNotification(type, data)` in `notificationsService.ts` → focus values `overview|commit|updates|gear|your-gear|requests|gear-requests|breakdown`. `TripDetailScreen` got `initialFocus` (switches to Plan, scrolls via onLayout-registered section Ys, auto-opens the gear-requests sheet; falls back to Overview when the viewer can't see Plan). Plumbing: AppContent `pendingTripFocus` → TripsScreen `initialTripFocus` → TripDetail; bell rows pass focus via `onOpenTrip(tripId, focus)`. Dispatcher now mirrors `stage`/`decision` into the push data payload (redeployed). Client code needs the dev app / next build.
- **Still open:** apply templates migration (one paste); app build/OTA so all users' timezones populate; Phase 3 (re-engagement, SR7 prefs UI); re-enable smart rules + re-audit trip-table membership before public launch.

---

## 0. TL;DR

We built a complete group-trip **notification system** in two phases, both **deployed to prod but running in SHADOW mode** (the push dispatcher renders + logs but sends nothing).

> ⚠️ **GATE DECISION (2026-06-09 eve):** the only-Ohad `BEFORE INSERT` gate **did not exist on prod** — no trigger, no function (verified via pg_trigger/pg_proc). Ohad then decided **no gate is needed at all**: group trips are invisible to real users, and a full audit of ALL trip tables found only Ohad, Eyal, and one push-token-less demo account as possible recipients. The prepared gate-v2 migration was deleted. **Ohad also decided to drop SHADOW and go live** (pushes to Ohad/Eyal phones only, by construction). Go-live executed 2026-06-09/10 — see §4.

- **Phase 1** = the push backbone (outbox queue + cron dispatcher + smart rules) + channel/event changes. **Applied + verified end-to-end.**
- **Phase 2** = date reminders/nudges + per-user local quiet hours (device timezone). **Applied + deployed; verified except the cron job + a live quiet-hours seed (Ohad applied those; agent couldn't re-query them).**

Source of truth for product decisions: `group-trip-notifications-plan.html` (the revised plan with CHANGED/DELETED/NEW markers + Section-5 smart-rule triage).

---

## 1. Architecture

```
Trip event (join/approve/gear/leave/cancel/reminder…)
  → Postgres trigger (or scan-trip-reminders edge fn) inserts a public.notifications row  ← THE BELL (feed), unchanged from before
       → BEFORE INSERT gate trg_notifications_only_ohad drops it unless recipient = Ohad   ← rollout safety
       → AFTER INSERT trigger tg_enqueue_push: if the type is "push-channel", insert a
         public.notification_queue row with priority + dedup_key + send_after               ← THE OUTBOX
pg_cron (every ~1 min) → dispatch-notification-queue edge fn:
   drains due rows, applies smart rules, sends to Expo (or, in SHADOW, just marks skipped:'shadow')
pg_cron (daily 06:07 UTC) → scan-trip-reminders edge fn: inserts trip_reminder/trip_ended feed rows
```

> ⚠️ **PRIORITIES FLATTENED (2026-06-10, Ohad's decision):** every push type now returns priority **0** (urgent) — see `supabase/migrations/20260611000000_all_pushes_urgent.sql`. Effect: SR1 batch, SR2 freq cap, SR3 quiet hours are **dormant** (dispatcher code untouched; its P1 branches just never run). Feed-only types (-1) unchanged. **Re-apply the mapping in `20260610000050` to restore polite behavior before opening trips to real users.** The smart-rule list below describes the system as designed, not current behavior.

**Smart rules (the "engine"), where each lives:**
- SR8 priority — `priority` col (0=urgent send-now / 1=normal). In the mapping fn `notification_push_priority`.
- SR4 dedup-vs-feed — dispatcher: if the linked feed row is already `read_at`, drop the push.
- SR6 mute — dispatcher: respects existing `conversation_members.preferences.muted_until`.
- SR5 collapse — dispatcher: Expo `collapseId = trip_id`.
- SR3 quiet hours — **enqueue time**, `next_quiet_window(tz)` (Postgres `AT TIME ZONE`, DST-safe): non-urgent `send_after` = recipient's next 8am local; null tz → next 8am UTC.
- SR1 batch — dispatcher: ≥2 non-urgent rows for same (recipient,trip) in a tick → one "N updates in {trip}" digest.
- SR2 freq cap — dispatcher: ≤3 non-urgent sent per recipient / 24h, else defer 6h.
- SR7 granular opt-out — **deferred to Phase 3** (needs a preferences UI).

Timezone approach was validated against Braze/OneSignal/SuprSend/Customer.io/Duolingo research: store **IANA string** (not offset), per-user precomputed `send_after` (industry "pattern C"), defer-not-drop quiet hours, **no** send-time-optimization ML at this scale. Device tz captured via `expo-localization` (`getCalendars()[0].timeZone`, NOT `Intl` — Hermes caches it) on boot + foreground.

---

## 2. Current state — what's applied / deployed / pending

| Artifact | State |
|---|---|
| **P1 migrations** `20260609000000` (queue), `000050` (cancel/gear triggers + member_left RPC + enum), `000100` (mapping fn + enqueue trigger), `000300` (dispatcher cron) | ✅ **Applied to prod** (SQL editor, ad-hoc, no migration-history rows) |
| **P2 migrations** `20260610000000` (tz col + enum), `000050` (next_quiet_window + quiet-hours enqueue + priorities) | ✅ **Applied** (verified: column + functions exist) |
| **P2 migration** `20260610000100` (scan cron) | ✅ **Applied + verified** (2026-06-09 eve: `scan-trip-reminders-daily` in `cron.job`, schedule `7 6 * * *`, active; first fire 06:07 UTC 2026-06-10) |
| Edge fn **`dispatch-notification-queue`** (new) | ✅ Deployed, **SHADOW** (`NOTIFICATIONS_QUEUE_SHADOW=true`) |
| Edge fn **`scan-trip-reminders`** (new) | ✅ Deployed, inert until the daily cron fires (06:07 UTC) |
| Edge fn **`send-trip-removed-notification`** (modified: adds `member_removed` feed row) | ❌ **NOT deployed** — but **diffed 2026-06-09 eve: live = repo MINUS the feed-insert block, zero live-only drift.** Repo file is deploy-ready as-is (Ohad's call when). |
| Client: `src/services/notifications/deviceTimezone.ts` + `AppContent.tsx` wiring + `notificationsService.ts` types/bell + `groupTripsService.leaveTrip` RPC call | ✅ Code in tree, **uncommitted**, ships with next app build/OTA (not a deploy) |
| `expo-localization@17.0.9` | ✅ Installed + plugin added to `app.json` |
| Git | ❌ **Nothing committed** (intentional) |

**Verified end-to-end (Phase 1):** seeded a `commitment_request_received` feed row for Ohad → it enqueued a P0 queue row → the cron dispatcher drained it → `status=skipped, skip_reason=shadow`. The whole chain works.

**Verified (Phase 2):** `surfers.timezone` column, `next_quiet_window()`, updated `notification_push_priority`/`tg_enqueue_push` all exist on prod; unit tests 9/9 pass; client type-checks clean (one pre-existing unrelated tsc error in AppContent re `OnboardingMatch`).

---

## 3. Hard constraints / gotchas (read before doing anything)

1. **SQL convention (updated 2026-06-09):** the "read-only MCP" mystery is solved — it was a **deny rule in `.claude/settings.local.json`** filtering `execute_sql`/`apply_migration` out of the tool list, not the server. Ohad removed it via `/permissions`, so both tools now reach the agent. **The convention still stands: migrations are applied BY HAND by Ohad in the SQL editor; the agent uses `execute_sql` for read-only verification SELECTs only** (cron checks, queue soak queries), never DDL/DML unless Ohad explicitly says otherwise. Never `supabase db push` (remote migration history is frozen at 20260528).
2. **Enum gotcha:** `ALTER TYPE … ADD VALUE` can't be used in the same transaction it's added. That's why migrations are split (enum/columns in one file, functions that use them in a later file) and **must be applied in filename order, as separate runs.**
3. **Feed gate:** NONE, deliberately (see GATE DECISION in §0). Safety comes from: trips invisible to real users + only devs/demo accounts in trip tables. Re-audit trip-table membership before opening the trips feature to real users.
4. **Shadow flag flip needs a redeploy:** `NOTIFICATIONS_QUEUE_SHADOW` is read into a module-level const at cold start; `supabase secrets set …=false` only takes effect after `supabase functions deploy dispatch-notification-queue`.
5. **Edge fns may be ahead of repo** — always download the live version + diff before deploying a *modified* existing function (esp. `send-trip-removed-notification`). New functions are safe to deploy directly.
6. **No "smoke tests" that fire real pushes/emails to real users.** Keep it in shadow + Ohad-only until launch.
   BUT (per Ohad 2026-06-09): **group trips are invisible to real users on prod** — only the devs can see them. So trip-level test actions (create/cancel trips, change dates via SQL, join/leave) are safe on any trip; no special "test trip" hygiene needed. The receiver-must-be-Ohad gate still applies.
7. **Ohad tests in Expo Go** — native-module code must be Expo-Go-safe. `expo-localization` is bundled in Expo Go, so `deviceTimezone.ts` works there.

---

## 4. Remaining work (launch sequence — none of this is done yet)

1. ~~Confirm the `scan-trip-reminders-daily` cron is scheduled~~ ✅ **DONE 2026-06-09 eve** — both crons active in `cron.job`; dispatcher 101/101 succeeded runs in the prior 2h, `net._http_response` overwhelmingly 200 (2 stray 401s in 2h, unattributed — keep an eye out).
2. Ship an app build/OTA so `surfers.timezone` starts populating (until then reminders fall back to next-8am-UTC). Verified 0/536 surfers have a tz yet.
3. **Soak** in shadow: inspect `notification_queue` rows for sane `status`/`skip_reason`/`send_after` (quiet hours), no stage duplicates, dedup working. **First pass 2026-06-09 eve: healthy** — 4 rows (`commitment_request_received` P0 + 3 `trip_reminder` P1), all `skipped` with reasons `shadow`/`batched` (SR1 batching observed working), no duplicate pending dedup_keys, `send_after` correct for null-tz daytime-UTC. Watch the first real scan run after 06:07 UTC 2026-06-10.
4. ~~Go live~~ ✅ **DONE 2026-06-09 eve**: `NOTIFICATIONS_QUEUE_SHADOW=false` set (by Ohad) + dispatcher redeployed (v5, serving 200s); `send-trip-removed-notification` deployed with direct Expo send REMOVED (queue = sole sender). ⚠️ STILL PENDING: **disable the legacy DB webhook for `send-trip-request-notification`** (dashboard, Ohad) — until then join requests double-push the host.
5. ~~Open to everyone~~ N/A — no gate exists (see §0 GATE DECISION). Before opening the trips feature itself to real users, re-audit who is in the trip tables.
6. **Phase 3 (future):** re-engagement RE1–RE4 + guardrails G1–G5, SR7 per-category preferences UI. Plus the one-line follow-up to enable 1.4 (`member_joined` push) — flip its `notification_push_priority` from `-1` to `1` once batching is proven.
7. **Commit** Phase 1 + Phase 2 when ready (Ohad does git manually).

---

## 5. File inventory

**Migrations** (`supabase/migrations/`): `20260609000000_notification_queue.sql`, `20260609000050_notification_new_event_triggers.sql`, `20260609000100_notification_push_mapping.sql`, `20260609000300_schedule_notification_dispatcher.sql`, `20260610000000_phase2_tz_enum.sql`, `20260610000050_phase2_quiethours_enqueue.sql`, `20260610000100_schedule_trip_reminders.sql`.
**Edge functions** (`supabase/functions/`): `dispatch-notification-queue/{index.ts,render.ts}`, `scan-trip-reminders/{index.ts,reminders.ts}`, modified `send-trip-removed-notification/index.ts`.
**Client** (`src/`): `services/notifications/{deviceTimezone.ts, notificationsService.ts}`, `services/trips/groupTripsService.ts` (`leaveTrip`), `components/AppContent.tsx` (tz boot/foreground hook).
**Tests**: `supabase/functions/*/__tests__/*.test.ts` (jest), `supabase/tests/notifications_phase1_queue.sql`, `supabase/tests/notifications_phase2.sql`.
**Docs**: spec `docs/superpowers/specs/2026-06-09-group-trip-notifications-revised-design.md`; plans `docs/superpowers/plans/2026-06-09-group-trip-notifications-phase1.md`, `…-phase2.md`, `…-phase1-APPLY-RUNBOOK.md`; product plan `group-trip-notifications-plan.html`.
**Memory**: `~/.claude/projects/-Users-ohadstorfer-swellyoNative/memory/project_notifications_push_queue_phase1.md` (+ `feedback_html_plan_source_of_truth.md`, `project_notifications_testing_safety.md`).

---

## 6. Conventions the next agent must follow

- The **HTML plan is the source of truth** for product decisions (channel push/feed, who gets it, priorities). Only ask Ohad when the HTML is genuinely silent.
- SQL is **applied by hand** by Ohad (paste into SQL editor, in order, separate runs). Agent can only verify via the 6 read MCP tools + `get_logs`.
- **Do not commit/push.** Ohad does git himself.
- Keep everything **shadow + Ohad-only** until Ohad explicitly says to launch.
