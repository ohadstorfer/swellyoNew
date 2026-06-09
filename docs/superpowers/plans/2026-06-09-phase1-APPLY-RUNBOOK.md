# Phase 1 — Apply Runbook (for Ohad)

Everything code-side is built, reviewed, and (where possible) deployed. This is the
list of **manual steps only you can do** — applying SQL (MCP is read-only; we never
`db push`) and the one edge-function diff-deploy.

**Already done by Claude:**
- All migration files + the dispatcher edge function code created.
- `render.ts` jest unit tests pass (4/4); client edits type-check clean.
- New edge function **`dispatch-notification-queue` deployed via CLI in SHADOW mode** (secret `NOTIFICATIONS_QUEUE_SHADOW=true` set). It's live but inert — it sends nothing, and nothing invokes it until you apply the cron below. Auth gate verified (401 without the secret).

---

## Step 1 — Apply the SQL migrations IN THIS ORDER (SQL editor)

Order matters: `000100` references enum labels created in `000200`, and the enqueue
trigger writes to the table from `000000`.

1. `supabase/migrations/20260609000000_notification_queue.sql`  (queue table)
2. `supabase/migrations/20260609000050_notification_new_event_triggers.sql`  (enum values + cancelled/shared-gear triggers + member_left RPC)
3. `supabase/migrations/20260609000100_notification_push_mapping.sql`  (mapping fn + enqueue trigger)
4. `supabase/migrations/20260609000300_schedule_notification_dispatcher.sql`  (pg_cron, ~1 min)

Filename order now equals apply order (the triggers/enum file was renamed `000200`→`000050` so `000100` can't accidentally run first).

**Prereq (already true):** the Vault secret `admin_function_secret` exists (the onboarding cron uses it). Step 4 reuses it.

> ⚠️ `alter type ... add value` (in `000050`) — don't use the new enum values as data in the same transaction. Running the file as-is (CREATE only, no inserts) is fine; just don't wrap it together with a row insert that uses a new value.

## Step 2 — Run the regression tests

Open `supabase/tests/notifications_phase1_queue.sql`.
- Block **A** (mapping) is non-mutating — run as-is. Expect `NOTICE: A. ... all assertions passed`.
- Blocks **B** and **C** mutate — wrap each in `begin;` … `rollback;`. Expect the pass notices, then roll back.

## Step 3 — Confirm the cron drains in shadow

```sql
-- seed one push-channel feed row for yourself
insert into public.notifications (recipient_id, trip_id, type, audience, data)
select id, (select id from public.group_trips limit 1), 'commitment_request_received', 'admin', '{"actor_name":"Test"}'::jsonb
from public.users where lower(email)='ohad.storfer@gmail.com';
```
Wait ~70s, then:
```sql
select type, status, skip_reason, payload from public.notification_queue order by created_at desc limit 1;
```
Expect `status='skipped', skip_reason='shadow'` with a rendered `payload` — and **no phone alert** (shadow). That proves the whole chain (trigger → queue → cron → dispatcher → rules) works end-to-end without sending.

## Step 4 — Deploy the one modified edge function (you do this — live may be ahead of repo)

`supabase/functions/send-trip-removed-notification/index.ts` gained a `member_removed`
feed insert. **Download the live version, diff against the repo, merge, then deploy.**
(I did NOT CLI-deploy this one, to avoid clobbering any live-only changes.)

## Step 5 — The leaveTrip client change ships with the app

`src/services/trips/groupTripsService.ts` (`leaveTrip` → `fn_notify_member_left`) is a
JS change — it goes out with your next app build / OTA, not a deploy. No action now.

---

## Going live (later — Phase-1 Task 11, after a shadow soak)

1. Soak in shadow 1–2 days; query parity:
   ```sql
   select type, status, skip_reason, count(*) from public.notification_queue group by 1,2,3 order by 1;
   ```
2. Flip live: `supabase secrets set NOTIFICATIONS_QUEUE_SHADOW=false --project-ref rfdhtvcmagsbxqntnepv`, **then redeploy** `supabase functions deploy dispatch-notification-queue --project-ref rfdhtvcmagsbxqntnepv` — the SHADOW flag is read into a module-level constant at cold start, so the secret change only takes effect on redeploy. Seed a row → expect a real alert to your device + `status='sent'`.
3. Retire overlapping legacy push (avoid double-send):
   - Disable the DB webhook calling `send-trip-request-notification` (1.1 now flows via the queue).
   - Remove the direct Expo `fetch` in `send-trip-removed-notification` (keep only the feed insert) and redeploy.
   - Leave `send-push-notification` (chat) + `send-reaction-notification` alone — they stay on their own instant path.

## Still gated to you only

`trg_notifications_only_ohad` (feed gate) stays on. Because the enqueue trigger runs
AFTER that BEFORE-INSERT gate, the push queue is **automatically Ohad-only** too — no
separate push gate. Removing the gate to launch for everyone is a separate, deliberate step.
