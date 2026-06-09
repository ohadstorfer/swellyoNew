-- ============================================================================
-- Phase 1 new notification types + their triggers.
-- APPLY ORDER (filename order = apply order): 000000 → 000050 (this) → 000100 → 000300.
-- This file MUST run before 000100 (the mapping fn resolves these enum labels).
-- ============================================================================

-- New notification types for Phase 1.
alter type public.notification_type add value if not exists 'member_left';
alter type public.notification_type add value if not exists 'trip_cancelled';
alter type public.notification_type add value if not exists 'member_removed';

-- 5.2 trip_cancelled — host sets group_trips.status='cancelled'.
--   Recipients per plan: members + pending requesters, NOT the host.
create or replace function public.tg_notify_trip_cancelled()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if new.status = 'cancelled' and new.status is distinct from old.status then
    v_title := new.title;
    -- members (excluding host)
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', v_title)
    from public.group_trip_participants p
    where p.trip_id = new.id and p.user_id <> new.host_id;
    -- pending requesters (excluding anyone already a participant, and the host)
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select jr.requester_id, new.id, 'trip_cancelled', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', v_title)
    from public.group_trip_join_requests jr
    where jr.trip_id = new.id and jr.status = 'pending'
      and jr.requester_id <> new.host_id
      and not exists (select 1 from public.group_trip_participants p
                      where p.trip_id = new.id and p.user_id = jr.requester_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_cancelled on public.group_trips;
create trigger trg_trip_cancelled after update of status on public.group_trips
for each row execute function public.tg_notify_trip_cancelled();

-- 2.2 personal gear — host edits the SHARED personal-gear checklist
--   (group_trips.personal_gear_host_suggestion). Fan out to all members (not host).
--   Reuses the personal_gear_updated type (push P1).
create or replace function public.tg_notify_shared_personal_gear()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.personal_gear_host_suggestion is distinct from old.personal_gear_host_suggestion then
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select p.user_id, new.id, 'personal_gear_updated', 'user', new.host_id, 'group_trip', new.id,
           jsonb_build_object('trip_title', new.title)
    from public.group_trip_participants p
    where p.trip_id = new.id and p.user_id <> new.host_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_shared_personal_gear on public.group_trips;
create trigger trg_shared_personal_gear after update of personal_gear_host_suggestion on public.group_trips
for each row execute function public.tg_notify_shared_personal_gear();

-- 1.6 member_left — driven from the app (leaveTrip), since a DELETE on
--   group_trip_participants is indistinguishable from a host removal.
--   SECURITY DEFINER + caller check: only a current participant of p_trip_id may
--   announce their own departure; notifies the host.
--   entity_id = the leaver, so the enqueue dedup_key (recipient:type:entity) is
--   stable (a null entity_id would fall back to the unique feed-row id).
create or replace function public.fn_notify_member_left(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_title text; v_name text;
begin
  if not exists (
    select 1 from public.group_trip_participants
    where trip_id = p_trip_id and user_id = auth.uid()
  ) then
    raise exception 'not a participant of this trip';
  end if;
  select host_id, title into v_host, v_title from public.group_trips where id = p_trip_id;
  if v_host is null or v_host = auth.uid() then
    return;  -- host leaving is not a "member left" event
  end if;
  v_name := public.user_display_name(auth.uid());
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (v_host, p_trip_id, 'member_left', 'admin', auth.uid(), 'participant', auth.uid(),
          jsonb_build_object('actor_name', v_name, 'trip_title', v_title));
end $$;
revoke all on function public.fn_notify_member_left(uuid) from public;
grant execute on function public.fn_notify_member_left(uuid) to authenticated;
