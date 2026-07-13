-- ============================================================================
-- Trip invites: host invites a specific user to a group trip.
-- Depends on: notification_type enum values trip_invite_received /
-- trip_invite_accepted / trip_invite_declined (added in Task 1), and the
-- notifications table + user_display_name() helper (20260601010000).
-- ============================================================================

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_trips(id) on delete cascade,
  invited_user_id uuid not null references public.users(id) on delete cascade,
  invited_by uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (trip_id, invited_user_id)
);

alter table public.trip_invites enable row level security;

drop policy if exists trip_invites_host_select on public.trip_invites;
-- host (inviter) and invitee can see the invite
create policy trip_invites_host_select on public.trip_invites
  for select using (invited_by = auth.uid() or invited_user_id = auth.uid());

drop policy if exists trip_invites_host_insert on public.trip_invites;
create policy trip_invites_host_insert on public.trip_invites
  for insert with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.group_trips gt where gt.id = trip_id and gt.host_id = auth.uid()
    )
  );

drop policy if exists trip_invites_update on public.trip_invites;
-- host can update (re-invite/cancel) own-issued invites; invitee can update own row (accept/decline)
create policy trip_invites_update on public.trip_invites
  for update using (invited_by = auth.uid() or invited_user_id = auth.uid());

-- prevent smuggling in a trip/identity reassignment on update: RLS's implicit
-- WITH CHECK (reusing USING) only enforces "still touches auth.uid() somewhere",
-- not that trip_id/invited_by/invited_user_id are unchanged. Pin them immutable.
create or replace function public.tg_trip_invites_immutable_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.trip_id <> old.trip_id
     or new.invited_by <> old.invited_by
     or new.invited_user_id <> old.invited_user_id then
    raise exception 'trip_id, invited_by, and invited_user_id cannot be changed after invite creation';
  end if;
  return new;
end $$;

drop trigger if exists trg_trip_invites_immutable_identity on public.trip_invites;
create trigger trg_trip_invites_immutable_identity before update on public.trip_invites
for each row execute function public.tg_trip_invites_immutable_identity();

-- notify the invitee on new invite
create or replace function public.tg_notify_trip_invite_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_title text;
begin
  v_name := public.user_display_name(new.invited_by);
  select title into v_title from public.group_trips where id = new.trip_id;
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (new.invited_user_id, new.trip_id, 'trip_invite_received', 'user', new.invited_by, 'trip_invite', new.id,
          jsonb_build_object('actor_name', v_name, 'trip_title', v_title));
  return new;
end $$;

drop trigger if exists trg_trip_invite_received on public.trip_invites;
create trigger trg_trip_invite_received after insert on public.trip_invites
for each row when (new.status = 'pending')
execute function public.tg_notify_trip_invite_received();

-- notify the host when the invitee responds (accept/decline)
create or replace function public.tg_notify_trip_invite_decided()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_type public.notification_type;
begin
  if old.status = 'pending' and new.status = 'accepted' then
    v_type := 'trip_invite_accepted';
  elsif old.status = 'pending' and new.status = 'declined' then
    v_type := 'trip_invite_declined';
  else
    return new;
  end if;
  v_name := public.user_display_name(new.invited_user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (new.invited_by, new.trip_id, v_type, 'admin', new.invited_user_id, 'trip_invite', new.id,
          jsonb_build_object('actor_name', v_name));
  return new;
end $$;

drop trigger if exists trg_trip_invite_decided on public.trip_invites;
create trigger trg_trip_invite_decided after update on public.trip_invites
for each row execute function public.tg_notify_trip_invite_decided();

-- ============================================================================
-- Push priority mapping — full replacement of public.notification_push_priority.
-- Reproduces EVERY existing branch from 20260609000100_notification_push_mapping.sql
-- verbatim, plus the two new trip_invite_* branches.
--   returns -1 = feed only (no push) · 0 = urgent (send now) · 1 = normal (held)
-- ============================================================================
create or replace function public.notification_push_priority(
  p_type public.notification_type,
  p_data jsonb
) returns smallint
language sql immutable as $$
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
    -- feed only in Phase 1:
    when 'member_joined'                then -1     -- 1.4 push is LATER (batched)
    when 'gear_claimed'                 then -1     -- 2.4 feed only
    else -1
  end::smallint;
$$;
