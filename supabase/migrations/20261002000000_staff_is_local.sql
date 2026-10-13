-- Staff "local" flag — the operator marks a crew member as local to the area.
--
-- Ohad, 2 Oct 2026: "when the operator adds a staff member, they can select
-- that they are local, and that's how we know." The new trip overview (Figma
-- 17157:26127) shows a "Local Crew" count, and that count needs a real column.
--
-- WHAT THIS DOES
--   1. organized_trip_staff.is_local       — the flag itself, default false.
--   2. organized_trip_staff_invites.is_local — so it can be chosen at INVITE
--      time: an invited person has no staff row until they accept, so the
--      choice rides on the invite and accept_staff_invite copies it across
--      (the same way title, bio and requirement_ids already travel).
--   3. create_staff_invite / invite_staff_member gain `p_is_local boolean
--      default false`. A new parameter changes the signature, so each is
--      DROPPED and recreated (a CREATE OR REPLACE would leave the old
--      overload behind, and PostgREST would then refuse the call as
--      ambiguous). Recreating re-grants EXECUTE to PUBLIC, so both are
--      revoked from public/anon and granted back to authenticated — matching
--      today's ACL (postgres, authenticated, service_role).
--   4. accept_staff_invite copies i.is_local onto the new row. Same signature,
--      so CREATE OR REPLACE keeps its grants.
--   5. guard_staff_self_edit adds is_local to the columns a crew member may
--      NOT change on their own row. Without this, `ots_self_profile` would let
--      a guide mark themselves local. The operator path (staff.manage) is
--      unchanged and may write it.
--
-- Bodies below are the LIVE definitions read on 2 Oct 2026 (not the repo
-- copies — they drift), with only the is_local lines added.
--
-- Operator-side edits after the fact need no RPC: `ots_write` already lets
-- staff.manage UPDATE the row, and that is the path setStaffLocal() uses.

begin;

-- 1 + 2 ── the columns ──────────────────────────────────────────────────────
alter table public.organized_trip_staff
  add column if not exists is_local boolean not null default false;

alter table public.organized_trip_staff_invites
  add column if not exists is_local boolean not null default false;

comment on column public.organized_trip_staff.is_local is
  'Set by the operator: this crew member is local to the trip area. Drives the "Local Crew" count on the trip overview.';

-- 3a ── create_staff_invite (link invites) ──────────────────────────────────
drop function if exists public.create_staff_invite(uuid, text, text, uuid[], text);

create function public.create_staff_invite(
  p_trip_id uuid,
  p_role_key text,
  p_title text default null::text,
  p_requirement_ids uuid[] default '{}'::uuid[],
  p_bio text default null::text,
  p_is_local boolean default false
)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_token text;
  v_host  uuid;
begin
  select host_id into v_host
    from public.group_trips
   where id = p_trip_id and hosting_style = 'C';

  if v_host is null or not public.trip_staff_can(p_trip_id, 'staff.manage') then
    raise exception 'Only the operator of this trip can invite crew'
      using errcode = '42501';
  end if;

  if p_role_key = 'co_operator' and auth.uid() is distinct from v_host then
    raise exception 'Only the operator of record can invite a co-operator'
      using errcode = '42501';
  end if;

  if not public.staff_requirement_ids_ok(p_trip_id, p_requirement_ids) then
    raise exception 'Those requirements are not on this trip''s crew list'
      using errcode = '23514';
  end if;

  insert into public.organized_trip_staff_invites
    (trip_id, operator_id, role_key, title, requirement_ids, bio, is_local)
  values
    (p_trip_id, v_host, p_role_key, nullif(btrim(p_title), ''),
     coalesce(p_requirement_ids, '{}'::uuid[]), nullif(btrim(p_bio), ''),
     coalesce(p_is_local, false))
  returning token into v_token;

  return v_token;
end;
$function$;

revoke execute on function public.create_staff_invite(uuid, text, text, uuid[], text, boolean) from public, anon;
grant  execute on function public.create_staff_invite(uuid, text, text, uuid[], text, boolean) to authenticated, service_role;

-- 3b ── invite_staff_member (in-app invites) ────────────────────────────────
drop function if exists public.invite_staff_member(uuid, uuid, text, text, uuid[], text);

create function public.invite_staff_member(
  p_trip_id uuid,
  p_user_id uuid,
  p_role_key text,
  p_title text default null::text,
  p_requirement_ids uuid[] default '{}'::uuid[],
  p_bio text default null::text,
  p_is_local boolean default false
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_id         uuid;
  v_token      text;
  v_trip_title text;
  v_actor      text;
  v_role_label text;
  v_host       uuid;
begin
  select host_id into v_host
    from public.group_trips
   where id = p_trip_id and hosting_style = 'C';

  if v_host is null or not public.trip_staff_can(p_trip_id, 'staff.manage') then
    raise exception 'Only the operator of this trip can invite crew'
      using errcode = '42501';
  end if;

  if p_role_key = 'co_operator' and auth.uid() is distinct from v_host then
    raise exception 'Only the operator of record can invite a co-operator'
      using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You are already on this trip''s crew' using errcode = '22023';
  end if;

  -- The owner already holds every capability from host_id and needs no row.
  if p_user_id = v_host then
    raise exception 'They already run this trip' using errcode = '22023';
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
    (trip_id, operator_id, role_key, title, invited_user_id, requirement_ids, bio, is_local)
  values
    (p_trip_id, v_host, p_role_key, nullif(btrim(p_title), ''), p_user_id,
     coalesce(p_requirement_ids, '{}'::uuid[]), nullif(btrim(p_bio), ''),
     coalesce(p_is_local, false))
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
      'item_name',   v_role_label,
      'staff_token', v_token
    )
  );

  return v_id;
end;
$function$;

revoke execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[], text, boolean) from public, anon;
grant  execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[], text, boolean) to authenticated, service_role;

-- 4 ── accept_staff_invite carries is_local onto the staff row ──────────────
create or replace function public.accept_staff_invite(p_token text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
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
    (trip_id, user_id, operator_id, role_key, title, bio, accepted_at, is_local)
  values
    (i.trip_id, v_uid, i.operator_id, i.role_key, i.title, i.bio, now(),
     coalesce(i.is_local, false))
  returning id into v_staff_id;

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
end $function$;

-- 5 ── a crew member may not mark THEMSELVES local ───────────────────────────
create or replace function public.guard_staff_self_edit()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  -- No JWT: the service role, a cron job, or a migration.
  if auth.uid() is null then
    return new;
  end if;

  -- Whoever manages the crew may write the whole row, exactly as before: the
  -- operator of record (granted from group_trips.host_id inside trip_staff_can
  -- itself) and any co-operator they appointed.
  if public.trip_staff_can(new.trip_id, 'staff.manage') then
    return new;
  end if;

  -- Everyone else reaching an UPDATE is here through ots_self_profile below, so
  -- they are editing their own row. Two fields, and `updated_at`, which the
  -- touch trigger writes for them. `is_local` is the operator's call, not theirs.
  if new.id           is distinct from old.id
     or new.trip_id      is distinct from old.trip_id
     or new.user_id      is distinct from old.user_id
     or new.operator_id  is distinct from old.operator_id
     or new.role_key     is distinct from old.role_key
     or new.display_name is distinct from old.display_name
     or new.photo_url    is distinct from old.photo_url
     or new.invited_at   is distinct from old.invited_at
     or new.accepted_at  is distinct from old.accepted_at
     or new.revoked_at   is distinct from old.revoked_at
     or new.created_at   is distinct from old.created_at
     or new.is_local     is distinct from old.is_local then
    raise exception
      'You can change your own title and bio on this trip. Everything else is the operator''s.'
      using errcode = '42501';
  end if;

  return new;
end $function$;

commit;
