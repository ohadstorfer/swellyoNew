-- Who this crew member IS, in the traveler's words: what they do, and a line
-- about them.
--
-- Spec: docs/specs/operator-trips/staff-and-permissions.md
--
-- ── Why this is not the tier ───────────────────────────────────────────────
-- The tier answers "what may they see" — a permission set, read by the
-- operator, invisible to everybody else. It says nothing a traveler cares
-- about: "Guide" is a permission level, and the person behind it is the
-- photographer, or the ISA instructor who has surfed this reef for nine years.
-- Travelers meet a person, not a permission.
--
-- So `title` (what they do — Instructor, Photographer, Driver) and `bio` (a
-- line for the trip page) are their own thing, asked as their own step of the
-- invite. `title` already existed as free text; `bio` is new.
--
-- ── Why it rides on the invite ─────────────────────────────────────────────
-- Same reason the paperwork does (20260813160000): there is no
-- organized_trip_staff row until the invite is accepted, and an operator who
-- has to come back after somebody accepts to write their blurb never does. The
-- invite carries it; accept_staff_invite copies it onto the staff row, which
-- stays the only thing the trip page reads.
--
-- The person can be edited afterwards by the operator — ots_write is host-only
-- for every command, so no policy changes here.

-- ══════════════════════════════════════════════════════════════════
-- 1. Columns
-- ══════════════════════════════════════════════════════════════════
alter table public.organized_trip_staff
  add column if not exists bio text;

alter table public.organized_trip_staff_invites
  add column if not exists bio text;

-- A blurb, not an essay. The trip page gives this three lines; anything longer
-- is either a CV or a paste accident, and both look broken there.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ots_bio_len') then
    alter table public.organized_trip_staff
      add constraint ots_bio_len check (coalesce(length(bio), 0) <= 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'otsi_bio_len') then
    alter table public.organized_trip_staff_invites
      add constraint otsi_bio_len check (coalesce(length(bio), 0) <= 400);
  end if;
end $$;

comment on column public.organized_trip_staff.bio is
  'One or two lines about this person, shown to travelers on the trip page under '
  'their name and title. Written by the operator, not by them — it is the '
  'operator introducing their crew.';

comment on column public.organized_trip_staff_invites.bio is
  'Carried from the invite onto the staff row by accept_staff_invite(). See the '
  'header of 20260813170000.';

-- ══════════════════════════════════════════════════════════════════
-- 2. Both invite paths take it
-- ══════════════════════════════════════════════════════════════════
-- Dropped and recreated rather than overloaded, for the reason spelled out in
-- 20260813160000: two resolvable signatures for one PostgREST call is not a
-- thing the client can choose between. Grants are re-issued because a dropped
-- function loses them and a recreated one comes back executable by PUBLIC.

drop function if exists public.create_staff_invite(uuid, text, text);
drop function if exists public.create_staff_invite(uuid, text, text, uuid[]);
drop function if exists public.create_staff_invite(uuid, text, text, uuid[], text);
create function public.create_staff_invite(
  p_trip_id         uuid,
  p_role_key        text,
  p_title           text default null,
  p_requirement_ids uuid[] default '{}'::uuid[],
  p_bio             text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text;
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can invite crew'
      using errcode = '42501';
  end if;

  if not public.staff_requirement_ids_ok(p_trip_id, p_requirement_ids) then
    raise exception 'Those requirements are not on this trip''s crew list'
      using errcode = '23514';
  end if;

  insert into public.organized_trip_staff_invites
    (trip_id, operator_id, role_key, title, requirement_ids, bio)
  values
    (p_trip_id, auth.uid(), p_role_key, nullif(btrim(p_title), ''),
     coalesce(p_requirement_ids, '{}'::uuid[]), nullif(btrim(p_bio), ''))
  returning token into v_token;

  return v_token;
end $$;

revoke execute on function public.create_staff_invite(uuid, text, text, uuid[], text) from public, anon;
grant  execute on function public.create_staff_invite(uuid, text, text, uuid[], text) to authenticated;

drop function if exists public.invite_staff_member(uuid, uuid, text, text);
drop function if exists public.invite_staff_member(uuid, uuid, text, text, uuid[]);
drop function if exists public.invite_staff_member(uuid, uuid, text, text, uuid[], text);
create function public.invite_staff_member(
  p_trip_id         uuid,
  p_user_id         uuid,
  p_role_key        text,
  p_title           text default null,
  p_requirement_ids uuid[] default '{}'::uuid[],
  p_bio             text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id         uuid;
  v_token      text;
  v_trip_title text;
  v_actor      text;
  v_role_label text;
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can invite crew'
      using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You already run this trip' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.group_trip_participants
     where trip_id = p_trip_id and user_id = p_user_id
  ) then
    raise exception 'They are a traveler on this trip, so they cannot also be crew'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.organized_trip_staff
     where trip_id = p_trip_id and user_id = p_user_id and revoked_at is null
  ) then
    raise exception 'They are already on this trip''s crew' using errcode = '23505';
  end if;

  if not public.staff_requirement_ids_ok(p_trip_id, p_requirement_ids) then
    raise exception 'Those requirements are not on this trip''s crew list'
      using errcode = '23514';
  end if;

  insert into public.organized_trip_staff_invites
    (trip_id, operator_id, role_key, title, invited_user_id, requirement_ids, bio)
  values
    (p_trip_id, auth.uid(), p_role_key, nullif(btrim(p_title), ''), p_user_id,
     coalesce(p_requirement_ids, '{}'::uuid[]), nullif(btrim(p_bio), ''))
  returning id, token into v_id, v_token;

  select g.title into v_trip_title from public.group_trips g where g.id = p_trip_id;
  select r.label into v_role_label
    from public.organized_trip_staff_roles r
   where r.role_key = p_role_key and r.operator_id is null;
  v_actor := public.user_display_name(auth.uid());

  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (
    p_user_id, p_trip_id, 'operator_staff_invited', 'user', auth.uid(),
    'organized_trip_staff_invite', v_id,
    jsonb_build_object(
      'trip_title',  v_trip_title,
      'role_key',    p_role_key,
      'role_label',  v_role_label,
      'actor_name',  v_actor,
      -- The bell reads {item} from item_name; it knows nothing about roles.
      'item_name',   v_role_label,
      -- The accept sheet takes a token. Safe here: notifications are RLS'd to
      -- their recipient, and accept_staff_invite additionally refuses anyone
      -- who is not invited_user_id.
      'staff_token', v_token
    )
  );

  return v_id;
end $$;

revoke execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[], text) from public, anon;
grant  execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[], text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. Accepting carries it onto the staff row
-- ══════════════════════════════════════════════════════════════════
-- Identical to 20260813160000's version but for `bio` in the insert.
create or replace function public.accept_staff_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  i          record;
  v_uid      uuid := auth.uid();
  v_host     uuid;
  v_staff_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to accept this invite' using errcode = '42501';
  end if;

  select * into i
    from public.organized_trip_staff_invites
   where token = p_token
   for update;

  if i is null or i.revoked_at is not null or i.accepted_at is not null
     or i.expires_at <= now() then
    raise exception 'This invite is no longer valid' using errcode = 'P0002';
  end if;

  -- An invite addressed to someone is only theirs.
  if i.invited_user_id is not null and i.invited_user_id <> v_uid then
    raise exception 'This invite is no longer valid' using errcode = 'P0002';
  end if;

  select host_id into v_host from public.group_trips where id = i.trip_id;

  if v_uid = v_host then
    raise exception 'You already run this trip' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.group_trip_participants
     where trip_id = i.trip_id and user_id = v_uid
  ) then
    raise exception 'You are a traveler on this trip, so you cannot also be crew'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.organized_trip_staff
     where trip_id = i.trip_id and user_id = v_uid and revoked_at is null
  ) then
    raise exception 'You are already on this trip''s crew' using errcode = '23505';
  end if;

  insert into public.organized_trip_staff
    (trip_id, user_id, operator_id, role_key, title, bio, accepted_at)
  values
    (i.trip_id, v_uid, i.operator_id, i.role_key, i.title, i.bio, now())
  returning id into v_staff_id;

  -- Re-checked rather than trusted from the invite: a requirement deleted in
  -- the meantime would fail the foreign key and take the whole acceptance down
  -- with it. A vanished ask is simply not made.
  insert into public.organized_trip_staff_requirements
    (staff_id, requirement_id, trip_id, assigned_by)
  select v_staff_id, r.id, i.trip_id, i.operator_id
    from public.organized_trip_requirements r
   where r.id = any (coalesce(i.requirement_ids, '{}'::uuid[]))
     and r.trip_id  = i.trip_id
     and r.audience = 'staff'
     and r.is_active
  on conflict (staff_id, requirement_id) do nothing;

  update public.organized_trip_staff_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = i.id;

  return i.trip_id;
end $$;

revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. The accept screen shows what they are being introduced as
-- ══════════════════════════════════════════════════════════════════
-- "Join as Guide" is the tier. "Join as Photographer — shooting the whole week
-- from the water" is what they were actually asked to be, and somebody deciding
-- whether to accept should read the second one.
drop function if exists public.peek_staff_invite(text);
create function public.peek_staff_invite(p_token text)
returns table(
  trip_id       uuid,
  trip_title    text,
  role_key      text,
  role_label    text,
  title         text,
  operator_name text,
  bio           text
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select i.trip_id,
         t.title,
         i.role_key,
         r.label,
         i.title,
         public.user_display_name(i.operator_id),
         i.bio
    from public.organized_trip_staff_invites i
    join public.group_trips t on t.id = i.trip_id
    left join public.organized_trip_staff_roles r
           on r.role_key = i.role_key and r.operator_id is null
   where i.token = p_token
     and i.revoked_at is null
     and i.accepted_at is null
     and i.expires_at > now();
$$;

revoke execute on function public.peek_staff_invite(text) from public, anon;
grant  execute on function public.peek_staff_invite(text) to authenticated;

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select proname, oidvectortypes(proargtypes) from pg_proc
--  where proname in ('create_staff_invite','invite_staff_member','peek_staff_invite');
--   -- one row each.
-- select column_name from information_schema.columns
--  where table_name = 'organized_trip_staff' and column_name = 'bio';
