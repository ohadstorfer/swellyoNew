-- Operator Trips — push priority for the new notification types.
--
-- This is the ONE change here that touches a live code path: every notification
-- flows through notification_push_priority(). Only new `when` branches are
-- added before the existing `else -1`; no existing branch is touched.
--
--   0  = urgent push      1 = normal push      -1 = feed only, no push
--
-- Deliberately left at -1 (feed only):
--   operator_requirement_due_soon  — reminder cadence is not decided yet
--   operator_document_approved     — open question; approval gets the traveler
--                                    nothing, and a push per approved document
--                                    is ~60 pushes a trip
--
-- Copy for these types still has to be added to
-- dispatch-notification-queue/render.ts and notificationsService.ts. Until then
-- they render with fallback copy.

create or replace function public.notification_push_priority(p_type notification_type, p_data jsonb)
 returns smallint
 language sql
 immutable
as $function$
  select case p_type
    when 'join_request_received'        then 0      -- 1.1 host decision
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end  -- 1.2 / 1.3
    when 'commitment_request_received'  then 0      -- 2.7 host decision
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end -- 2.8 push / 2.9 feed-only
    when 'member_committed'             then 1      -- 2.8 momentum to others
    when 'gear_request_received'        then 0      -- 2.10 host decision
    when 'gear_request_decided'         then 1      -- 2.11
    when 'admin_update_posted'          then 1      -- 2.1
    when 'group_gear_updated'           then 1      -- 2.5
    when 'personal_gear_updated'        then 1      -- 2.2
    when 'member_left'                  then 1      -- 1.6
    when 'trip_cancelled'               then 0      -- 5.2
    when 'member_removed'               then 0      -- 5.3
    when 'trip_invite_received'         then 0      -- host invites you: urgent
    when 'trip_invite_accepted'         then 0      -- invitee accepted: urgent to host
    when 'trip_invite_declined'         then 1      -- invitee declined: normal to host
    -- operator trips:
    when 'operator_document_rejected'   then 0      -- creates work for the traveler
    when 'operator_requirement_added'   then 1      -- a new obligation after publish
    when 'operator_requirement_overdue' then 0      -- the traveler missed a deadline
    when 'operator_requirement_overdue_operator' then 1  -- the operator's own heads-up
    -- feed only in Phase 1:
    when 'member_joined'                then -1     -- 1.4 push is LATER (batched)
    when 'gear_claimed'                 then -1     -- 2.4 feed only
    else -1
  end::smallint;
$function$;

-- CREATE OR REPLACE can re-add the PUBLIC execute grant. Restore the EXACT
-- pre-existing state, verified live before this ran:
--   proacl = postgres=X/postgres | service_role=X/postgres
-- i.e. NOT authenticated, NOT anon, NOT PUBLIC. This function is only ever
-- called by the tg_enqueue_push trigger, which runs as the definer.
revoke execute on function public.notification_push_priority(notification_type, jsonb)
  from public, anon, authenticated;
grant  execute on function public.notification_push_priority(notification_type, jsonb)
  to service_role;
