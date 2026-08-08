-- Operator Trips — staff & permissions, PHASE 0 (schema only).
--
-- Spec: docs/specs/operator-trips/staff-and-permissions.md
--
-- ── What this migration does, and what it deliberately does NOT do ──────────
-- It creates the two tables and the one gate function that Phase 1 will route
-- every existing operator-trip permission check through. It changes NO existing
-- policy, NO existing function, and NO existing behaviour. Nothing in the app
-- reads any of this yet.
--
-- That is on purpose: the permission sets are not decided yet (Ohad + Eyal,
-- 2026-08-07), so this lands the shape now and lets the actual permissions be
-- edited later with an UPDATE instead of a migration plus an app release.
--
-- ── The one idea ───────────────────────────────────────────────────────────
-- Permissions are DATA, not code. Every check goes through one function,
-- trip_staff_can(trip_id, capability). If a check is written anywhere else,
-- permissions stop being editable and the whole design is pointless.
--
-- ── Why trip_staff_can() also answers for normal group trips ────────────────
-- is_trip_host() is shared. 14 RLS policies on gear, join requests, admin
-- updates and commitments use it, and those tables serve BOTH operator trips
-- (hosting_style = 'C') and ordinary social group trips. So the function falls
-- back to is_trip_host() whenever the trip is not an operator trip. Phase 1 can
-- then rewrite those 14 policies mechanically with zero behaviour change on
-- group trips, instead of maintaining two parallel sets of policies.
--
-- ── The invariant that makes editable money permissions safe ────────────────
-- 20260803000000 §C3 moved money off is_trip_host() and onto group_trips
-- .host_id, because "flat multi-host" is an untrusted set for money. Making
-- capabilities editable could undo that — an operator could tick money.manage
-- for a Manager.
--
-- It cannot, because 'staff.manage' is hard-locked to host_id (section 5): only
-- the operator of record may write organized_trip_staff or the role sets. A
-- Manager can never grant anything, least of all to themselves. No
-- self-escalation, so C3 survives.

-- ══════════════════════════════════════════════════════════════════
-- 1. The permission sets
-- ══════════════════════════════════════════════════════════════════
-- operator_id is nullable and that is the whole point:
--   NULL         -> the global default set, the rows seeded below
--   non-NULL     -> that one operator's own version of the same tier
-- Phase 0 and Phase 1 only ever write global rows. The column costs nothing now
-- and means per-operator permission sets (Phase 3) need no migration.
--
-- `tier` is for SORTING IN THE UI ONLY. Never write a permission check as
-- `tier >= 4`. The sets happen to be nested today; the permissions are not
-- decided yet and the nesting will break the first time a Guide needs medical.
create table if not exists public.organized_trip_staff_roles (
  id            uuid primary key default gen_random_uuid(),
  role_key      text not null check (role_key in
                  ('listed','crew','guide','manager','operator')),
  operator_id   uuid references auth.users(id) on delete cascade,
  tier          smallint not null check (tier between 1 and 5),
  label         text not null,
  blurb         text,
  capabilities  text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per (tier, operator). Two partial indexes because NULL never equals
-- NULL in a unique constraint, so the global rows need their own.
create unique index if not exists otsr_global_role_key
  on public.organized_trip_staff_roles (role_key) where operator_id is null;
create unique index if not exists otsr_operator_role_key
  on public.organized_trip_staff_roles (role_key, operator_id) where operator_id is not null;

-- ── The 5 global tiers, straight from the agreed matrix ─────────────────────
-- Capability keys are STABLE STRINGS. Once a key is here it is never renamed.
--
-- The image bundled some of these on one display line ("Edit trip / approve
-- docs", "Remove traveler / export data"). They are split here, because they
-- are different powers and should be separately grantable. The UI can still
-- draw them grouped.
--
-- The 'operator' row is mostly documentation — section 3 grants the operator of
-- record everything from the function itself, not from this row — but the UI
-- needs it to draw the full permission matrix.
insert into public.organized_trip_staff_roles (role_key, operator_id, tier, label, blurb, capabilities)
values
  ('listed',  null, 1, 'Listed',
   'A credit, no login. Shown to travelers only.',
   array[
     'profile.shown_to_travelers'
   ]),

  ('crew',    null, 2, 'Crew',
   'Present but silent. Sees roster + profiles, no chat.',
   array[
     'profile.shown_to_travelers',
     'roster.view',
     'travelers.view_profiles'
   ]),

  ('guide',   null, 3, 'Guide',
   'Active crew. Adds chat, updates, stats.',
   array[
     'profile.shown_to_travelers',
     'roster.view',
     'travelers.view_profiles',
     'travelers.view_stats',
     'chat.participate'
   ]),

  ('manager', null, 4, 'Manager',
   'Runs the trip. Docs, medical, sees money.',
   array[
     'profile.shown_to_travelers',
     'roster.view',
     'travelers.view_profiles',
     'travelers.view_stats',
     'chat.participate',
     'payments.view_status',
     'docs.view',
     'medical.view',
     'trip.edit',
     'docs.approve',
     'travelers.remove',
     'data.export'
   ]),

  ('operator', null, 5, 'Operator',
   'Owner. Everything — money, staff, cancel.',
   array[
     'profile.shown_to_travelers',
     'roster.view',
     'travelers.view_profiles',
     'travelers.view_stats',
     'chat.participate',
     'payments.view_status',
     'docs.view',
     'medical.view',
     'trip.edit',
     'docs.approve',
     'travelers.remove',
     'data.export',
     'money.manage',
     'staff.manage',
     'trip.cancel'
   ])
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 2. The staff themselves
-- ══════════════════════════════════════════════════════════════════
-- NOT group_trip_participants. That table means TRAVELER everywhere: the
-- capacity trigger counts its rows, payment rows point at it, requirements
-- attach to it. 20260724000400:250 already has a hand-written exclusion for
-- host rows that "are NOT travelers". Put 5 staff in there and every traveler
-- count, every payment total and every export goes wrong.
--
-- user_id is NULLABLE on purpose. A Tier 1 "Listed" person is a CREDIT, not an
-- account — a name and a photo shown to travelers, with nobody to log in as.
-- Such a row can never grant access: trip_staff_can() joins on
-- user_id = auth.uid(), which never matches NULL.
--
-- operator_id is denormalised from the trip's host_id at insert time, so that
-- "my saved team across trips" (Phase 3) is a `select distinct` over rows that
-- already exist — no migration, no backfill. That is the only reason it exists.
create table if not exists public.organized_trip_staff (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.group_trips(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  operator_id   uuid not null references auth.users(id) on delete cascade,
  role_key      text not null check (role_key in
                  ('listed','crew','guide','manager','operator')),
  display_name  text,
  photo_url     text,
  title         text,
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A row with no account must carry its own name, or it is invisible.
  constraint ots_listed_needs_name
    check (user_id is not null or display_name is not null)
);

-- One live row per person per trip. Revoked rows stay for history, so the index
-- is partial on both counts.
create unique index if not exists ots_one_live_row_per_user
  on public.organized_trip_staff (trip_id, user_id)
  where user_id is not null and revoked_at is null;

create index if not exists ots_by_trip     on public.organized_trip_staff (trip_id);
create index if not exists ots_by_user     on public.organized_trip_staff (user_id) where user_id is not null;
create index if not exists ots_by_operator on public.organized_trip_staff (operator_id);

-- ══════════════════════════════════════════════════════════════════
-- 3. THE GATE — the only place a staff permission is ever decided
-- ══════════════════════════════════════════════════════════════════
-- security definer so it can read organized_trip_staff regardless of that
-- table's own RLS (section 5), which is what stops a policy that calls this
-- function from recursing into itself.
--
-- Branch order matters:
--   1. not an operator trip -> is_trip_host(), i.e. exactly today's behaviour.
--      This is what lets Phase 1 rewrite the 14 shared policies safely.
--   2. operator of record   -> everything, always, from here and not from a
--      row. INVARIANT I1: no config mistake can lock an owner out of their own
--      trip, and no row needs to exist for them.
--   3. otherwise            -> look up their tier's capability set, preferring
--      this operator's own version of the tier over the global default.
create or replace function public.trip_staff_can(p_trip_id uuid, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    when not exists (
      select 1 from public.group_trips
      where id = p_trip_id and hosting_style = 'C'
    ) then public.is_trip_host(p_trip_id)

    when exists (
      select 1 from public.group_trips
      where id = p_trip_id and host_id = auth.uid()
    ) then true

    else exists (
      select 1
      from public.organized_trip_staff s
      join lateral (
        select r.capabilities
        from public.organized_trip_staff_roles r
        where r.role_key = s.role_key
          and (r.operator_id = s.operator_id or r.operator_id is null)
        order by r.operator_id nulls last
        limit 1
      ) r on true
      where s.trip_id = p_trip_id
        and s.user_id = auth.uid()
        and s.accepted_at is not null
        and s.revoked_at is null
        and p_cap = any(r.capabilities)
    )
  end;
$$;

-- 20260803000000 §"SECDEF EXECUTE hardening": a new function without an
-- explicit grant is callable by anon through PostgREST. Never omit this pair.
revoke execute on function public.trip_staff_can(uuid, text) from public, anon;
grant  execute on function public.trip_staff_can(uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. What the CLIENT asks — one round trip, cached with react-query
-- ══════════════════════════════════════════════════════════════════
-- THIS ARRAY IS UX ONLY. It exists so the app can hide buttons. It is NOT a
-- permission check. Every capability must ALSO be enforced by RLS or an RPC
-- check, or a Crew who never opens the app can call PostgREST directly and read
-- passports. Phase 1 is what makes that true.
create or replace function public.my_trip_capabilities(p_trip_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    -- Ordinary group trip: a host behaves as the top tier, everyone else has
    -- nothing. Keeps the client on one code path for both trip kinds.
    when not exists (
      select 1 from public.group_trips
      where id = p_trip_id and hosting_style = 'C'
    ) then case
      when public.is_trip_host(p_trip_id) then (
        select capabilities from public.organized_trip_staff_roles
        where role_key = 'operator' and operator_id is null
      )
      else '{}'::text[]
    end

    when exists (
      select 1 from public.group_trips
      where id = p_trip_id and host_id = auth.uid()
    ) then (
      select capabilities from public.organized_trip_staff_roles
      where role_key = 'operator' and operator_id is null
    )

    else coalesce((
      select r.capabilities
      from public.organized_trip_staff s
      join lateral (
        select r2.capabilities
        from public.organized_trip_staff_roles r2
        where r2.role_key = s.role_key
          and (r2.operator_id = s.operator_id or r2.operator_id is null)
        order by r2.operator_id nulls last
        limit 1
      ) r on true
      where s.trip_id = p_trip_id
        and s.user_id = auth.uid()
        and s.accepted_at is not null
        and s.revoked_at is null
      limit 1
    ), '{}'::text[])
  end;
$$;

revoke execute on function public.my_trip_capabilities(uuid) from public, anon;
grant  execute on function public.my_trip_capabilities(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. RLS — I2: only the operator of record writes staff
-- ══════════════════════════════════════════════════════════════════
-- This is the invariant the whole "editable permissions" idea rests on. See the
-- header. 'staff.manage' is NOT read from a capability set here — it is
-- hard-locked to group_trips.host_id, so no editable row can ever hand out the
-- power to hand out power.
alter table public.organized_trip_staff       enable row level security;
alter table public.organized_trip_staff_roles enable row level security;

-- Read: anyone on the trip, plus the person themselves, plus the owner.
-- Deliberately does NOT call trip_staff_can() — it would be correct (the
-- function is security definer and bypasses this policy) but a policy that
-- reads its own table through a function is a trap for the next person.
drop policy if exists ots_select on public.organized_trip_staff;
create policy ots_select on public.organized_trip_staff
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_participant(trip_id)
    or exists (
      select 1 from public.group_trips t
      where t.id = organized_trip_staff.trip_id and t.host_id = auth.uid()
    )
  );

-- Write: operator of record only. All four verbs, one rule.
drop policy if exists ots_write on public.organized_trip_staff;
create policy ots_write on public.organized_trip_staff
  for all to authenticated
  using (
    exists (
      select 1 from public.group_trips t
      where t.id = organized_trip_staff.trip_id and t.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.group_trips t
      where t.id = organized_trip_staff.trip_id and t.host_id = auth.uid()
    )
  );

-- The role sets are readable (the UI draws the matrix) but NOT client-writable:
-- there is no INSERT/UPDATE/DELETE policy at all, so only the service role and
-- the SQL editor can change them. That is exactly the "change permissions
-- without an app release" workflow this migration exists for.
drop policy if exists otsr_select on public.organized_trip_staff_roles;
create policy otsr_select on public.organized_trip_staff_roles
  for select to authenticated
  using (operator_id is null or operator_id = auth.uid());

grant select, insert, update, delete on public.organized_trip_staff to authenticated;
grant select                        on public.organized_trip_staff_roles to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 6. I3/I4/I5 — the trigger that keeps staff and travelers apart
-- ══════════════════════════════════════════════════════════════════
-- Decision 3 (Ohad, 2026-08-07): a staff member is NEVER also a traveler on the
-- same trip. Cross-table, so a CHECK constraint cannot express it.
--
-- The operator of record is the exception in both directions. group_trips'
-- own machinery (sync_primary_trip_host, 20260708000000) inserts the owner into
-- group_trip_participants as role='host' when the trip is created, and that row
-- must keep existing — enforce_min_one_trip_host and guard_primary_trip_host
-- both depend on it. The owner also never needs a staff row: section 3 grants
-- them everything from host_id.
create or replace function public.enforce_staff_not_traveler()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_host_id uuid;
  v_style   text;
begin
  select host_id, hosting_style into v_host_id, v_style
  from public.group_trips where id = new.trip_id;

  -- I4: staff is an operator-trip concept only.
  if v_style is distinct from 'C' then
    raise exception 'staff can only be added to an operator trip (hosting_style = C)';
  end if;

  -- operator_id must really be the trip's owner, or the Phase 3 "saved team"
  -- read would attribute staff to the wrong operator.
  if new.operator_id is distinct from v_host_id then
    raise exception 'operator_id must match the trip owner';
  end if;

  if new.user_id is not null
     and new.user_id is distinct from v_host_id
     and exists (
       select 1 from public.group_trip_participants p
       where p.trip_id = new.trip_id and p.user_id = new.user_id
     )
  then
    raise exception 'that person is a traveler on this trip; staff and travelers are exclusive';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_not_traveler on public.organized_trip_staff;
create trigger trg_staff_not_traveler
  before insert or update of trip_id, user_id, operator_id
  on public.organized_trip_staff
  for each row execute function public.enforce_staff_not_traveler();

-- The mirror. Cheap: the EXISTS only ever finds rows on operator trips, so the
-- ordinary group-trip join path pays one index probe and nothing else.
create or replace function public.enforce_traveler_not_staff()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if exists (
    select 1
    from public.organized_trip_staff s
    join public.group_trips t on t.id = s.trip_id
    where s.trip_id = new.trip_id
      and s.user_id = new.user_id
      and s.revoked_at is null
      and new.user_id is distinct from t.host_id
  ) then
    raise exception 'that person is staff on this trip; staff and travelers are exclusive';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_traveler_not_staff on public.group_trip_participants;
create trigger trg_traveler_not_staff
  before insert or update of user_id
  on public.group_trip_participants
  for each row execute function public.enforce_traveler_not_staff();

-- ══════════════════════════════════════════════════════════════════
-- 7. updated_at
-- ══════════════════════════════════════════════════════════════════
create or replace function public.touch_organized_trip_staff()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_ots on public.organized_trip_staff;
create trigger trg_touch_ots
  before update on public.organized_trip_staff
  for each row execute function public.touch_organized_trip_staff();

drop trigger if exists trg_touch_otsr on public.organized_trip_staff_roles;
create trigger trg_touch_otsr
  before update on public.organized_trip_staff_roles
  for each row execute function public.touch_organized_trip_staff();

-- A trigger function is NOT an RPC. Without this, all three are exposed at
-- /rest/v1/rpc/<name> to anon and authenticated, because any function in the
-- public schema is PostgREST-callable by default. Calling one errors
-- (referencing `new` outside a trigger context raises), so it is not an open
-- door — but it contradicts the SECDEF hardening standard applied across this
-- database, and it is one lint away from being missed on a function that DOES
-- do something. Caught by get_advisors after the first apply, 2026-08-07.
revoke execute on function public.enforce_staff_not_traveler() from public, anon, authenticated;
revoke execute on function public.enforce_traveler_not_staff() from public, anon, authenticated;
revoke execute on function public.touch_organized_trip_staff() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 8. What Phase 1 does next
-- ══════════════════════════════════════════════════════════════════
-- Nothing above is read by anything yet. Phase 1 rewrites 33 existing gates to
-- call trip_staff_can(), with identical output. The full inventory — 20 RLS
-- policies, 10 functions, 3 storage policies on the group-trip-documents
-- bucket, 3 client call sites — is the Appendix of
-- docs/specs/operator-trips/staff-and-permissions.md.
--
-- The storage policies are the ones that get forgotten. Block a Crew in the
-- table and forget storage.objects, and they still pull the passport file.
