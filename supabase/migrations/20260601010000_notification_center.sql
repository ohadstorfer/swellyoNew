-- ============================================================================
-- Notification Center for group trips
-- Model: one row per recipient (fan-out on write), created by Postgres triggers.
-- All trigger/helper functions are SECURITY DEFINER with a pinned search_path
-- and fully-qualified table names (project gotcha: definer fns must do this).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enum: notification_type  (one value per requirement)
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.notification_type as enum (
    -- user-facing
    'member_joined',
    'member_committed',
    'gear_claimed',                 -- also relevant to admins (audience set per-row)
    'admin_update_posted',
    'group_gear_updated',
    'personal_gear_updated',
    'gear_request_decided',
    'commitment_decided',
    'join_request_decided',
    -- admin-facing (actionable)
    'join_request_received',
    'gear_request_received',
    'commitment_request_received'
  );
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Table: notifications
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,   -- who sees it
  trip_id      uuid references public.group_trips(id) on delete cascade,      -- trip context
  type         public.notification_type not null,
  audience     text not null default 'user' check (audience in ('user','admin')),
  actor_id     uuid references public.users(id) on delete set null,           -- who did it (null = system)
  entity_type  text,        -- source row kind: join_request | gear_request | commitment_request | gear_claim | admin_update | gear_item | participant
  entity_id    uuid,        -- id in that table (deep link + live status lookup)
  data         jsonb not null default '{}'::jsonb,                            -- frozen render snapshot
  read_at      timestamptz,                                                   -- null = unread (sole badge source)
  handled_at   timestamptz,                                                   -- card marked done/dismissed
  created_at   timestamptz not null default now()
);

-- Provenance: when a gear item is born from an approved gear request, record it.
-- Lets the group_gear_updated trigger skip the requester (who already gets a
-- gear_request_decided notice) so one approval = one notification for them.
alter table public.group_trip_gear_items
  add column if not exists source_gear_request_id uuid
    references public.group_trip_gear_requests(id) on delete set null;

-- Feed + badge indexes
create index if not exists idx_notifications_feed
  on public.notifications (recipient_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_entity
  on public.notifications (entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- 3. RLS — a user can read and (only) mark their own rows read/handled.
--    Inserts come from SECURITY DEFINER triggers, which bypass RLS.
-- ----------------------------------------------------------------------------
alter table public.notifications enable row level security;

revoke insert, update, delete on public.notifications from anon, authenticated;
grant  select on public.notifications to authenticated;
grant  update (read_at, handled_at) on public.notifications to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (recipient_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. Helper functions
-- ----------------------------------------------------------------------------

-- Display name for the snapshot (surfers.name, fallback users.email)
create or replace function public.user_display_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(s.name, u.email)
  from public.users u
  left join public.surfers s on s.user_id = u.id
  where u.id = p_user_id;
$$;

-- Admin recipients = host + co-admins (participants.role = 'admin').
-- NOTE: group_trip_participants currently only allows role in ('host','member')
-- (see 20260414000000) — there are NO co-admins in group trips today, so this
-- resolves to the host alone. The role='admin' branch is a forward-compat hook:
-- if a co-admin role is ever added (as surftrip_group_members already has), admin
-- notifications start reaching them automatically with no further change.
create or replace function public.trip_admin_ids(p_trip_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select array_agg(distinct uid)
  from (
    select host_id as uid from public.group_trips where id = p_trip_id
    union
    select user_id from public.group_trip_participants
      where trip_id = p_trip_id and role = 'admin'
  ) x
  where uid is not null;
$$;

-- ----------------------------------------------------------------------------
-- 5. Triggers (one per event). Each fans out one row per recipient.
--    "both"-audience events tag each row by the recipient's role.
-- ----------------------------------------------------------------------------

-- 5.1  member_joined  — someone joins; notify everyone else (skip the host's own seed row)
create or replace function public.tg_notify_member_joined()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_title text; v_name text;
begin
  select host_id, title into v_host, v_title from public.group_trips where id = new.trip_id;
  if new.user_id = v_host or new.role = 'host' then
    return new;  -- host creating the trip is not a "joined" event
  end if;
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'member_joined',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         new.user_id, 'participant', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
  from public.group_trip_participants p
  where p.trip_id = new.trip_id and p.user_id <> new.user_id;
  return new;
end $$;
drop trigger if exists trg_member_joined on public.group_trip_participants;
create trigger trg_member_joined after insert on public.group_trip_participants
for each row execute function public.tg_notify_member_joined();

-- 5.2  personal_gear_updated  — host edits one participant's personal gear; notify just them
create or replace function public.tg_notify_personal_gear()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  if new.personal_gear_by_host is distinct from old.personal_gear_by_host then
    select title into v_title from public.group_trips where id = new.trip_id;
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.user_id, new.trip_id, 'personal_gear_updated', 'user', null, 'participant', new.id,
            jsonb_build_object('trip_title', v_title));
  end if;
  return new;
end $$;
drop trigger if exists trg_personal_gear on public.group_trip_participants;
create trigger trg_personal_gear after update of personal_gear_by_host on public.group_trip_participants
for each row execute function public.tg_notify_personal_gear();

-- 5.3  gear_claimed  — "Johnny claimed 2 sunscreen"; notify everyone else (both audiences).
--   Fires on first claim (INSERT) and on quantity changes (UPSERT → UPDATE).
--   Skips no-op updates where the quantity didn't actually change. (quantity=0
--   is a DELETE in the app, which intentionally does not notify.)
create or replace function public.tg_notify_gear_claimed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_item text; v_host uuid; v_name text;
begin
  if tg_op = 'UPDATE' and new.quantity is not distinct from old.quantity then
    return new;
  end if;
  select gi.trip_id, gi.name into v_trip, v_item from public.group_trip_gear_items gi where gi.id = new.item_id;
  select host_id into v_host from public.group_trips where id = v_trip;
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, v_trip, 'gear_claimed',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         new.user_id, 'gear_claim', new.id,
         jsonb_build_object('actor_name', v_name, 'gear_name', v_item, 'qty', new.quantity)
  from public.group_trip_participants p
  where p.trip_id = v_trip and p.user_id <> new.user_id;
  return new;
end $$;
drop trigger if exists trg_gear_claimed on public.group_trip_gear_claims;
create trigger trg_gear_claimed after insert or update of quantity on public.group_trip_gear_claims
for each row execute function public.tg_notify_gear_claimed();

-- 5.4  admin_update_posted  — admin posts an update; notify all participants
create or replace function public.tg_notify_admin_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_host uuid; v_name text;
begin
  select title, host_id into v_title, v_host from public.group_trips where id = new.trip_id;
  v_name := public.user_display_name(new.author_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, new.trip_id, 'admin_update_posted',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         new.author_id, 'admin_update', new.id,
         jsonb_build_object('actor_name', v_name, 'trip_title', v_title, 'preview', left(new.body, 140))
  from public.group_trip_participants p
  where p.trip_id = new.trip_id and p.user_id <> new.author_id;
  return new;
end $$;
drop trigger if exists trg_admin_update on public.group_trip_admin_updates;
create trigger trg_admin_update after insert on public.group_trip_admin_updates
for each row execute function public.tg_notify_admin_update();

-- 5.5  group_gear_updated  — group gear list changes (add / edit name|qty / remove); notify participants.
--   * Only fires on a real change to name/needed_qty (ignores updated_at-only touches).
--   * If the item was created by approving a gear request, the requester is skipped
--     here (they get gear_request_decided) so one approval = one notification for them.
create or replace function public.tg_notify_group_gear()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_title text; v_host uuid; v_editor uuid; v_skip uuid;
begin
  -- Skip no-op updates (e.g. a touch that only bumps updated_at).
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.needed_qty is not distinct from old.needed_qty then
    return new;
  end if;

  v_trip   := coalesce(new.trip_id, old.trip_id);
  v_editor := coalesce(new.created_by, old.created_by);

  if tg_op = 'INSERT' and new.source_gear_request_id is not null then
    select requester_id into v_skip
    from public.group_trip_gear_requests where id = new.source_gear_request_id;
  end if;

  select title, host_id into v_title, v_host from public.group_trips where id = v_trip;
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select p.user_id, v_trip, 'group_gear_updated',
         case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
         v_editor, 'gear_item', coalesce(new.id, old.id),
         jsonb_build_object('trip_title', v_title)
  from public.group_trip_participants p
  where p.trip_id = v_trip
    and p.user_id <> coalesce(v_editor, '00000000-0000-0000-0000-000000000000'::uuid)
    and (v_skip is null or p.user_id <> v_skip);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_group_gear on public.group_trip_gear_items;
create trigger trg_group_gear after insert or delete or update of name, needed_qty on public.group_trip_gear_items
for each row execute function public.tg_notify_group_gear();

-- 5.6  join_request_received  — admin gets a join request (Approve / Deny / View profile)
create or replace function public.tg_notify_join_request_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.requester_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'join_request_received', 'admin', new.requester_id, 'join_request', new.id,
         jsonb_build_object('actor_name', v_name, 'note', new.request_note)
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.requester_id;
  return new;
end $$;
drop trigger if exists trg_join_request_received on public.group_trip_join_requests;
create trigger trg_join_request_received after insert on public.group_trip_join_requests
for each row execute function public.tg_notify_join_request_received();

-- 5.6b  join_request_decided  — requester is told approved/declined.
--   ('withdrawn' = the requester cancelling their own request → no notification.)
--   Note: on approval, a separate existing trigger inserts the participant row,
--   which fires member_joined for everyone ELSE; the requester gets this instead.
create or replace function public.tg_notify_join_request_decided()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.requester_id, new.trip_id, 'join_request_decided', 'user', new.reviewed_by, 'join_request', new.id,
            jsonb_build_object('decision', new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_join_request_decided on public.group_trip_join_requests;
create trigger trg_join_request_decided after update of status on public.group_trip_join_requests
for each row execute function public.tg_notify_join_request_decided();

-- 5.7  gear_request_received  — admin gets a gear request (View / set qty / Approve / Deny)
create or replace function public.tg_notify_gear_request_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.requester_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'gear_request_received', 'admin', new.requester_id, 'gear_request', new.id,
         jsonb_build_object('actor_name', v_name, 'item_name', new.item_name, 'note', new.note)
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.requester_id;
  return new;
end $$;
drop trigger if exists trg_gear_request_received on public.group_trip_gear_requests;
create trigger trg_gear_request_received after insert on public.group_trip_gear_requests
for each row execute function public.tg_notify_gear_request_received();

-- 5.8  gear_request_decided  — requester is told approved/denied
create or replace function public.tg_notify_gear_request_decided()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.requester_id, new.trip_id, 'gear_request_decided', 'user', new.reviewed_by, 'gear_request', new.id,
            jsonb_build_object('item_name', new.item_name, 'decision', new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_gear_request_decided on public.group_trip_gear_requests;
create trigger trg_gear_request_decided after update of status on public.group_trip_gear_requests
for each row execute function public.tg_notify_gear_request_decided();

-- 5.9  commitment_request_received  — admin gets a commitment request (Open chat)
create or replace function public.tg_notify_commitment_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := public.user_display_name(new.user_id);
  insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  select uid, new.trip_id, 'commitment_request_received', 'admin', new.user_id, 'commitment_request', new.id,
         jsonb_build_object('actor_name', v_name)
  from unnest(public.trip_admin_ids(new.trip_id)) as uid
  where uid <> new.user_id;
  return new;
end $$;
drop trigger if exists trg_commitment_received on public.group_trip_commitment_requests;
create trigger trg_commitment_received after insert on public.group_trip_commitment_requests
for each row execute function public.tg_notify_commitment_received();

-- 5.10  commitment_decided (+ member_committed broadcast on approval)
create or replace function public.tg_notify_commitment_decided()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_host uuid; v_name text; v_approved boolean;
begin
  if new.status is distinct from old.status
     and new.status in ('approved','declined') then

    -- tell the requester the outcome
    insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    values (new.user_id, new.trip_id, 'commitment_decided', 'user', new.decided_by, 'commitment_request', new.id,
            jsonb_build_object('decision', new.status));

    v_approved := new.status = 'approved';
    if v_approved then
      select title, host_id into v_title, v_host from public.group_trips where id = new.trip_id;
      v_name := public.user_display_name(new.user_id);
      -- broadcast "Johnny committed" to everyone else
      insert into public.notifications (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
      select p.user_id, new.trip_id, 'member_committed',
             case when p.user_id = v_host or p.role = 'admin' then 'admin' else 'user' end,
             new.user_id, 'commitment_request', new.id,
             jsonb_build_object('actor_name', v_name, 'trip_title', v_title)
      from public.group_trip_participants p
      where p.trip_id = new.trip_id and p.user_id <> new.user_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_commitment_decided on public.group_trip_commitment_requests;
create trigger trg_commitment_decided after update of status on public.group_trip_commitment_requests
for each row execute function public.tg_notify_commitment_decided();

-- ----------------------------------------------------------------------------
-- 6. Realtime: clients subscribe to their OWN notifications (INSERT + UPDATE).
--    REPLICA IDENTITY FULL so UPDATE payloads (read_at / handled_at) carry the
--    full row. The publication-exists guard keeps this safe on local/test DBs
--    where the supabase_realtime publication isn't present.
-- ----------------------------------------------------------------------------
alter table public.notifications replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     )
  then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7. ⚠️ TEMPORARY TESTING GATE — deliver ONLY to ohad.storfer@gmail.com.
--    The web app is live with real users; this single BEFORE INSERT gate drops
--    any notification whose recipient isn't Ohad, so all 11 triggers above are
--    covered at once without touching each one.
--
--    👉 REMOVE BEFORE GOING LIVE for everyone:
--       drop trigger if exists trg_notifications_only_ohad on public.notifications;
--       drop function if exists public.notifications_only_ohad();
-- ----------------------------------------------------------------------------
create or replace function public.notifications_only_ohad()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ohad uuid;
begin
  select id into v_ohad
  from public.users
  where lower(email) = 'ohad.storfer@gmail.com'
  limit 1;

  -- Anyone other than Ohad (or if that user is missing): skip the insert.
  if new.recipient_id is distinct from v_ohad then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists trg_notifications_only_ohad on public.notifications;
create trigger trg_notifications_only_ohad
  before insert on public.notifications
  for each row execute function public.notifications_only_ohad();

-- ============================================================================
-- End notification center
-- ============================================================================
