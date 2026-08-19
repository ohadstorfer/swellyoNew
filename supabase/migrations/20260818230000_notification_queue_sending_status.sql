-- 🚨 OUTAGE FIX — APPLY THIS FIRST, BEFORE ANYTHING ELSE IN THIS BATCH.
--
-- Push notifications have been completely dead since 2026-08-18 14:35 UTC.
-- Not degraded — dead. Every push, every type, every user.
--
-- ── What happened ───────────────────────────────────────────────────────────
-- `dispatch-notification-queue` was redeployed at 14:20:25 UTC (it had to be —
-- it carries the copy for the stalled-onboarding types). That version claims
-- rows before sending them:
--
--     .from("notification_queue").update({ status: "sending" }).in("id", allIds)
--
-- and the table's CHECK constraint permits only 'pending', 'sent' and
-- 'skipped'. So the claim raises 23514, the function returns 500 without
-- logging anything (that branch has no console.error), the row stays 'pending',
-- and the once-a-minute cron picks up the same row and does it again. Forever.
--
-- The queue held nothing until 14:35. The first row to arrive after the deploy
-- jammed the dispatcher, and every notification queued since has sat behind it:
-- a real join request to a real host on "Surf fun and love", unread and
-- unpushed for eight hours, plus everything queued behind it.
--
-- ── Why it was invisible ────────────────────────────────────────────────────
-- Three things had to line up, and did:
--   • the failing branch logs nothing, so the function logs show only
--     "booted" / "shutdown" and look healthy;
--   • pg_cron records the job as `succeeded` — it successfully made an HTTP
--     request; the 500 that came back is not its business;
--   • an empty queue returns 200, so the fault only appears once there is
--     something to deliver — the deploy itself looked fine for 15 minutes.
--
-- The only place the truth was written down is the HTTP status in
-- `function_edge_logs`, which nothing watches.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- Widen the constraint. 'sending' is a real state the dispatcher needs: it is
-- what stops an overlapping cron run from re-picking rows that are already in
-- flight and double-pushing them. The constraint is what is wrong here, not the
-- code — no migration ever added the value the code was written against.
--
-- Additive and non-destructive. Every existing row is 'pending', 'sent' or
-- 'skipped', so the new constraint validates against the whole table.

alter table public.notification_queue
  drop constraint if exists notification_queue_status_check;

alter table public.notification_queue
  add constraint notification_queue_status_check
  check (status = any (array['pending'::text, 'sending'::text, 'sent'::text, 'skipped'::text]));

comment on column public.notification_queue.status is
  'pending → sending → sent | skipped. "sending" is the in-flight claim: '
  'dispatch-notification-queue flips every drained row to it before contacting '
  'Expo, and the drain selects only "pending", so two overlapping runs cannot '
  'send the same push twice.';

-- ⚠️ FOLLOW-UP, not fixed here: nothing ever moves a row OUT of 'sending'
--    except the run that claimed it. If a run dies between the claim and the
--    terminal write — a timeout, a redeploy mid-flight — those rows are
--    stranded, because the drain only ever looks at 'pending'. That is the same
--    class of silence as the bug above: no error, no retry, no alarm, just a
--    push that never arrives. A sweep that returns 'sending' rows older than a
--    few minutes to 'pending' would close it.

-- To verify after applying (expect 0 rows, then a 200 within a minute):
--   select count(*) from notification_queue where status = 'pending'
--     and send_after <= now();
