-- Second half of operator_payment_landed — see 20260827000100 for the why.
--
-- `notification_push_priority` is rebuilt from the LIVE definition read on
-- 27 Aug 2026 (which already carries trip_dates_changed, the two dispute
-- types and operator_traveler_confirmed), plus one line. Priority 1: it is
-- news the traveler has been waiting three days for, so it pushes — but it
-- is good news with nothing to do, so it does not bypass quiet hours the way
-- a question (priority 0) does.
--
-- Deliberately NO notification_templates row: the copy carries the amount
-- ("Your $1,000 deposit arrived") and `fill()` in the dispatcher knows no
-- {amount} variable. A template row would win over the renderer and print
-- the placeholder literally. Same arrangement as operator_charge_disputed.

create or replace function public.notification_push_priority(
  p_type notification_type, p_data jsonb
) returns smallint
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
    when 'operator_payment_landed'      then 1
    when 'operator_charge_disputed'     then 0
    when 'operator_dispute_closed'      then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'operator_traveler_confirmed'  then -1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;
