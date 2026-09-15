-- Operator Trips — the CO-OPERATOR tier.
--
-- Spec: docs/specs/operator-trips/staff-and-permissions.md (§ co-operator)
-- Decisions: Ohad, 2026-09-01.
--
-- ✅ APPLIED TO PROD 2026-09-01, in NINE parts. The MCP apply_migration tool
-- refused this file whole (too large), so it went in as these DB versions —
-- same statements, same order, one transaction each:
--   ..._co_operator_role_part1_tier_and_operator_ids        (sections 1-2)
--   ..._co_operator_role_part2a_staff_rls                   (section 3)
--   ..._co_operator_role_part2b_staff_top_tier_guard        (section 4, staff)
--   ..._co_operator_role_part2c_invite_top_tier_guard       (section 4, invites)
--   ..._co_operator_role_part3a_create_staff_invite         (section 5)
--   ..._co_operator_role_part3b_invite_staff_member         (section 5)
--   ..._co_operator_role_part3c_search_users_for_staff      (section 5)
--   ..._co_operator_role_part4a_set_traveler_price          (section 6)
--   ..._co_operator_role_part4b_freeze_trip_prices          (section 6)
--   ..._co_operator_role_part4c_freeze_traveler_price_trigger (section 6)
--
-- Verified live, each in a rolled-back transaction with an impersonated JWT:
-- creator keeps all 15 capabilities; a co-operator gets money.manage but
-- trip.cancel is FALSE; a co-operator appointing another raises 42501 from the
-- trigger and the friendly sentence from the RPC; a co-operator CAN invite a
-- guide and the invite's operator_id is written as the trip owner; the creator
-- can invite a co-operator and that person can ACCEPT (the SECURITY-DEFINER /
-- auth.uid() trap); trip_operator_ids then returns both. Social group trips
-- unchanged: trip_staff_can = is_trip_host for trip.edit and money.manage.
-- get_advisors: zero ERROR entries, no new lint class.
--
-- ── What this adds ─────────────────────────────────────────────────────────
-- A second person who runs the trip alongside the creator. Only the creator —
-- `group_trips.host_id`, the operator of record — can appoint one.
--
-- ── What it deliberately does NOT do ───────────────────────────────────────
-- It does not move `host_id`, and it does not touch Stripe. `host_id` is EIGHT
-- things at once and only one of them is a permission:
--
--   1. permission root      trip_staff_can() branch 2 — everything, no row
--   2. THE PAYEE            payments-checkout reads operator_payout_accounts
--                           .eq('user_id', trip.host_id)
--   3. MERCHANT OF RECORD   payment_intent_data[on_behalf_of]
--   4. refund funder        refunds debit THEIR Stripe balance
--   5. settings owner       operator_settings + defaults/<host_id>/ storage
--   6. notification target  every operator alert is recipient_id = host_id
--   7. staff.manage lock    (widened below, but still owner-gated for tier 5+)
--   8. price lock           (widened below to money.manage)
--
-- A co-operator is a grant of (1) and parts of (7)/(8). Items 2–5 stay with the
-- creator, so nothing about Stripe changes: `operator_payout_accounts` is keyed
-- on user_id and there has never been per-trip payment config. Appointing a
-- co-operator on one trip cannot move money, cannot change a commission, and
-- cannot affect the creator's other trips.
--
-- ⚠️ A co-operator must NEVER be modelled as group_trip_participants.role='host'.
-- sync_primary_trip_host() reassigns group_trips.host_id to the longest-tenured
-- remaining host whenever the current one's participant row disappears — which
-- would silently repoint payouts AND merchant-of-record at the other person.
-- And guard_primary_trip_host() would then let the business be handed over in a
-- single PATCH. Co-operators live in organized_trip_staff, like all staff.
--
-- No explicit BEGIN/COMMIT: every runner that applies this (supabase db push,
-- the MCP apply_migration tool, the SQL editor's "run as migration") already
-- wraps the file in one transaction, and a nested BEGIN would make the COMMIT
-- here close THEIRS — landing half a migration if a later statement fails.

-- ══════════════════════════════════════════════════════════════════
-- 1. The tier itself
-- ══════════════════════════════════════════════════════════════════
-- 'operator' moves to tier 6 so the display order stays a straight line:
--   Listed(1) Crew(2) Guide(3) Manager(4) Co-operator(5) Operator(6)
-- `tier` is FOR SORTING ONLY — no permission check anywhere reads it, and none
-- may start to. Both clients sort by role_key or by this column, never compare
-- it, which is what makes the renumber free.
alter table public.organized_trip_staff_roles
  drop constraint if exists organized_trip_staff_roles_tier_check;
alter table public.organized_trip_staff_roles
  add constraint organized_trip_staff_roles_tier_check
  check (tier >= 1 and tier <= 6);

alter table public.organized_trip_staff_roles
  drop constraint if exists organized_trip_staff_roles_role_key_check;
alter table public.organized_trip_staff_roles
  add constraint organized_trip_staff_roles_role_key_check
  check (role_key in ('listed','crew','guide','manager','co_operator','operator'));

alter table public.organized_trip_staff
  drop constraint if exists organized_trip_staff_role_key_check;
alter table public.organized_trip_staff
  add constraint organized_trip_staff_role_key_check
  check (role_key in ('listed','crew','guide','manager','co_operator','operator'));

-- 'operator' stays absent here: it is the creator's own display row, written by
-- ensureOperatorOnCrew() at publish, and there is nobody to invite to it.
-- 'co_operator' IS invitable — that is the whole point of this migration.
alter table public.organized_trip_staff_invites
  drop constraint if exists organized_trip_staff_invites_role_key_check;
alter table public.organized_trip_staff_invites
  add constraint organized_trip_staff_invites_role_key_check
  check (role_key in ('listed','crew','guide','manager','co_operator'));

update public.organized_trip_staff_roles set tier = 6 where role_key = 'operator';

-- The set. Everything the owner has, minus `trip.cancel`.
--
-- WHY NOT trip.cancel: cancelling an operator trip refunds every traveler in
-- full, out of the CREATOR's Stripe balance (see trip-cancel/index.ts and
-- 20260820000900_trip_cancelled_refund). It is the one irreversible mass action
-- in the product and it spends money that belongs to someone who is not the
-- person clicking. Refunding ONE traveler (money.manage) is granted; dissolving
-- the trip is not.
--
-- WHY NOT updates.send: same reason manager and operator lack it — the gate is
-- `trip.edit OR updates.send` (20260817000000), and trip.edit is granted here.
--
-- medical.view IS granted, unlike Manager (20260824000000_manager_no_medical).
-- A co-operator is an owner-equivalent, not hired help.
insert into public.organized_trip_staff_roles
  (role_key, operator_id, tier, label, blurb, capabilities)
values
  ('co_operator', null, 5, 'Co-operator',
   'Runs the trip with you. Everything except cancelling it.',
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
     'staff.manage'
   ])
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 2. Who counts as an operator of this trip
-- ══════════════════════════════════════════════════════════════════
-- One place that answers "everyone who runs this trip". Used by the
-- notification fan-out below, and the seam an account-wide partner model would
-- extend later (add a branch here, not a second definition elsewhere).
create or replace function public.trip_operator_ids(p_trip_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select array_agg(distinct uid)
  from (
    select host_id as uid from public.group_trips where id = p_trip_id
    union
    select s.user_id
      from public.organized_trip_staff s
     where s.trip_id     = p_trip_id
       and s.role_key    = 'co_operator'
       and s.user_id     is not null
       and s.accepted_at is not null
       and s.revoked_at  is null
  ) x
  where uid is not null;
$$;

revoke execute on function public.trip_operator_ids(uuid) from public, anon;
grant  execute on function public.trip_operator_ids(uuid) to authenticated;
-- The notification fan-out in stripe-webhook, scan-stalled-onboarding and
-- scan-requirement-deadlines calls this on the SERVICE-ROLE client. service_role
-- bypasses RLS but not EXECUTE grants, so without this line those functions
-- silently stop notifying anyone.
grant  execute on function public.trip_operator_ids(uuid) to service_role;

-- A co-operator with full powers and no notifications is a trap: they can act
-- on nothing they were not told about. trip_admin_ids() is what every
-- tg_notify_* trigger fans out to, so widening it here reaches all of them at
-- once. Staff only exist on hosting_style='C' trips, so the union below is
-- always empty for social group trips — their behaviour is unchanged.
--
-- CREATE OR REPLACE, not DROP+CREATE: a recreate re-grants PUBLIC.
create or replace function public.trip_admin_ids(p_trip_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select array_agg(distinct uid)
  from (
    select host_id as uid from public.group_trips where id = p_trip_id
    union
    select user_id from public.group_trip_participants
      where trip_id = p_trip_id and role = 'host'
    union
    select s.user_id
      from public.organized_trip_staff s
     where s.trip_id     = p_trip_id
       and s.role_key    = 'co_operator'
       and s.user_id     is not null
       and s.accepted_at is not null
       and s.revoked_at  is null
  ) x
  where uid is not null;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 3. staff.manage stops being host_id-literal
-- ══════════════════════════════════════════════════════════════════
-- Until now `staff.manage` appeared in the tier-5 capability array but was
-- enforced as a literal host_id check in RLS — so anyone granted it saw the
-- "Invite crew" button and got a raw RLS error. Two sources of truth, one of
-- them a lie.
--
-- Invariant I2 ("nobody can grant themselves anything") does not survive
-- unchanged, so it is replaced by a narrower one that does the same job:
--
--   I2': only group_trips.host_id may create, alter or remove a row at the
--        co-operator tier or above.
--
-- Enforced by the trigger in section 4, which is deliberately NOT a capability
-- — it reads host_id directly, exactly like the old policy did. So the chain
-- stops: a co-operator can hire crew, but cannot mint another co-operator, and
-- cannot revoke the one the creator appointed (including themselves being
-- unable to shield themselves from removal).
--
-- trip_staff_can() is SECURITY DEFINER and bypasses RLS, so a policy calling it
-- does not recurse into the table it protects.

-- SELECT: also fixes a pre-existing gap. Staff are not participants, so
-- `is_trip_participant(trip_id)` was false for them and a Manager or Guide
-- could read only their OWN row — the dashboard crew page rendered a list of
-- one. `roster.view` is held by Crew and up, which is exactly who should see
-- who else is on the trip.
drop policy if exists ots_select on public.organized_trip_staff;
create policy ots_select on public.organized_trip_staff
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_participant(trip_id)
    or public.trip_staff_can(trip_id, 'roster.view')
    or exists (
      select 1 from public.group_trips t
      where t.id = organized_trip_staff.trip_id and t.host_id = auth.uid()
    )
  );

drop policy if exists ots_write on public.organized_trip_staff;
create policy ots_write on public.organized_trip_staff
  for all to authenticated
  using      (public.trip_staff_can(trip_id, 'staff.manage'))
  with check (public.trip_staff_can(trip_id, 'staff.manage'));

drop policy if exists otsi_operator_all on public.organized_trip_staff_invites;
create policy otsi_operator_all on public.organized_trip_staff_invites
  for all to authenticated
  using      (public.trip_staff_can(trip_id, 'staff.manage'))
  with check (public.trip_staff_can(trip_id, 'staff.manage'));

-- ══════════════════════════════════════════════════════════════════
-- 4. I2' — only the owner touches the top tiers
-- ══════════════════════════════════════════════════════════════════
-- Covers INSERT, UPDATE and DELETE. UPDATE matters in both directions: a
-- co-operator must not be able to PROMOTE a guide to co-operator, and must not
-- be able to DEMOTE or revoke the co-operator the creator appointed. So the
-- test is on the old row as well as the new one.
--
-- auth.uid() is null under the service role, which is trusted here: that is how
-- accept_staff_invite (SECURITY DEFINER, but it re-checks) and any backfill run.
create or replace function public.enforce_owner_owns_top_tiers()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_host    uuid;
  v_trip    uuid;
  v_is_host boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then v_trip := old.trip_id; else v_trip := new.trip_id; end if;

  select host_id into v_host from public.group_trips where id = v_trip;
  v_is_host := (auth.uid() = v_host);

  if tg_op = 'DELETE' then
    if not coalesce(v_is_host, false)
       and old.role_key in ('operator','co_operator') then
      raise exception 'only the operator of record can remove a co-operator'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if coalesce(v_is_host, false) then
    -- The owner may do anything here, with one exception: the 'operator' tier
    -- is their OWN crew card and describes who owns the trip. Handing it to
    -- someone else would create a second, contradictory answer to that.
    if new.role_key = 'operator' and new.user_id is distinct from v_host then
      raise exception 'the operator tier belongs to the operator of record'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- ACCEPTING an invite is not APPOINTING anyone, and the two are hard to tell
  -- apart from here: accept_staff_invite() is SECURITY DEFINER, which changes
  -- the ROLE but not the JWT — auth.uid() inside it is still the invitee. So
  -- without this branch the creator could invite a co-operator and that person
  -- could never accept, which is the whole feature.
  --
  -- The invite row IS the authorisation, and it is not forgeable: only host_id
  -- can mint one (trg_owner_owns_top_tier_invites), and it is still unaccepted
  -- at this moment because accept_staff_invite stamps accepted_at AFTER this
  -- insert. Deliberately not a session GUC: a flag is something to be set, an
  -- invite is something that had to be issued.
  if tg_op = 'INSERT'
     and new.role_key = 'co_operator'
     and new.user_id = auth.uid()
     and exists (
       select 1 from public.organized_trip_staff_invites i
        where i.trip_id     = new.trip_id
          and i.role_key    = 'co_operator'
          and i.accepted_at is null
          and i.revoked_at  is null
          and i.expires_at  > now()
          and (i.invited_user_id is null or i.invited_user_id = auth.uid())
     ) then
    return new;
  end if;

  if new.role_key in ('operator','co_operator')
     or (tg_op = 'UPDATE' and old.role_key in ('operator','co_operator')) then
    raise exception 'only the operator of record can appoint or change a co-operator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_owner_owns_top_tiers on public.organized_trip_staff;
create trigger trg_owner_owns_top_tiers
  before insert or update or delete on public.organized_trip_staff
  for each row execute function public.enforce_owner_owns_top_tiers();

-- Same rule one table earlier, so a co-operator invite cannot even be minted.
create or replace function public.enforce_owner_owns_top_tier_invites()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_host    uuid;
  v_trip    uuid;
  v_is_host boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then v_trip := old.trip_id; else v_trip := new.trip_id; end if;

  select host_id into v_host from public.group_trips where id = v_trip;
  v_is_host := (auth.uid() = v_host);

  if tg_op = 'DELETE' then
    if not coalesce(v_is_host, false) and old.role_key = 'co_operator' then
      raise exception 'only the operator of record can withdraw a co-operator invite'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if coalesce(v_is_host, false) then
    return new;
  end if;

  -- The last thing accept_staff_invite() does is stamp accepted_at/accepted_by
  -- on the invite — as the invitee, for the reason above. That is claiming an
  -- invite, not issuing one, so it is allowed as long as nothing else about the
  -- row moves. role_key in particular must not.
  if tg_op = 'UPDATE'
     and old.role_key = 'co_operator'
     and new.role_key = old.role_key
     and new.trip_id  is not distinct from old.trip_id
     and new.invited_user_id is not distinct from old.invited_user_id
     and new.accepted_by = auth.uid()
     and old.accepted_at is null then
    return new;
  end if;

  if new.role_key = 'co_operator'
     or (tg_op = 'UPDATE' and old.role_key = 'co_operator') then
    raise exception 'only the operator of record can invite a co-operator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_owner_owns_top_tier_invites on public.organized_trip_staff_invites;
create trigger trg_owner_owns_top_tier_invites
  before insert or update or delete on public.organized_trip_staff_invites
  for each row execute function public.enforce_owner_owns_top_tier_invites();

-- A trigger function is not an RPC. Without this both are callable at
-- /rest/v1/rpc/<name>. (20260807000000 §7 learned this from get_advisors.)
revoke execute on function public.enforce_owner_owns_top_tiers()        from public, anon, authenticated;
revoke execute on function public.enforce_owner_owns_top_tier_invites() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. The invite RPCs
-- ══════════════════════════════════════════════════════════════════
-- Three changes to each:
--
--   a. The gate moves from `host_id = auth.uid()` to `staff.manage`, so a
--      co-operator can hire crew. Still pinned to hosting_style='C'.
--   b. `p_role_key = 'co_operator'` additionally requires host_id — I2'. The
--      trigger in section 4 enforces this too; it is checked here as well so
--      the caller gets a sentence instead of a trigger exception.
--   c. ⚠️ `operator_id` is now written as the TRIP'S host_id, not auth.uid().
--      accept_staff_invite copies i.operator_id into organized_trip_staff, and
--      enforce_staff_not_traveler() raises unless it equals the trip owner. So
--      with the old line, every invite sent by a co-operator would have been
--      accepted-then-rejected at the last step, from the invitee's screen.
create or replace function public.create_staff_invite(
  p_trip_id uuid,
  p_role_key text,
  p_title text default null,
  p_requirement_ids uuid[] default '{}'::uuid[],
  p_bio text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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
    (trip_id, operator_id, role_key, title, requirement_ids, bio)
  values
    (p_trip_id, v_host, p_role_key, nullif(btrim(p_title), ''),
     coalesce(p_requirement_ids, '{}'::uuid[]), nullif(btrim(p_bio), ''))
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.invite_staff_member(
  p_trip_id uuid,
  p_user_id uuid,
  p_role_key text,
  p_title text default null,
  p_requirement_ids uuid[] default '{}'::uuid[],
  p_bio text default null
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
    (trip_id, operator_id, role_key, title, invited_user_id, requirement_ids, bio)
  values
    (p_trip_id, v_host, p_role_key, nullif(btrim(p_title), ''), p_user_id,
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
      'item_name',   v_role_label,
      'staff_token', v_token
    )
  );

  return v_id;
end;
$$;

-- The in-app people search behind the targeted invite. Same widening, or a
-- co-operator opens the invite sheet and finds nobody.
--
-- ⚠️ Body copied VERBATIM from the live database (2026-09-01), not from the
-- repo — the repo's copy has drifted and its column list is wrong. Only the
-- four gate lines below differ. The return type in particular must match
-- exactly: CREATE OR REPLACE cannot change it, and getting it wrong fails with
-- "cannot change return type of existing function".
create or replace function public.search_users_for_staff(p_trip_id uuid, p_query text)
returns table(user_id uuid, name text, profile_image_url text, state text)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and hosting_style = 'C'
  ) or not public.trip_staff_can(p_trip_id, 'staff.manage') then
    raise exception 'Only the operator of this trip can search for crew'
      using errcode = '42501';
  end if;

  if length(v_q) < 2 then
    return;
  end if;

  return query
  select s.user_id,
         s.name::text,
         s.profile_image_url::text,
         case
           when exists (
             select 1 from public.organized_trip_staff st
              where st.trip_id = p_trip_id and st.user_id = s.user_id
                and st.revoked_at is null
           ) then 'crew'
           when exists (
             select 1 from public.group_trip_participants p
              where p.trip_id = p_trip_id and p.user_id = s.user_id
           ) then 'traveler'
           when exists (
             select 1 from public.organized_trip_staff_invites i
              where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
                and i.accepted_at is null and i.revoked_at is null
                and i.expires_at > now()
           ) then 'invited'
           else 'available'
         end as state
    from public.surfers s
   where s.is_demo_user = false
     and s.name ilike '%' || v_q || '%'
     and s.user_id <> auth.uid()
     and not exists (
       select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
     )
   order by
     case
       when not exists (
         select 1 from public.organized_trip_staff st
          where st.trip_id = p_trip_id and st.user_id = s.user_id and st.revoked_at is null)
        and not exists (
         select 1 from public.group_trip_participants p
          where p.trip_id = p_trip_id and p.user_id = s.user_id)
        and not exists (
         select 1 from public.organized_trip_staff_invites i
          where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
            and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
       then 0 else 1
     end,
     case when s.name ilike v_q || '%' then 0 else 1 end,
     s.name
   limit 20;
end;
$$;

revoke execute on function public.create_staff_invite(uuid, text, text, uuid[], text) from public, anon;
grant  execute on function public.create_staff_invite(uuid, text, text, uuid[], text) to authenticated;
revoke execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[], text) from public, anon;
grant  execute on function public.invite_staff_member(uuid, uuid, text, text, uuid[], text) to authenticated;
revoke execute on function public.search_users_for_staff(uuid, text) from public, anon;
grant  execute on function public.search_users_for_staff(uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 6. Money — the C3 literal becomes money.manage, on operator trips only
-- ══════════════════════════════════════════════════════════════════
-- 20260803000000 §C3 pinned pricing to group_trips.host_id because "flat
-- multi-host" is an untrusted set for money — on a SOCIAL group trip, anyone a
-- host promotes becomes a host, so is_trip_host() must never gate money.
--
-- That reasoning is about social trips, and it still holds. So the widening is
-- guarded on hosting_style='C', where the set is not flat: money.manage is held
-- only by the co-operator tier, and only the owner can appoint one. On any
-- other trip the check stays byte-for-byte the old literal.
--
-- Written as `host_id = auth.uid() OR (C-trip AND money.manage)` rather than
-- just the capability, so the owner is never at the mercy of a capability array
-- someone edits (invariant I1: no config mistake locks the owner out).
create or replace function public.operator_set_traveler_price(
  p_trip_id uuid, p_user_id uuid, p_total_usd numeric, p_deposit_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_count integer; v_has_deposit_req boolean;
begin
  if not exists (
    select 1 from public.group_trips
     where id = p_trip_id and host_id = auth.uid()
  ) and not (
    exists (
      select 1 from public.group_trips
       where id = p_trip_id and hosting_style = 'C'
    )
    and public.trip_staff_can(p_trip_id, 'money.manage')
  ) then
    raise exception 'not your trip';
  end if;

  -- Belt and braces: nobody prices themselves, owner included.
  if p_user_id = auth.uid() then
    raise exception 'you cannot set your own price';
  end if;

  -- `null < 0` is NULL, not true, so a null total would otherwise sail past
  -- every guard below and get written straight to price_total_usd. From
  -- there operator_traveler_amount_due() returns NULL and
  -- operator_requirement_pay_state() reads 'not_started' forever, with no
  -- way for the traveler to pay a must_have item — the same class of
  -- permanently-unsatisfiable requirement as I6 in 20260803000000.
  if p_total_usd is null then
    raise exception 'a price is required';
  end if;

  if p_total_usd < 0 then
    raise exception 'price cannot be negative';
  end if;

  if p_deposit_usd is not null and p_deposit_usd < 0 then
    raise exception 'deposit cannot be negative';
  end if;

  if p_deposit_usd is not null and p_deposit_usd > p_total_usd then
    raise exception 'deposit cannot exceed the total price';
  end if;

  -- C2 (round 5): a deposit is only collectable if a deposit REQUIREMENT
  -- exists to collect it against. The create wizard treats a blank or zero
  -- deposit as "one single payment" and publishes a `balance` row alone — no
  -- `deposit` row. Writing deposit_usd on such a trip is silently
  -- uncollectable money: operator_traveler_amount_due('balance') becomes
  -- `price - deposit`, so the traveler is billed the reduced balance, every
  -- pay row reads `approved`, and the operator is short the deposit with no
  -- error anywhere. TravelerPriceSheet hides the field in that case; this is
  -- the server-side half, because the client is not the authority on money.
  select exists (
    select 1 from public.organized_trip_requirements
     where trip_id = p_trip_id and kind = 'deposit' and is_active
  ) into v_has_deposit_req;

  if p_deposit_usd is not null and not v_has_deposit_req then
    raise exception
      'this trip takes one single payment — it has no deposit step to collect a deposit against';
  end if;

  update public.group_trip_participants
     set price_total_usd = p_total_usd,
         deposit_usd     = p_deposit_usd,
         price_set_by    = auth.uid(),
         price_set_at    = now()
   where trip_id = p_trip_id
     and user_id = p_user_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no participant row for trip % / user %', p_trip_id, p_user_id;
  end if;
end;
$$;

create or replace function public.operator_freeze_trip_prices(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_mode    text;
  v_price   numeric;
  v_deposit numeric;
  v_frozen  integer;
begin
  if not exists (
    select 1 from public.group_trips
     where id = p_trip_id and host_id = auth.uid()
  ) and not (
    exists (
      select 1 from public.group_trips
       where id = p_trip_id and hosting_style = 'C'
    )
    and public.trip_staff_can(p_trip_id, 'money.manage')
  ) then
    raise exception 'not your trip' using errcode = '42501';
  end if;

  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_deposit
    from public.group_trips
   where id = p_trip_id
   for update;

  -- An offline trip collects nothing through Swellyo and its pay requirements
  -- are deactivated, so there is no amount for anyone to owe. Freezing here
  -- would pin prices that nothing reads.
  if v_mode is distinct from 'managed' then
    return 0;
  end if;

  -- Nothing to freeze against. A trip with no price has no traveler relying on
  -- the fallback, so this is a no-op rather than an error.
  if v_price is null then
    return 0;
  end if;

  update public.group_trip_participants
     set price_total_usd = v_price,
         -- Only pin a deposit when the trip has one. Writing 0 would turn "pay
         -- it all at once" into "you already paid a 0 deposit", which reads the
         -- same to the math but loses the distinction.
         deposit_usd = coalesce(deposit_usd, v_deposit)
   where trip_id = p_trip_id
     and price_total_usd is null
     and role <> 'host';

  get diagnostics v_frozen = row_count;
  return v_frozen;
end;
$$;

-- The trigger that reverts a price written by anyone who is not allowed to set
-- one. Same widening, same hosting_style guard: on a social group trip this is
-- byte-for-byte the old behaviour.
create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  -- auth.uid() is null under the service role -- treat that as trusted the
  -- same as the operator, rather than assuming a JWT is always present.
  if auth.uid() is not null and not (
       exists (
         select 1 from public.group_trips
          where id = new.trip_id and host_id = auth.uid()
       )
       or (
         exists (
           select 1 from public.group_trips
            where id = new.trip_id and hosting_style = 'C'
         )
         and public.trip_staff_can(new.trip_id, 'money.manage')
       )
     ) then
    if TG_OP = 'UPDATE' then
      new.price_total_usd := old.price_total_usd;
      new.deposit_usd     := old.deposit_usd;
      new.price_set_by    := old.price_set_by;
      new.price_set_at    := old.price_set_at;
      return new;
    end if;

    new.price_set_by := null;
    new.price_set_at := null;

    select payment_mode, cost_per_person, deposit_amount
      into v_mode, v_price, v_dep
      from public.group_trips
     where id = new.trip_id;

    if v_mode is distinct from 'managed' then
      new.price_total_usd := null;
      new.deposit_usd     := null;
      return new;
    end if;

    -- Joining on or after the full-payment deadline: the whole price, in one
    -- payment, in onboarding.
    if v_price is not null and public.operator_trip_full_payment_due(new.trip_id) then
      v_dep := v_price;
    end if;

    new.price_total_usd := v_price;
    new.deposit_usd     := v_dep;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    return new;
  end if;

  if new.price_total_usd is not null then
    return new;
  end if;

  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_dep
    from public.group_trips
   where id = new.trip_id;

  if v_mode is distinct from 'managed' then
    return new;
  end if;

  if v_price is not null and public.operator_trip_full_payment_due(new.trip_id) then
    v_dep := v_price;
  end if;

  new.price_total_usd := v_price;
  new.deposit_usd     := v_dep;
  return new;
end;
$$;

revoke execute on function public.operator_set_traveler_price(uuid, uuid, numeric, numeric) from public, anon;
grant  execute on function public.operator_set_traveler_price(uuid, uuid, numeric, numeric) to authenticated;
revoke execute on function public.operator_freeze_trip_prices(uuid) from public, anon;
grant  execute on function public.operator_freeze_trip_prices(uuid) to authenticated;
revoke execute on function public.freeze_traveler_price() from public, anon, authenticated;


-- ══════════════════════════════════════════════════════════════════
-- Verification (run as a real user — the SQL editor has auth.uid() = null)
-- ══════════════════════════════════════════════════════════════════
--
-- 1. The tier landed and sorts last-but-one:
--    select role_key, tier from organized_trip_staff_roles
--     where operator_id is null order by tier;
--    -- expect: listed 1, crew 2, guide 3, manager 4, co_operator 5, operator 6
--
-- 2. A co-operator has money but not cancel:
--    select 'trip.cancel'  = any(capabilities) as can_cancel,
--           'money.manage' = any(capabilities) as can_money
--      from organized_trip_staff_roles
--     where role_key = 'co_operator' and operator_id is null;
--    -- expect: false, true
--
-- 3. Social group trips did not move. As a host of a NON-C trip:
--    select public.trip_staff_can('<group-trip-id>','money.manage');
--    -- expect: same as is_trip_host('<group-trip-id>')
--
-- 4. The owner is still unconditional:
--    select public.trip_staff_can('<c-trip-id>', c)
--      from unnest(array['money.manage','trip.cancel','staff.manage']) c;
--    -- expect: all true, as the owner
--
-- 5. I2' holds. As a co-operator, this must raise:
--    select public.invite_staff_member('<c-trip-id>','<someone>','co_operator');
--    -- expect: 42501 'Only the operator of record can invite a co-operator'
--    and this must succeed:
--    select public.invite_staff_member('<c-trip-id>','<someone>','guide');
--
-- 6. Notifications reach both:
--    select public.trip_operator_ids('<c-trip-id>');
--    select public.trip_admin_ids('<c-trip-id>');
--    -- expect: host_id plus every accepted, unrevoked co-operator
--
-- 7. get_advisors after applying. Every function above is SECURITY DEFINER and
--    a missed revoke is an anon-callable RPC.
