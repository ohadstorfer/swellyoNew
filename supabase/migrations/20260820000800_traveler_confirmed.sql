-- The operator is never told when a traveler actually gets on the trip.
--
-- On a peer trip, approving the join request IS the moment someone joins, and
-- the host did that themselves — so `tg_notify_member_joined` excluding the
-- host is right, and always was.
--
-- On an operator trip the two moments are weeks apart. Approval only creates a
-- row with `status='onboarding'`; the seat is not claimed until the traveler
-- pays the deposit, clears every must_have requirement, and
-- `activate_trip_membership` promotes them to 'active'. That promotion is the
-- operator's single most important roster event — it is when the money is
-- really theirs and the place is really gone — and nothing signalled it.
--
-- Verified on prod 2026-08-20: on El Salvador 26 the host has ZERO
-- `member_joined` rows. Every one went to the other travelers.
--
-- Note the asymmetry this closes: `operator_onboarding_stalled` already tells
-- the operator about travelers who DON'T finish. The success case was silent.
--
-- Deliberately extends the existing trigger rather than adding a second one on
-- the same table and event: two triggers reading the same "did this row just
-- become active" condition is two places for it to drift.

create or replace function public.tg_notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_host  uuid;
  v_title text;
  v_name  text;
  v_style char(1);
begin
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;

  select host_id, title, hosting_style
    into v_host, v_title, v_style
    from public.group_trips where id = new.trip_id;

  if new.user_id = v_host or new.role = 'host' then
    return new;
  end if;

  v_name := public.user_display_name(new.user_id);

  -- Unchanged: the other travelers, never the host.
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'member_joined', 'user',
         new.user_id, 'participant', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
  from public.group_trip_participants p
  where p.trip_id = new.trip_id
    and p.user_id <> new.user_id
    and p.user_id <> v_host
    and coalesce(p.role, 'member') = 'member'
    and p.status = 'active';

  -- New: the operator's own copy, and ONLY on an operator trip. A peer host
  -- would be told about something they did themselves a second earlier.
  --
  -- Recipient is `group_trips.host_id` alone, matching
  -- `operator_onboarding_stalled` — the operator of record, not every promoted
  -- co-host. audience 'admin' for the same reason that digest uses it.
  if v_style = 'C' and v_host is not null then
    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (
      v_host, new.trip_id, 'operator_traveler_confirmed', 'admin',
      new.user_id, 'participant', new.id,
      jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
    );
  end if;

  return new;
end
$$;

revoke execute on function public.tg_notify_member_joined() from public;
revoke execute on function public.tg_notify_member_joined() from anon;
revoke execute on function public.tg_notify_member_joined() from authenticated;

-- ---------------------------------------------------------------------------
-- Push priority.
--
-- ⚠️ REBUILT FROM `pg_get_functiondef` ON PROD (2026-08-20), NOT from any repo
-- migration. The live body has carried cases that exist in no repo file since
-- July; replacing it from a repo copy would silently drop them, and a type
-- missing from this list falls to `else -1` = feed only, so pushes just stop
-- with no error anywhere. Only the one new line below differs.
--
-- -1 is DELIBERATE for the new type, not the fallback catching it. One
-- confirmation per traveler means fifteen of them on a fifteen-person trip, and
-- the operator is not being asked to do anything — the trip filling up is the
-- news, not each individual step of it. The bell row is the right weight, and
-- `operator_onboarding_stalled` remains the only one that interrupts, because
-- that one IS a chore. Listing it explicitly rather than leaning on `else` is
-- the point: an unlisted type looks identical to a forgotten one.
-- ---------------------------------------------------------------------------
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
    when 'operator_traveler_confirmed'  then -1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

revoke execute on function public.notification_push_priority(notification_type, jsonb) from public;
revoke execute on function public.notification_push_priority(notification_type, jsonb) from anon;
revoke execute on function public.notification_push_priority(notification_type, jsonb) from authenticated;
