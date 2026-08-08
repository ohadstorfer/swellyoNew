-- Operator Trips — staff & permissions, PHASE 2: invite links.
--
-- Spec: docs/specs/operator-trips/staff-and-permissions.md
--
-- ── PREREQUISITE ────────────────────────────────────────────────────────────
-- Run 20260807000000_operator_trip_staff.sql FIRST and let it commit.
-- (20260807000100 is independent of this file — either order is fine.)
--
-- ── Why a link and not a user search ───────────────────────────────────────
-- Decision (Ohad, 2026-08-07). An operator adding their guide needs to find
-- that guide. The two ways to do that are a search box or a link.
--
-- A search box means an endpoint that answers "does an account exist for this
-- name/email?" — account enumeration, on a table of real people's names,
-- countries and photos. Exact-match plus rate limiting narrows it but does not
-- close it.
--
-- A link closes it: nothing is queryable, the operator sends the link over
-- WhatsApp — which is how they already talk to their crew — and the recipient
-- identifies themselves by signing in. The server never has to answer a
-- question about who exists.
--
-- URL shape matches the invite links already shipped (see AppContent's
-- parseInviteFromUrl): https://swellyo-invite.netlify.app/?staff=<token>

-- ══════════════════════════════════════════════════════════════════
-- 1. The invites
-- ══════════════════════════════════════════════════════════════════
-- SINGLE USE. One link, one person, one tier. An operator adding two guides
-- makes two links.
--
-- The alternative — a reusable "join as Guide" link — is how a link ends up in
-- a group chat and four people become Guides. A Guide can read every traveler's
-- profile and emergency contact, so the blast radius of a leaked reusable link
-- is the whole roster. Single use makes a leaked link worth one seat, and the
-- operator can see it was taken.
create table if not exists public.organized_trip_staff_invites (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.group_trips(id) on delete cascade,
  operator_id  uuid not null references auth.users(id) on delete cascade,
  role_key     text not null check (role_key in ('listed','crew','guide','manager')),
  title        text,

  -- 64 hex chars from two v4 UUIDs. Not a uuid column: this is a bearer
  -- secret that travels in a URL, and 122 bits of a single uuid is a smaller
  -- haystack than it looks once a token is guessable-by-format.
  token        text not null unique
                 default replace(gen_random_uuid()::text, '-', '')
                      || replace(gen_random_uuid()::text, '-', ''),

  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  revoked_at   timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz
);

-- 'operator' is absent from the CHECK above on purpose. The operator of record
-- holds that tier by owning the trip (trip_staff_can()'s host_id branch), not
-- by having a row — so there is nothing to invite someone to. Offering it would
-- create a second, contradictory source of truth for who owns the trip.

create index if not exists otsi_by_trip on public.organized_trip_staff_invites (trip_id);
create unique index if not exists otsi_token on public.organized_trip_staff_invites (token);

alter table public.organized_trip_staff_invites enable row level security;

-- Only the operator of record, same rule as the staff table itself (I2).
-- Nobody reads this table by token through PostgREST — that is what the two
-- definer RPCs below are for, so an invite is never listable or guessable.
drop policy if exists otsi_operator_all on public.organized_trip_staff_invites;
create policy otsi_operator_all on public.organized_trip_staff_invites
  for all to authenticated
  using (
    exists (select 1 from public.group_trips t
             where t.id = organized_trip_staff_invites.trip_id and t.host_id = auth.uid())
  )
  with check (
    exists (select 1 from public.group_trips t
             where t.id = organized_trip_staff_invites.trip_id and t.host_id = auth.uid())
  );

grant select, insert, update, delete on public.organized_trip_staff_invites to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 2. Create — operator only
-- ══════════════════════════════════════════════════════════════════
create or replace function public.create_staff_invite(
  p_trip_id  uuid,
  p_role_key text,
  p_title    text default null
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

  insert into public.organized_trip_staff_invites (trip_id, operator_id, role_key, title)
  values (p_trip_id, auth.uid(), p_role_key, nullif(btrim(p_title), ''))
  returning token into v_token;

  return v_token;
end $$;

revoke execute on function public.create_staff_invite(uuid, text, text) from public, anon;
grant  execute on function public.create_staff_invite(uuid, text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. Peek — what the accept screen shows before you commit
-- ══════════════════════════════════════════════════════════════════
-- Callable by any signed-in user, because the recipient is by definition not on
-- the trip yet. It returns ONLY what the screen has to render: which trip, who
-- is asking, which tier. No roster, no traveler data, no money.
--
-- An invalid or spent token returns zero rows rather than an error, so this
-- cannot be used to tell "wrong token" from "already used".
create or replace function public.peek_staff_invite(p_token text)
returns table(
  trip_id     uuid,
  trip_title  text,
  role_key    text,
  role_label  text,
  title       text,
  operator_name text
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
         public.user_display_name(i.operator_id)
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

-- ══════════════════════════════════════════════════════════════════
-- 4. Accept
-- ══════════════════════════════════════════════════════════════════
-- The one place a staff row is created for a real account. Definer, because the
-- accepter is not the operator and organized_trip_staff's write policy is
-- operator-only — the privileged write happens here, behind these checks, and
-- nowhere else.
create or replace function public.accept_staff_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  i        record;
  v_uid    uuid := auth.uid();
  v_host   uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to accept this invite' using errcode = '42501';
  end if;

  -- FOR UPDATE: two taps on the same link race here otherwise, and single-use
  -- would quietly become double-use.
  select * into i
    from public.organized_trip_staff_invites
   where token = p_token
   for update;

  if i is null or i.revoked_at is not null or i.accepted_at is not null
     or i.expires_at <= now() then
    raise exception 'This invite is no longer valid' using errcode = 'P0002';
  end if;

  select host_id into v_host from public.group_trips where id = i.trip_id;

  if v_uid = v_host then
    raise exception 'You already run this trip' using errcode = '22023';
  end if;

  -- I3, checked here as well as in the trigger so the error is a sentence the
  -- app can show instead of a raised trigger message.
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
    (trip_id, user_id, operator_id, role_key, title, accepted_at)
  values
    (i.trip_id, v_uid, i.operator_id, i.role_key, i.title, now());

  update public.organized_trip_staff_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = i.id;

  return i.trip_id;
end $$;

revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. Verification — read-only
-- ══════════════════════════════════════════════════════════════════
--   select proname, pg_get_function_identity_arguments(oid) from pg_proc
--   where proname in ('create_staff_invite','peek_staff_invite','accept_staff_invite');
--   -- expect 3 rows
--
--   select has_function_privilege('anon','public.accept_staff_invite(text)','execute');
--   -- expect: false
