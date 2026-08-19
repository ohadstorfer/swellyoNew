-- Push priority for the two dispute types added in 20260820000300.
--
-- The function is rebuilt whole, never ALTERed — the CASE list below is the
-- LIVE list read off prod on 20 Aug (join_request_received through
-- gear_claimed) plus the two new lines. Do not trust an older migration file
-- for this list; live drifts ahead of the repo.
--
--   operator_charge_disputed → 0. The one dispute moment with a clock on it:
--     evidence is due in days, and quiet hours would spend up to 11 of those
--     hours saying nothing. Same reasoning as operator_document_rejected.
--   operator_dispute_closed  → 1. The outcome already happened; there is
--     nothing to act on at 3am.
--
-- NO notification_templates rows on purpose: the copy needs a dollar amount
-- and a due date, and fill() resolves neither {amount} nor {date} — the same
-- reason operator_stripe_action_needed and operator_requirement_overdue have
-- no rows. Push copy lives in dispatch-notification-queue/render.ts, which
-- therefore DOES need a deploy with this change (live matched the repo as of
-- the 20 Aug deploy).

create or replace function public.notification_push_priority(p_type notification_type, p_data jsonb)
returns smallint
language sql
immutable
as $$
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
    when 'trip_dates_changed'           then 1
    when 'trip_invite_received'         then 0
    when 'operator_staff_invited'       then 0
    when 'trip_invite_accepted'         then 0
    when 'trip_invite_declined'         then 1
    when 'operator_document_rejected'   then 0
    when 'operator_requirement_added'   then 1
    when 'operator_requirement_overdue' then 0
    when 'operator_requirement_overdue_operator' then 1
    when 'operator_stripe_ready'        then 1
    when 'operator_stripe_action_needed' then
      case when p_data->>'reason' in ('charges_disabled', 'blocked') then 0 else 1 end
    when 'operator_payment_stuck'       then 1
    when 'operator_charge_disputed'     then 0
    when 'operator_dispute_closed'      then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

-- CREATE OR REPLACE can re-add the PUBLIC execute grant. Restore the exact
-- pre-existing state: this function is only ever called by tg_enqueue_push,
-- which runs as the definer.
revoke execute on function public.notification_push_priority(notification_type, jsonb)
  from public, anon, authenticated;
grant  execute on function public.notification_push_priority(notification_type, jsonb)
  to service_role;
