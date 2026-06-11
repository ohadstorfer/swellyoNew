-- ============================================================================
-- ALL PUSHES URGENT (Ohad's decision, 2026-06-10)
--
-- Flattens the priority system: every push-channel notification now returns
-- priority 0 (urgent) instead of 1 (normal). Effect:
--   • sent immediately, always
--   • NO quiet hours (SR3), NO 3-per-day cap (SR2), NO batching (SR1)
-- Feed-only types (-1) are unchanged. The dispatcher code is untouched —
-- its cap/batch branches simply never run because no row has priority 1.
--
-- ⚠️ REVISIT BEFORE OPENING TRIPS TO REAL USERS: to restore polite behavior,
-- re-apply the previous mapping from 20260610000050_phase2_quiethours_enqueue.sql.
-- ============================================================================

create or replace function public.notification_push_priority(
  p_type public.notification_type, p_data jsonb
) returns smallint language sql immutable as $$
  select case p_type
    when 'join_request_received'        then 0
    when 'join_request_decided'         then 0   -- approved AND declined
    when 'commitment_request_received'  then 0
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end  -- declined stays feed-only
    when 'member_committed'             then 0
    when 'gear_request_received'        then 0
    when 'gear_request_decided'         then 0
    when 'admin_update_posted'          then 0
    when 'group_gear_updated'           then 0
    when 'personal_gear_updated'        then 0
    when 'member_left'                  then 0
    when 'trip_cancelled'               then 0
    when 'member_removed'               then 0
    when 'trip_reminder'                then 0
    when 'trip_ended'                   then 0
    -- feed only (no push), unchanged:
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

-- Release anything already waiting in the queue (old normal-priority rows):
update public.notification_queue
set priority = 0, send_after = now()
where status = 'pending';
