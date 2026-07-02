-- Remove the notifications testing gate + restore graded push priorities.
--
-- INCIDENT (found 2026-07-01): `trg_notifications_testing_gate` (BEFORE INSERT on
-- public.notifications, prod-only — it never had a repo migration) silently dropped
-- every notification row whose recipient wasn't ohad.storfer@gmail.com /
-- eyal@swellyo.com. Because tg_enqueue_push is AFTER INSERT on that same row, the
-- push died with the feed row — so ALL trip notifications (bell + push) were dead
-- for every real user. Verified: in the 30 days to 2026-07-01, exactly one user
-- (Eyal) received any notification row, while real users actively hosted trips and
-- sent join requests. Reported as "friend never saw my join request".
--
-- The gate was rollout safety from when group trips were invisible to real users
-- (HANDOFF-notifications.md §0). Trips have since been opened to real users; the
-- gate never came off. Removed 2026-07-01 per Ohad.
--
-- Also restores the GRADED push-priority mapping (20260610000050): the live
-- function was the flattened all-urgent test version (20260611000000), which made
-- every push bypass quiet hours. The handoff's documented precondition for opening
-- trips to real users is restoring this mapping — urgent types (requests,
-- approvals, cancellations) still send immediately; informational types
-- (member_committed, gear decided, admin updates, reminders) wait for the
-- recipient's 8am-21pm local window via next_quiet_window().
--
-- REFERENCE COPY — applied to prod 2026-07-01 via MCP execute_sql (never `db push`).

BEGIN;

DROP TRIGGER IF EXISTS trg_notifications_testing_gate ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_testing_gate();

-- Graded priorities (verbatim restore of 20260610000050's mapping):
--   0 = urgent, push immediately (bypasses quiet hours)
--   1 = normal, honors 8am-21pm local quiet hours (send_after = next_quiet_window)
--  -1 = feed-only, never pushes
CREATE OR REPLACE FUNCTION public.notification_push_priority(
  p_type public.notification_type, p_data jsonb
) RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
  select case p_type
    when 'join_request_received'        then 0
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end
    when 'commitment_request_received'  then 0
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end
    when 'member_committed'             then 1
    when 'gear_request_received'        then 0
    when 'gear_request_decided'         then 1
    when 'admin_update_posted'          then 1
    when 'group_gear_updated'           then 1
    when 'personal_gear_updated'        then 1
    when 'member_left'                  then 1
    when 'trip_cancelled'               then 0
    when 'member_removed'               then 0
    when 'trip_reminder'                then 1
    when 'trip_ended'                   then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

COMMIT;
