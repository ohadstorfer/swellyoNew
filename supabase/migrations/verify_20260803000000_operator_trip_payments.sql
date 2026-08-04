-- Verification script for 20260803000000_operator_trip_payments.sql.
--
-- Not a migration -- no timestamp-prefixed filename on purpose, so tooling
-- that walks numbered migration files skips it (same convention as the
-- existing verify_demo_users.sql in this folder).
--
-- Run with: supabase db query --linked -f supabase/migrations/verify_20260803000000_operator_trip_payments.sql
--
-- The whole file is one explicit transaction (BEGIN ... ROLLBACK): it applies
-- the migration's DDL, runs the assertions below, returns their results as
-- rows (this CLI does not surface RAISE NOTICE, only the final result set),
-- then rolls everything back. Nothing here persists. Re-runnable any time,
-- before or after the real migration is applied -- every DDL statement is
-- idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS).
--
-- NOTE: this DDL block is a hand-maintained copy of
-- 20260803000000_operator_trip_payments.sql, not a read of that file --
-- `supabase db query -f` sends the file as one Postgres wire message, and
-- psql's `\i` include directive (tested directly against this project) is
-- not honoured over that path; it errors as a syntax error at `\`. Any edit
-- to the migration's DDL must be mirrored here by hand.
--
-- Round-1 fix verification (2026-08-03) covers, beyond the original happy
-- path:
--   - the freeze trigger actually fired (not the coalesce fallback) --
--     asserted directly on group_trip_participants, then proven stable
--     against a later trip-price change (C1 context, not the vuln itself).
--   - C1 closed: a non-host's own PATCH to price_total_usd/deposit_usd is
--     silently ignored; a host's PATCH still sticks (the load-bearing case
--     a later task depends on).
--
-- Round-2 additions (2026-08-03):
--   - operator_traveler_amount_due's balance branch rewritten: the round-1
--     `greatest(..., 0)` floor is gone (GREATEST ignores NULL args, so it
--     silently turned "no price configured anywhere" into an approved 0
--     instead of NULL / not_started). New coverage below proves both the
--     no-price-anywhere case and the mixed-coalesce case stay NULL.
--   - C1 impersonation assertions now also assert `GET DIAGNOSTICS ...
--     row_count = 1` on each impersonated UPDATE, so a false pass from the
--     write matching zero rows (rather than the trigger reverting it) is
--     no longer possible.
--   - v_host is asserted distinct from v_user explicitly, instead of
--     relying on `limit 1` ordering happening not to collide.
--
-- Round-3 fixes (2026-08-03):
--   - Every print-only row (a bare `value := v_state; return next;` with no
--     pass/fail check) has been converted to a real `if ... then 'OK: ...'
--     else 'FAIL: ...' end if` assertion. Previously several rows -- most
--     importantly the pay-state check on the no-price-anywhere fixture,
--     which is the ONLY coverage of operator_requirement_pay_state's
--     `amount is null -> not_started` guard -- could not fail: a regression
--     would print 'approved' and the run would still read all-green ("no
--     FAIL: anywhere"). Every row below now can genuinely fail.
--   - v_trip is now selected with `order by id` (was unordered `limit 1`),
--     and v_trip2 is asserted distinct from v_trip explicitly. Both trips
--     are real rows in prod (currently exactly 2 `hosting_style = 'C'`
--     trips); an unordered v_trip and an `order by id offset 1` v_trip2
--     could otherwise land on the same row.
--
-- Round-4 fix (2026-08-03): uq_otpe_object rescoped to `event_type = 'paid'`
-- only (was unscoped, so it also covered 'refunded' rows and blocked a
-- legitimate second partial refund against the same payment_intent -- see
-- the comment at the index below and in the real migration for the full
-- webhook-retry-storm reasoning). New assertions: a paid row, then two
-- distinct partial refunds against the same provider_object_id, both must
-- insert (the second is exactly what the old predicate blocked), and the
-- summed ledger balance must be correct.
--
-- Round-5 fixes (2026-08-03), whole-branch review. This file now also
-- carries the DDL of 20260803000100_operator_set_traveler_price.sql, because
-- the round-5 findings are precisely about how the two migrations interact:
--   C3 — operator_set_traveler_price authorises on group_trips.host_id, not
--        is_trip_host() (flat multi-host = every promoted admin, and only
--        host_id is ever paid). New assertions: a promoted admin who is NOT
--        host_id must be refused; the operator of record must still succeed;
--        nobody may price themselves; and the accepted write must stamp
--        price_set_by / price_set_at (new columns in section 3).
--        Also asserted: a non-host cannot forge price_set_by on their own
--        row (freeze_traveler_price pins it, like the amounts).
--   C2 — the same RPC refuses a non-null deposit on a trip with no ACTIVE
--        `deposit` requirement (the wizard's "one single payment" shape),
--        where the deposit would otherwise be silently uncollectable.
--   I1 — operator_requirement_pay_state now counts only ledger rows whose
--        is_livemode matches `app.stripe_livemode` (default false). New
--        assertions cover both settings against the same fixture rows.

begin;

-- ══════════════════════════════════════════════════════════════════
-- Migration DDL (identical to 20260803000000_operator_trip_payments.sql)
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.operator_payout_accounts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  provider           text not null default 'stripe',
  stripe_account_id  text,
  charges_enabled    boolean not null default false,
  commission_bps     integer not null default 1200 check (commission_bps between 0 and 10000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.operator_payout_accounts enable row level security;

revoke all    on public.operator_payout_accounts from anon, authenticated, public;
grant  select on public.operator_payout_accounts to   authenticated;

drop policy if exists opa_read_own on public.operator_payout_accounts;
create policy opa_read_own on public.operator_payout_accounts
  for select to authenticated
  using (user_id = auth.uid());

alter table public.group_trips
  add column if not exists payment_mode   text not null default 'offline',
  add column if not exists deposit_amount numeric;

alter table public.group_trips
  drop constraint if exists group_trips_payment_mode_check;
alter table public.group_trips
  add constraint group_trips_payment_mode_check
  check (payment_mode in ('offline', 'managed'));

alter table public.group_trips
  drop constraint if exists group_trips_managed_is_operator;
alter table public.group_trips
  add constraint group_trips_managed_is_operator
  check (payment_mode = 'offline' or hosting_style = 'C');

alter table public.group_trips
  drop constraint if exists group_trips_deposit_non_negative;
alter table public.group_trips
  add constraint group_trips_deposit_non_negative
  check (deposit_amount is null or deposit_amount >= 0);

alter table public.group_trips
  drop constraint if exists group_trips_deposit_not_over_price;
alter table public.group_trips
  add constraint group_trips_deposit_not_over_price
  check (deposit_amount is null
      or cost_per_person is null
      or deposit_amount <= cost_per_person);

alter table public.group_trip_participants
  add column if not exists price_total_usd numeric,
  add column if not exists deposit_usd     numeric;

-- Round 5, C3: price attribution.
alter table public.group_trip_participants
  add column if not exists price_set_by uuid references auth.users(id) on delete set null,
  add column if not exists price_set_at timestamptz;

alter table public.group_trip_participants
  drop constraint if exists gtp_price_non_negative;
alter table public.group_trip_participants
  add constraint gtp_price_non_negative
  check ((price_total_usd is null or price_total_usd >= 0)
     and (deposit_usd     is null or deposit_usd     >= 0));

alter table public.group_trip_participants
  drop constraint if exists gtp_deposit_not_over_total;
alter table public.group_trip_participants
  add constraint gtp_deposit_not_over_total
  check (price_total_usd is null
      or deposit_usd is null
      or deposit_usd <= price_total_usd);

alter table public.organized_trip_requirements
  drop constraint if exists organized_trip_requirements_kind_check;
alter table public.organized_trip_requirements
  add constraint organized_trip_requirements_kind_check
  check (kind in ('passport', 'waiver', 'medical', 'insurance',
                  'visa', 'flights', 'custom', 'deposit', 'balance'));

alter table public.organized_trip_requirements
  drop constraint if exists organized_trip_requirements_pay_kind_match;
alter table public.organized_trip_requirements
  add constraint organized_trip_requirements_pay_kind_match
  check ((req_type = 'pay') = (kind in ('deposit', 'balance')));

create or replace function public.enforce_pay_requires_managed_trip()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_style text; v_mode text;
begin
  if new.req_type <> 'pay' then
    return new;
  end if;

  select hosting_style, payment_mode into v_style, v_mode
    from public.group_trips
   where id = new.trip_id;

  if v_style is distinct from 'C' or v_mode is distinct from 'managed' then
    raise exception
      'a pay requirement needs an operator trip with payment_mode = ''managed''';
  end if;

  return new;
end $$;

revoke execute on function public.enforce_pay_requires_managed_trip()
  from public, anon, authenticated;

drop trigger if exists trg_pay_requires_managed_trip on public.organized_trip_requirements;
create trigger trg_pay_requires_managed_trip
  before insert or update of req_type, trip_id
  on public.organized_trip_requirements
  for each row execute function public.enforce_pay_requires_managed_trip();

create table if not exists public.organized_trip_payment_events (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.group_trips(id) on delete cascade,
  user_id             uuid not null references auth.users(id)          on delete cascade,
  requirement_id      uuid references public.organized_trip_requirements(id) on delete set null,
  provider            text not null default 'stripe',
  provider_event_id   text not null,
  provider_object_id  text,
  event_type          text not null check (event_type in ('paid', 'refunded', 'failed')),
  amount_usd          numeric not null,
  amount_charged      numeric,
  currency_charged    text,
  application_fee_usd numeric,
  is_livemode         boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint otpe_amount_sign_matches_type check (
    (event_type = 'paid'     and amount_usd > 0) or
    (event_type = 'refunded' and amount_usd < 0) or
    (event_type = 'failed'   and amount_usd = 0)
  )
);

create unique index if not exists uq_otpe_provider_event
  on public.organized_trip_payment_events (provider, provider_event_id);

-- Round 4: scoped to event_type = 'paid' only -- see the matching comment
-- in the real migration for why 'refunded' must not share this index
-- (cumulative charge.refunded amounts are recorded as deltas, so a
-- legitimate second partial refund shares the same
-- (provider, provider_object_id, event_type = 'refunded') key on purpose).
-- `drop index if exists` + unconditional `create` (not `if not exists`),
-- matching the real migration: this file is re-runnable and an index left
-- over from an earlier run with the old predicate would otherwise survive.
drop index if exists public.uq_otpe_object;
create unique index uq_otpe_object
  on public.organized_trip_payment_events (provider, provider_object_id, event_type)
  where event_type = 'paid' and provider_object_id is not null;

create index if not exists idx_otpe_lookup
  on public.organized_trip_payment_events (trip_id, user_id, requirement_id);

alter table public.organized_trip_payment_events enable row level security;

revoke all    on public.organized_trip_payment_events from anon, authenticated, public;
grant  select on public.organized_trip_payment_events to   authenticated;

drop policy if exists otpe_read_own on public.organized_trip_payment_events;
create policy otpe_read_own on public.organized_trip_payment_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

create or replace function public.operator_traveler_amount_due(
  p_trip_id uuid, p_user_id uuid, p_kind text
) returns numeric
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with base as (
    select
      coalesce(p.price_total_usd, t.cost_per_person) as price,
      coalesce(p.deposit_usd, t.deposit_amount)       as deposit,
      coalesce(p.deposit_usd, t.deposit_amount, 0)    as deposit_or_zero
    from public.group_trips t
    left join public.group_trip_participants p
      on p.trip_id = t.id and p.user_id = p_user_id
    where t.id = p_trip_id
  )
  select case p_kind
    when 'deposit' then deposit
    when 'balance' then
      case
        when price is null then null
        when (price - deposit_or_zero) < 0 then null
        else price - deposit_or_zero
      end
    else null
  end
  from base;
$$;

revoke execute on function public.operator_traveler_amount_due(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.operator_requirement_pay_state(
  p_trip_id uuid, p_user_id uuid, p_requirement_id uuid
) returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with due as (
    select public.operator_traveler_amount_due(
             p_trip_id, p_user_id,
             (select kind from public.organized_trip_requirements where id = p_requirement_id)
           ) as amount
  ),
  paid as (
    select coalesce(sum(amount_usd), 0) as total
      from public.organized_trip_payment_events
     where trip_id        = p_trip_id
       and user_id        = p_user_id
       and requirement_id = p_requirement_id
       and event_type     <> 'failed'
       -- Round 5, I1: only rows from the Stripe mode currently treated as
       -- real money. Unset (the state today) reads as false, so test-mode
       -- rows are what counts during the device test.
       and is_livemode    = coalesce(
                              nullif(current_setting('app.stripe_livemode', true), '')::boolean,
                              false)
  )
  select case
    when (select amount from due) is null then 'not_started'
    when (select total from paid) >= (select amount from due) then 'approved'
    else 'not_started'
  end;
$$;

revoke execute on function public.operator_requirement_pay_state(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  -- Round 6, C3 route 1: authorised on group_trips.host_id, NOT
  -- is_trip_host() (which is every promoted admin, i.e. the untrusted set).
  if auth.uid() is not null and not exists (
       select 1 from public.group_trips
        where id = new.trip_id and host_id = auth.uid()
     ) then
    if TG_OP = 'UPDATE' then
      new.price_total_usd := old.price_total_usd;
      new.deposit_usd     := old.deposit_usd;
      -- Round 5, C3: the attribution columns are pinned for the same reason
      -- as the amounts -- a record its subject can rewrite is not a record.
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

  new.price_total_usd := v_price;
  new.deposit_usd     := v_dep;
  return new;
end $$;

revoke execute on function public.freeze_traveler_price()
  from public, anon, authenticated;

drop trigger if exists trg_freeze_traveler_price on public.group_trip_participants;
create trigger trg_freeze_traveler_price
  before insert or update on public.group_trip_participants
  for each row execute function public.freeze_traveler_price();

create or replace function public.deactivate_pay_rows_when_offline()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.payment_mode = 'offline' and old.payment_mode is distinct from 'offline' then
    update public.organized_trip_requirements
       set is_active = false
     where trip_id = new.id
       and req_type = 'pay';
  end if;
  return new;
end $$;

revoke execute on function public.deactivate_pay_rows_when_offline()
  from public, anon, authenticated;

drop trigger if exists trg_deactivate_pay_rows_when_offline on public.group_trips;
create trigger trg_deactivate_pay_rows_when_offline
  after update of payment_mode on public.group_trips
  for each row execute function public.deactivate_pay_rows_when_offline();

-- Round 6, C3 route 2: replaces the body defined in 20260708000000 (already
-- applied to prod, so that file is not edited). The existing
-- trg_guard_primary_trip_host trigger points at this name already.
create or replace function public.guard_primary_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.host_id is distinct from old.host_id then
    if not exists (
      select 1 from public.group_trip_participants
      where trip_id = new.id and user_id = new.host_id and role = 'host'
    ) then
      raise exception 'host_id must reference a current host of the trip'
        using errcode = 'check_violation';
    end if;

    if auth.uid() is not null
       and pg_trigger_depth() <= 1
       and auth.uid() is distinct from old.host_id then
      raise exception 'only the current organiser can hand over a trip'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.guard_primary_trip_host()
  from public, anon, authenticated;

-- Round 7, C3 route 2 part 2: nobody can remove the owner, and the owner
-- cannot leave. Section 10 alone does not close route 2 -- demote_trip_host
-- and a raw participant DELETE both reach sync_primary_trip_host, whose
-- reassignment section 10 waves through at trigger depth 2.
create or replace function public.protect_trip_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_owner uuid;
begin
  if auth.uid() is null then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  select host_id into v_owner from public.group_trips where id = old.trip_id;

  if not found then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  if v_owner is distinct from old.user_id then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'The trip owner cannot be removed from their own trip'
      using errcode = 'insufficient_privilege';
  end if;

  -- Round 8: trip_id too. Three ways a row leaves the host set, not two.
  if old.role = 'host'
     and (new.role is distinct from 'host'
          or new.user_id is distinct from old.user_id
          or new.trip_id is distinct from old.trip_id) then
    raise exception 'The trip owner cannot be removed as host of their own trip'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

revoke execute on function public.protect_trip_owner_membership()
  from public, anon, authenticated;

drop trigger if exists trg_protect_trip_owner_membership on public.group_trip_participants;
create trigger trg_protect_trip_owner_membership
  before update or delete on public.group_trip_participants
  for each row execute function public.protect_trip_owner_membership();

-- ⚠️ NOT part of 20260803000000. This is a copy of
-- 20260803000200_trip_deletion_and_account_cascade.sql's function, kept here
-- ONLY so that R7-6 below can demonstrate §11's `not found` exemption at all.
--
-- Without it, deleting a trip raises 'A trip must have at least one host'
-- from this trigger before §11's trigger ever runs (BEFORE row triggers fire
-- in alphabetical name order, and trg_enforce_min_one_trip_host sorts before
-- trg_protect_trip_owner_membership), so R7-6 would report a failure that
-- says nothing about the code under test.
--
-- It does NOT ship with the payments migration, deliberately: unblocking trip
-- deletion while `group_trips`' DELETE policy is still is_trip_host() would
-- let any promoted admin cascade away organized_trip_payment_events — the
-- money ledger. See that migration's header. This sandbox rolls back, so
-- applying it here is free; applying it to production is a separate,
-- deliberate step that must land together with the policy narrowing.
create or replace function public.enforce_min_one_trip_host()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_trip_id uuid := old.trip_id;
  v_was_host boolean := (old.role = 'host');
  v_still_host boolean := (tg_op = 'UPDATE' and new.role = 'host');
  v_remaining int;
begin
  if not v_was_host or v_still_host then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not exists (select 1 from public.group_trips where id = v_trip_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not exists (select 1 from auth.users where id = old.user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform 1 from public.group_trips where id = v_trip_id for update;
  select count(*) into v_remaining
  from public.group_trip_participants
  where trip_id = v_trip_id and role = 'host' and user_id <> old.user_id;
  if v_remaining = 0 then
    raise exception 'A trip must have at least one host'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function public.enforce_min_one_trip_host()
  from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- Migration DDL, part 2 -- identical to
-- 20260803000100_operator_set_traveler_price.sql
-- ══════════════════════════════════════════════════════════════════
-- Added in round 5: the C3 and C2 findings are about how this RPC interacts
-- with the schema above, so it cannot be verified from the other file alone.
-- Same hand-maintained-copy rule as the block above -- any edit to
-- 20260803000100 must be mirrored here.
create or replace function public.operator_set_traveler_price(
  p_trip_id     uuid,
  p_user_id     uuid,
  p_total_usd   numeric,
  p_deposit_usd numeric
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_count integer; v_has_deposit_req boolean;
begin
  if not exists (
    select 1 from public.group_trips
     where id = p_trip_id and host_id = auth.uid()
  ) then
    raise exception 'not your trip';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'you cannot set your own price';
  end if;

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
end $$;

revoke execute on function public.operator_set_traveler_price(uuid, uuid, numeric, numeric)
  from public, anon;
grant  execute on function public.operator_set_traveler_price(uuid, uuid, numeric, numeric)
  to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- Assertions -- returns rows instead of RAISE NOTICE (see header)
-- ══════════════════════════════════════════════════════════════════
create or replace function pg_temp.__verify_payments()
returns table(step text, value text)
language plpgsql
as $$
declare
  v_trip  uuid; v_user uuid; v_host uuid; v_req uuid;
  v_trip2 uuid; v_user2 uuid; v_user3 uuid; v_req2 uuid;
  v_state text; v_due numeric; v_price numeric; v_dep numeric;
  v_rows  integer;
  -- Round 5
  v_operator uuid; v_setby uuid; v_setat timestamptz;
begin
  -- Round 3: `order by id` pins which of the (currently 2) operator trips
  -- this is -- an unordered `limit 1` is not guaranteed to return the same
  -- row as v_trip2's `order by id offset 1 limit 1` below, and without a
  -- pin they could collide.
  select id into v_trip from public.group_trips where hosting_style = 'C' order by id limit 1;
  select id into v_user from auth.users limit 1;

  update public.group_trips
     set payment_mode = 'managed', cost_per_person = 2000, deposit_amount = 500
   where id = v_trip;

  insert into public.organized_trip_requirements
    (trip_id, kind, req_type, title, skip_at_onboarding, is_active)
  values (v_trip, 'deposit', 'pay', 'Deposit', 'must_have', true)
  returning id into v_req;

  insert into public.group_trip_participants (trip_id, user_id, role)
  values (v_trip, v_user, 'member')
  on conflict do nothing;

  -- ── Freeze trigger, distinguished from the coalesce fallback ──────────
  -- Both read the same numbers today (2000/500), so the earlier round's
  -- assertions on operator_traveler_amount_due alone could not tell a
  -- fired trigger from an unfired one falling back to group_trips. This
  -- reads the participant row directly, then proves the frozen value does
  -- not track a later trip-price change.
  select price_total_usd, deposit_usd into v_price, v_dep
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_user;

  step := 'participant.price_total_usd after insert (expect 2000)';
  if v_price = 2000 then value := 'OK: ' || v_price;
  else value := 'FAIL: ' || coalesce(v_price::text, 'null'); end if;
  return next;

  step := 'participant.deposit_usd after insert (expect 500)';
  if v_dep = 500 then value := 'OK: ' || v_dep;
  else value := 'FAIL: ' || coalesce(v_dep::text, 'null'); end if;
  return next;

  select public.operator_traveler_amount_due(v_trip, v_user, 'deposit') into v_due;
  step := 'deposit due (expect 500)';
  if v_due = 500 then value := 'OK: ' || v_due;
  else value := 'FAIL: ' || coalesce(v_due::text, 'null'); end if;
  return next;

  select public.operator_traveler_amount_due(v_trip, v_user, 'balance') into v_due;
  step := 'balance due (expect 1500)';
  if v_due = 1500 then value := 'OK: ' || v_due;
  else value := 'FAIL: ' || coalesce(v_due::text, 'null'); end if;
  return next;

  update public.group_trips set cost_per_person = 9999 where id = v_trip;

  select public.operator_traveler_amount_due(v_trip, v_user, 'deposit') into v_due;
  step := 'deposit due after trip cost_per_person changed to 9999 (expect still 500)';
  if v_due = 500 then value := 'OK: ' || v_due;
  else value := 'FAIL: ' || coalesce(v_due::text, 'null'); end if;
  return next;

  select public.operator_traveler_amount_due(v_trip, v_user, 'balance') into v_due;
  step := 'balance due after trip cost_per_person changed to 9999 (expect still 1500)';
  if v_due = 1500 then value := 'OK: ' || v_due;
  else value := 'FAIL: ' || coalesce(v_due::text, 'null'); end if;
  return next;

  update public.group_trips set cost_per_person = 2000 where id = v_trip;

  -- ── Ledger / pay-state happy path (unchanged from round 0) ────────────
  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'state before paying (expect not_started)';
  if v_state = 'not_started' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_1', 'paid', 500);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'state after paying (expect approved)';
  if v_state = 'approved' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_2', 'refunded', -500);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'state after refund (expect not_started)';
  if v_state = 'not_started' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  -- ── Round 4: uq_otpe_object must not block a second partial refund ────
  -- charge.refunded fires once per Stripe refund and carries a CUMULATIVE
  -- amount_refunded, so the webhook records each one as a DELTA -- every
  -- partial refund against the same payment_intent legitimately shares
  -- (provider, provider_object_id, event_type = 'refunded'). Under the
  -- round-1 predicate (no event_type restriction) the second partial
  -- refund's key collided with the first and the insert raised 23505: a
  -- real row, not a Stripe redelivery, permanently unwritable, and (since
  -- 23505 isn't in the webhook's permanent-error list) a ~3-day retry
  -- storm recomputing the same doomed delta. This is the regression this
  -- round exists to prevent: a paid row, then two distinct partial refunds
  -- against the same payment_intent -- both must insert, and the summed
  -- ledger balance must be correct.
  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, provider_object_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_3', 'pi_test_1', 'paid', 1000);

  begin
    insert into public.organized_trip_payment_events
      (trip_id, user_id, requirement_id, provider_event_id, provider_object_id, event_type, amount_usd)
    values (v_trip, v_user, v_req, 'evt_test_4', 'pi_test_1', 'refunded', -300);
    step := 'I2: first partial refund against pi_test_1 inserted';
    value := 'OK: inserted';
  exception when unique_violation then
    step := 'I2: first partial refund against pi_test_1 inserted';
    value := 'FAIL: hit unique_violation (' || sqlerrm || ')';
  end;
  return next;

  begin
    insert into public.organized_trip_payment_events
      (trip_id, user_id, requirement_id, provider_event_id, provider_object_id, event_type, amount_usd)
    values (v_trip, v_user, v_req, 'evt_test_5', 'pi_test_1', 'refunded', -200);
    -- This is the exact insert the round-1 predicate blocked: same
    -- (provider, provider_object_id='pi_test_1', event_type='refunded') as
    -- evt_test_4 above, distinct provider_event_id, distinct amount.
    step := 'I2: second partial refund, same pi_test_1, distinct event id (old predicate blocked this)';
    value := 'OK: inserted';
  exception when unique_violation then
    step := 'I2: second partial refund, same pi_test_1, distinct event id (old predicate blocked this)';
    value := 'FAIL: hit unique_violation (' || sqlerrm || ')';
  end;
  return next;

  -- Raw ledger sum for (v_trip, v_user, v_req): +500 (evt_test_1 paid)
  -- -500 (evt_test_2 refund) +1000 (evt_test_3 paid) -300 (evt_test_4)
  -- -200 (evt_test_5) = 500.
  select coalesce(sum(amount_usd), 0) into v_due
    from public.organized_trip_payment_events
   where trip_id = v_trip and user_id = v_user and requirement_id = v_req;

  step := 'I2: summed ledger balance after paid 1000 + 2 partial refunds (expect 500)';
  if v_due = 500 then value := 'OK: ' || v_due;
  else value := 'FAIL: ' || coalesce(v_due::text, 'null'); end if;
  return next;

  -- ── Guard rails ──────────────────────────────────────────────────────
  begin
    update public.group_trips set payment_mode = 'offline' where id = v_trip;
    insert into public.organized_trip_requirements
      (trip_id, kind, req_type, title, skip_at_onboarding, is_active)
    values (v_trip, 'balance', 'pay', 'Balance', 'must_have', true);
    step := 'guard: pay row on offline trip'; value := 'FAIL: was allowed'; return next;
  exception when others then
    step := 'guard: pay row on offline trip'; value := 'OK: refused (' || sqlerrm || ')'; return next;
  end;

  begin
    update public.group_trips
       set payment_mode = 'managed'
     where id = (select id from public.group_trips where hosting_style <> 'C' limit 1);
    step := 'guard: managed mode on peer trip'; value := 'FAIL: was allowed'; return next;
  exception when others then
    step := 'guard: managed mode on peer trip'; value := 'OK: refused (' || sqlerrm || ')'; return next;
  end;

  -- Guard test 1 flipped v_trip back to offline; restore for clarity
  -- (not load-bearing for what follows -- is_trip_host does not consult
  -- payment_mode).
  update public.group_trips set payment_mode = 'managed' where id = v_trip;

  -- ── C1: freeze trigger is authoritative on UPDATE ──────────────────────
  -- Round 7: read the OPERATOR OF RECORD explicitly. This used to be an
  -- unordered `select user_id from group_trip_participants where role='host'
  -- limit 1`, which passes today only because this trip happens to have
  -- exactly one host -- the day it gains an admin, that pick can return the
  -- ADMIN and every assertion below fails for a reason that has nothing to do
  -- with what they test. group_trips.host_id is the identity these assertions
  -- actually mean, and it is single by construction.
  select host_id into v_host from public.group_trips where id = v_trip;

  -- Round 2: pin distinctness explicitly rather than trust `limit 1`
  -- ordering not to collide with v_user (it wouldn't silently pass either
  -- way -- a collision fails the assertions below -- but a named check
  -- here is the actual guarantee, not luck).
  if v_host is null or v_host = v_user then
    step := 'C1 fixture';
    value := 'FAIL: no host distinct from the traveler was found (host=' || coalesce(v_host::text, 'null') || ', user=' || v_user::text || ')';
    return next;
    return;
  end if;

  -- Impersonate the non-host traveler exactly as PostgREST would: role
  -- authenticated + request.jwt.claims carrying their uid. RLS's own
  -- UPDATE policy is `using (auth.uid() = user_id)`, i.e. self-only, so
  -- this is also a live test that the write reaches the trigger at all.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  set local role authenticated;
  update public.group_trip_participants
     set price_total_usd = 0, deposit_usd = 0
   where trip_id = v_trip and user_id = v_user;
  get diagnostics v_rows = row_count;
  reset role;

  -- Round 2: assert the UPDATE actually matched a row. Without this, "price
  -- unchanged" is equally consistent with "the trigger reverted it" and
  -- "the UPDATE matched nothing" -- only the row_count check tells them
  -- apart.
  if v_rows = 1 then
    step := 'C1: non-host UPDATE reached exactly one row'; value := 'OK: row_count=1';
  else
    step := 'C1: non-host UPDATE reached exactly one row'; value := 'FAIL: row_count=' || v_rows;
  end if;
  return next;

  select price_total_usd, deposit_usd into v_price, v_dep
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_user;

  if v_price = 2000 and v_dep = 500 then
    step := 'C1: non-host PATCH price/deposit=0 on own row';
    value := 'OK: unchanged (' || v_price || '/' || v_dep || ')';
  else
    step := 'C1: non-host PATCH price/deposit=0 on own row';
    value := 'FAIL: bypass succeeded (' || coalesce(v_price::text, 'null') || '/' || coalesce(v_dep::text, 'null') || ')';
  end if;
  return next;

  -- Same shape of write, impersonating the host, on the host's own row.
  -- This is the load-bearing path a later task (operator edits a
  -- traveler's price) depends on staying open.
  perform set_config('request.jwt.claims', json_build_object('sub', v_host)::text, true);
  set local role authenticated;
  update public.group_trip_participants
     set price_total_usd = 1234, deposit_usd = 333
   where trip_id = v_trip and user_id = v_host;
  get diagnostics v_rows = row_count;
  reset role;

  if v_rows = 1 then
    step := 'C1: host UPDATE reached exactly one row'; value := 'OK: row_count=1';
  else
    step := 'C1: host UPDATE reached exactly one row'; value := 'FAIL: row_count=' || v_rows;
  end if;
  return next;

  select price_total_usd, deposit_usd into v_price, v_dep
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_host;

  if v_price = 1234 and v_dep = 333 then
    step := 'C1: host PATCH price=1234/deposit=333 on own row';
    value := 'OK: sticks (' || v_price || '/' || v_dep || ')';
  else
    step := 'C1: host PATCH price=1234/deposit=333 on own row';
    value := 'FAIL: host write was blocked (' || coalesce(v_price::text, 'null') || '/' || coalesce(v_dep::text, 'null') || ')';
  end if;
  return next;

  -- The impersonation above set request.jwt.claims (is_local = true, so it
  -- otherwise lives for the rest of THIS transaction, not just the two
  -- statements above). Clear it now so every later `select`/`insert` below
  -- runs as the trusted/service-role branch (auth.uid() is null) rather
  -- than silently inheriting "acting as v_host" -- which would misclassify
  -- the v_trip2 inserts below as a non-host write the moment v_host turns
  -- out not to be a host of v_trip2.
  perform set_config('request.jwt.claims', '', true);

  -- ── Round 2 critical regression: no price configured anywhere ─────────
  -- greatest(..., 0) (round 1) silently turned "cost_per_person is null AND
  -- price_total_usd is null" into a due amount of 0, which reads as
  -- approved. This is the exact scenario: an operator flips an existing
  -- trip to managed before filling in a price, and every traveler who
  -- joined while it was offline (frozen columns still null, per the
  -- freeze trigger's own offline no-op) must NOT read as paid.
  select id into v_trip2 from public.group_trips where hosting_style = 'C' order by id offset 1 limit 1;

  -- Round 3: assert v_trip2 <> v_trip explicitly. Both are now pinned by
  -- `order by id` (v_trip is row 1, v_trip2 is row 2), so a collision here
  -- would mean there is only one operator trip in prod, not an ordering
  -- accident -- but the report's claim that this case "doesn't disturb
  -- v_trip's state" must be an enforced fact, not an assumption.
  if v_trip2 is null or v_trip2 = v_trip then
    step := 'round-2 fixture';
    value := 'FAIL: could not isolate a second operator trip distinct from v_trip (v_trip2=' || coalesce(v_trip2::text, 'null') || ', v_trip=' || v_trip::text || ')';
    return next;
    return;
  end if;

  update public.group_trips
     set payment_mode = 'managed', cost_per_person = null, deposit_amount = null
   where id = v_trip2;

  insert into public.organized_trip_requirements
    (trip_id, kind, req_type, title, skip_at_onboarding, is_active)
  values (v_trip2, 'balance', 'pay', 'Balance', 'must_have', true)
  returning id into v_req2;

  select id into v_user2 from auth.users where id not in (v_user, v_host) order by id limit 1;

  -- v_trip2 is a real live trip and may already have v_user2 as a
  -- participant (unlikely but not impossible with an arbitrary pick from
  -- 792 users). ON CONFLICT DO UPDATE forces the intended null/null fixture
  -- either way, rather than silently reading whatever pre-existing row was
  -- there -- same reasoning applies to v_user3 below.
  insert into public.group_trip_participants (trip_id, user_id, role, price_total_usd, deposit_usd)
  values (v_trip2, v_user2, 'member', null, null)
  on conflict (trip_id, user_id) do update
    set price_total_usd = null, deposit_usd = null;

  select public.operator_traveler_amount_due(v_trip2, v_user2, 'balance') into v_due;
  if v_due is null then
    step := 'CRIT: balance due, managed trip with no price anywhere (expect NULL)'; value := 'OK: null';
  else
    step := 'CRIT: balance due, managed trip with no price anywhere (expect NULL)'; value := 'FAIL: ' || v_due::text;
  end if;
  return next;

  -- This is the ONLY coverage of operator_requirement_pay_state's
  -- `when amount is null then 'not_started'` guard -- the exact line whose
  -- absence is what the round-2 critical was. Must be a real assertion, not
  -- a print: a regression here would emit 'approved' and, print-only, the
  -- run would still read all-green.
  select public.operator_requirement_pay_state(v_trip2, v_user2, v_req2) into v_state;
  step := 'CRIT: pay state, managed trip with no price anywhere (expect not_started)';
  if v_state = 'not_started' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  -- ── I5, the case the trip-level CHECK cannot reach ─────────────────────
  -- Frozen participant total (1000) with NULL deposit_usd, falling back to
  -- a trip deposit_amount (5000) that is larger. group_trips_deposit_not_over_price
  -- only compares the trip's own two columns (5000 <= 6000 here, which is
  -- fine on its own); gtp_deposit_not_over_total only compares the
  -- participant's own two columns (deposit_usd is null, trivially fine).
  -- Neither CHECK sees the cross-table mismatch. Must yield NULL, not a
  -- negative number and not 0.
  update public.group_trips
     set cost_per_person = 6000, deposit_amount = 5000
   where id = v_trip2;

  select id into v_user3 from auth.users where id not in (v_user, v_host, v_user2) order by id limit 1;

  -- auth.uid() is null here (cleared above), so this goes through the
  -- trusted/service-role branch of freeze_traveler_price: explicit price
  -- wins, deposit_usd is left exactly as passed -- i.e. not provided, so
  -- null. ON CONFLICT DO UPDATE for the same reason as v_user2 above.
  insert into public.group_trip_participants (trip_id, user_id, role, price_total_usd, deposit_usd)
  values (v_trip2, v_user3, 'member', 1000, null)
  on conflict (trip_id, user_id) do update
    set price_total_usd = 1000, deposit_usd = null;

  select price_total_usd, deposit_usd into v_price, v_dep
    from public.group_trip_participants
   where trip_id = v_trip2 and user_id = v_user3;
  step := 'mixed-coalesce fixture: participant price/deposit after insert (expect 1000/null)';
  if v_price = 1000 and v_dep is null then
    value := 'OK: ' || coalesce(v_price::text, 'null') || '/' || coalesce(v_dep::text, 'null');
  else
    value := 'FAIL: ' || coalesce(v_price::text, 'null') || '/' || coalesce(v_dep::text, 'null');
  end if;
  return next;

  select public.operator_traveler_amount_due(v_trip2, v_user3, 'balance') into v_due;
  if v_due is null then
    step := 'I5: mixed-coalesce balance, frozen total 1000 vs. trip deposit 5000 (expect NULL)'; value := 'OK: null';
  else
    step := 'I5: mixed-coalesce balance, frozen total 1000 vs. trip deposit 5000 (expect NULL)'; value := 'FAIL: ' || v_due::text;
  end if;
  return next;

  -- ══════════════════════════════════════════════════════════════════
  -- Round 5
  -- ══════════════════════════════════════════════════════════════════

  -- ── I1: is_livemode is actually read ──────────────────────────────────
  -- Fixture on (v_trip, v_user, v_req): every ledger row inserted above took
  -- the is_livemode default of false, and they sum to +500. v_user's frozen
  -- deposit is 500, so the deposit step reads 'approved' while test mode is
  -- what counts. The whole point of the fix is that flipping the switch makes
  -- those same rows stop counting, with nothing deleted.
  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'I1: pay state with app.stripe_livemode unset, test rows sum 500 vs 500 due (expect approved)';
  if v_state = 'approved' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  perform set_config('app.stripe_livemode', 'true', true);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'I1: same rows with app.stripe_livemode = true (expect not_started -- test money stops counting)';
  if v_state = 'not_started' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd, is_livemode)
  values (v_trip, v_user, v_req, 'evt_test_live_1', 'paid', 500, true);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'I1: a real live-mode payment of 500 with the switch on (expect approved)';
  if v_state = 'approved' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  -- Back to the default. nullif('' , '') is why the function uses missing_ok
  -- AND nullif: a GUC that was set and then cleared reads as '' , not NULL,
  -- and ''::boolean raises rather than defaulting. This line is the live test
  -- of that branch -- without the nullif the next call would error, not
  -- return a state.
  perform set_config('app.stripe_livemode', '', true);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'I1: switch cleared to the empty string (expect approved, NOT a 22P02 raise)';
  if v_state = 'approved' then value := 'OK: ' || v_state;
  else value := 'FAIL: ' || coalesce(v_state, 'null'); end if;
  return next;

  -- ── C3: nobody may forge the attribution on their own row ─────────────
  -- Run BEFORE the promotion below, while v_user is still a plain member, so
  -- freeze_traveler_price takes its non-host branch. price_set_by is null on
  -- this row (nothing has set a price through the RPC yet), so "unchanged"
  -- here means "still null".
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  set local role authenticated;
  update public.group_trip_participants
     set price_set_by = v_user, price_set_at = now()
   where trip_id = v_trip and user_id = v_user;
  get diagnostics v_rows = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  select price_set_by into v_setby
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_user;

  step := 'C3: non-host PATCH of price_set_by on own row (expect row_count=1 and still null)';
  if v_rows = 1 and v_setby is null then
    value := 'OK: reverted';
  else
    value := 'FAIL: row_count=' || v_rows || ', price_set_by=' || coalesce(v_setby::text, 'null');
  end if;
  return next;

  -- ── C3 fixture: a promoted admin who is NOT the operator of record ────
  -- This is exactly what "Set as admin" does: role = 'host' on the
  -- participant row, which is the whole of what is_trip_host() reads. It does
  -- NOT touch group_trips.host_id, which is the only identity
  -- payments-checkout ever pays.
  update public.group_trip_participants
     set role = 'host'
   where trip_id = v_trip and user_id = v_user;

  -- Read host_id AFTER the promotion, not before: sync_primary_trip_host is
  -- an AFTER UPDATE trigger on this table that can reassign group_trips.
  -- host_id. It is a no-op here (it only moves when the current host_id
  -- STOPS being a host participant, and promoting someone demotes nobody),
  -- but reading afterwards means this fixture does not depend on that
  -- staying true.
  select host_id into v_operator from public.group_trips where id = v_trip;

  select role into v_state
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_user;

  step := 'C3 fixture: promoted admin has role=host but is not group_trips.host_id';
  if v_state = 'host' and v_operator is not null and v_operator <> v_user then
    value := 'OK: admin=' || v_user::text || ', host_id=' || v_operator::text;
    return next;
  else
    value := 'FAIL: role=' || coalesce(v_state, 'null')
             || ', host_id=' || coalesce(v_operator::text, 'null')
             || ', admin=' || v_user::text;
    return next;
    return;
  end if;

  -- The attack the finding describes, verbatim: a traveler promoted to admin
  -- calls the RPC on THEMSELVES with a price of zero and travels free.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  begin
    set local role authenticated;
    perform public.operator_set_traveler_price(v_trip, v_user, 0, null);
    step := 'C3: promoted admin zeroes their OWN price';
    value := 'FAIL: was allowed';
  exception when others then
    step := 'C3: promoted admin zeroes their OWN price';
    value := 'OK: refused (' || sqlerrm || ')';
  end;
  reset role;
  return next;

  -- Same admin, someone else's row -- isolates the host_id check from the
  -- "nobody prices themselves" check, which the case above trips as well.
  begin
    set local role authenticated;
    perform public.operator_set_traveler_price(v_trip, v_host, 1, null);
    step := 'C3: promoted admin sets ANOTHER traveler''s price';
    value := 'FAIL: was allowed';
  exception when others then
    step := 'C3: promoted admin sets ANOTHER traveler''s price';
    value := 'OK: refused (' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- Reads v_host's row, not v_user's. This assertion previously read
  -- `user_id = v_user` -- the row the PREVIOUS test targets -- so it
  -- re-verified that test's non-effect and left its own "price unmoved" half
  -- completely untested. v_host was set to 1234 by the C1 host-PATCH case.
  select price_total_usd into v_price
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_host;
  if v_price = 1234 then
    value := value || ' [target price still 1234]';
  else
    value := 'FAIL: target price moved to ' || coalesce(v_price::text, 'null');
  end if;
  return next;

  -- ── C3 route 1: the RPC is NOT the only writer ────────────────────────
  -- The whole point of C3 is that `role = 'host'` is the untrusted set, so a
  -- promoted admin bypassing operator_set_traveler_price entirely and just
  -- PATCHing their own participant row is the attack that matters. Nothing
  -- in round 5 covered this, which is exactly why it read clean.
  -- freeze_traveler_price used to wave this through on its
  -- `is_trip_host` branch; it now authorises on group_trips.host_id.
  -- v_user is already promoted to role = 'host' above.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  set local role authenticated;
  update public.group_trip_participants
     set price_total_usd = 0, deposit_usd = 0, price_set_by = v_operator, price_set_at = now()
   where trip_id = v_trip and user_id = v_user;
  get diagnostics v_rows = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  select price_total_usd, deposit_usd, price_set_by into v_price, v_dep, v_setby
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_user;

  step := 'C3 route 1: promoted ADMIN PATCHes own price to 0 and forges price_set_by';
  if v_rows = 1 and v_price = 2000 and v_dep = 500 and v_setby is null then
    value := 'OK: reverted (2000/500, price_set_by still null)';
  else
    value := 'FAIL: bypass succeeded -- row_count=' || v_rows
             || ', price=' || coalesce(v_price::text, 'null')
             || '/' || coalesce(v_dep::text, 'null')
             || ', price_set_by=' || coalesce(v_setby::text, 'null');
  end if;
  return next;

  -- ── C3 route 2: seizing the trip redirects every future payment ───────
  -- payments-checkout resolves operator_payout_accounts for group_trips.
  -- host_id. The `group_trips host can update` policy is
  -- `using/with check (is_trip_host(id))` and the original
  -- guard_primary_trip_host only required the NEW host_id to be a current
  -- host participant -- which a promoted admin is. So this PATCH used to
  -- succeed and hand the admin every traveler payment on the trip.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  begin
    set local role authenticated;
    update public.group_trips set host_id = v_user where id = v_trip;
    step := 'C3 route 2: promoted ADMIN seizes group_trips.host_id';
    value := 'FAIL: was allowed -- all future payments would route to them';
  exception when others then
    step := 'C3 route 2: promoted ADMIN seizes group_trips.host_id';
    value := 'OK: refused (' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return next;

  select host_id into v_setby from public.group_trips where id = v_trip;
  step := 'C3 route 2: host_id is unmoved after the attempt';
  if v_setby = v_operator then value := 'OK: still ' || v_setby::text;
  else value := 'FAIL: host_id is now ' || coalesce(v_setby::text, 'null'); end if;
  return next;


  -- ── C3: the operator of record must still be able to price a traveler ──
  -- The load-bearing positive case. If this fails the feature is dead, not
  -- merely tightened.
  --
  -- C2 first, on the same call: v_req (the trip's only pay row) was
  -- deactivated by trg_deactivate_pay_rows_when_offline during the guard
  -- tests above and never revived, which is exactly the "one single payment"
  -- shape -- no ACTIVE deposit step. Pin it explicitly rather than lean on
  -- that side effect.
  update public.organized_trip_requirements set is_active = false where id = v_req;

  perform set_config('request.jwt.claims', json_build_object('sub', v_operator)::text, true);
  begin
    set local role authenticated;
    perform public.operator_set_traveler_price(v_trip, v_user, 2000, 500);
    step := 'C2: operator sets a deposit on a trip with no ACTIVE deposit step';
    value := 'FAIL: was allowed -- that deposit would be uncollectable';
  exception when others then
    step := 'C2: operator sets a deposit on a trip with no ACTIVE deposit step';
    value := 'OK: refused (' || sqlerrm || ')';
  end;
  reset role;
  return next;

  -- A total with a NULL deposit is the correct shape for that trip, and must
  -- go through.
  begin
    set local role authenticated;
    perform public.operator_set_traveler_price(v_trip, v_user, 1800, null);
    step := 'C2: operator sets total only (null deposit) on a single-payment trip';
    value := 'OK: accepted';
  exception when others then
    step := 'C2: operator sets total only (null deposit) on a single-payment trip';
    value := 'FAIL: refused (' || sqlerrm || ')';
  end;
  reset role;
  return next;

  select price_total_usd, deposit_usd, price_set_by, price_set_at
    into v_price, v_dep, v_setby, v_setat
    from public.group_trip_participants
   where trip_id = v_trip and user_id = v_user;

  step := 'C3: operator''s write stuck AND is attributed (expect 1800/null, set_by=host_id, set_at set)';
  if v_price = 1800 and v_dep is null and v_setby = v_operator and v_setat is not null then
    value := 'OK: 1800/null by ' || v_setby::text;
  else
    value := 'FAIL: ' || coalesce(v_price::text, 'null') || '/' || coalesce(v_dep::text, 'null')
             || ' set_by=' || coalesce(v_setby::text, 'null')
             || ' set_at=' || coalesce(v_setat::text, 'null');
  end if;
  return next;

  -- Revive the deposit step: a real deposit is now collectable, so the same
  -- call must be accepted. Proves the C2 guard is scoped to the actual
  -- absence of a deposit row and is not just refusing every deposit.
  update public.organized_trip_requirements set is_active = true where id = v_req;

  begin
    set local role authenticated;
    perform public.operator_set_traveler_price(v_trip, v_user, 2000, 500);
    step := 'C2: same deposit, once an ACTIVE deposit step exists';
    value := 'OK: accepted';
  exception when others then
    step := 'C2: same deposit, once an ACTIVE deposit step exists';
    value := 'FAIL: refused (' || sqlerrm || ')';
  end;
  reset role;
  return next;

  -- Nobody prices themselves -- not even the operator of record.
  begin
    set local role authenticated;
    perform public.operator_set_traveler_price(v_trip, v_operator, 0, null);
    step := 'C3: operator of record sets their OWN price';
    value := 'FAIL: was allowed';
  exception when others then
    step := 'C3: operator of record sets their OWN price';
    value := 'OK: refused (' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return next;

  -- ══════════════════════════════════════════════════════════════════
  -- Round 7 -- "nobody can remove the owner, and the owner cannot leave"
  -- ══════════════════════════════════════════════════════════════════
  -- Deliberately last: these move real membership, so they would break the
  -- fixture for every operator-impersonating assertion above.
  --
  -- ⚠️ The assertion that stood here in round 6 PERFORMED this seizure and
  -- labelled it the legitimate depth-2 escape -- the suite green-lit the
  -- bypass as expected behaviour. It is replaced, not moved: the same
  -- statement must now be REFUSED.
  --
  -- v_user is the promoted admin; v_operator is group_trips.host_id.

  -- 1. demote_trip_host is SECURITY DEFINER, granted to `authenticated`, and
  --    gated only on is_trip_host -- which the admin passes.
  -- ⚠️ Every one of these asserts on SQLSTATE, not `when others`. 42501
  -- (insufficient_privilege) is section 11's errcode; 23514 (check_violation)
  -- is enforce_min_one_trip_host's. BEFORE row triggers fire in alphabetical
  -- name order, so trg_enforce_min_one_trip_host runs FIRST and on a
  -- single-host trip it is the raiser. A `when others` handler cannot tell
  -- the two apart, and would report "refused" for a fixture that never
  -- reached the code under test at all.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  begin
    set local role authenticated;
    perform public.demote_trip_host(v_trip, v_operator);
    step := 'R7-1: promoted admin demotes the OPERATOR via demote_trip_host';
    value := 'FAIL: was allowed -- host_id would fall to the attacker';
  exception
    when sqlstate '42501' then
      step := 'R7-1: promoted admin demotes the OPERATOR via demote_trip_host';
      value := 'OK: refused by the owner guard (' || sqlerrm || ')';
    when others then
      step := 'R7-1: promoted admin demotes the OPERATOR via demote_trip_host';
      value := 'FAIL: refused, but by something else (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  reset role;
  return next;

  select host_id into v_setby from public.group_trips where id = v_trip;
  select role    into v_state from public.group_trip_participants
   where trip_id = v_trip and user_id = v_operator;
  step := 'R7-1 state: host_id unmoved and the operator is still a host';
  if v_setby = v_operator and v_state = 'host' then
    value := 'OK: host_id=' || v_setby::text || ', role=' || v_state;
  else
    value := 'FAIL: host_id=' || coalesce(v_setby::text, 'null')
             || ', operator role=' || coalesce(v_state, 'null');
  end if;
  return next;

  -- 2. The raw DELETE reaches the same place: the participants DELETE policy
  --    is `auth.uid() = user_id or is_trip_host(trip_id)`.
  begin
    set local role authenticated;
    delete from public.group_trip_participants
     where trip_id = v_trip and user_id = v_operator;
    get diagnostics v_rows = row_count;
    step := 'R7-2: promoted admin DELETEs the OPERATOR''s participant row';
    if v_rows = 0 then
      value := 'FAIL: matched no row -- the owner row was already gone, so this asserted nothing';
    else
      value := 'FAIL: was allowed (row_count=' || v_rows || ') -- host_id would fall to the attacker';
    end if;
  exception
    when sqlstate '42501' then
      step := 'R7-2: promoted admin DELETEs the OPERATOR''s participant row';
      value := 'OK: refused by the owner guard (' || sqlerrm || ')';
    when others then
      step := 'R7-2: promoted admin DELETEs the OPERATOR''s participant row';
      value := 'FAIL: refused, but by something else (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return next;

  select host_id into v_setby from public.group_trips where id = v_trip;
  select role    into v_state from public.group_trip_participants
   where trip_id = v_trip and user_id = v_operator;
  step := 'R7-2 state: host_id unmoved and the operator''s row survives';
  if v_setby = v_operator and v_state = 'host' then
    value := 'OK: host_id=' || v_setby::text || ', role=' || v_state;
  else
    value := 'FAIL: host_id=' || coalesce(v_setby::text, 'null')
             || ', operator role=' || coalesce(v_state, 'null');
  end if;
  return next;

  -- 3. The owner cannot leave either. This is the half that makes the rule an
  --    absolute rather than "only the owner may remove themselves" -- with
  --    the weaker rule, an operator could still walk out and drop host_id on
  --    whoever happened to be next in line.
  --    Exception-only was not enough here, and this is the exact failure mode
  --    that let rounds 5 and 6 read clean. Under the OLD bodies this reported
  --    'FAIL: was allowed' only because R7-1 and R7-2 had already removed the
  --    row, so the DELETE matched zero rows and raised nothing — the right
  --    verdict for entirely the wrong reason, never exercising the attack it
  --    names. So: row_count is checked (zero rows is its own distinct
  --    failure), the errcode is pinned to 42501, and the row is read back
  --    afterwards.
  perform set_config('request.jwt.claims', json_build_object('sub', v_operator)::text, true);
  begin
    set local role authenticated;
    delete from public.group_trip_participants
     where trip_id = v_trip and user_id = v_operator;
    get diagnostics v_rows = row_count;
    step := 'R7-3: the OPERATOR deletes their own participant row (leaves)';
    if v_rows = 0 then
      value := 'FAIL: matched no row -- the owner row was already gone, so this asserted nothing';
    else
      value := 'FAIL: was allowed (row_count=' || v_rows || ')';
    end if;
  exception
    when sqlstate '42501' then
      step := 'R7-3: the OPERATOR deletes their own participant row (leaves)';
      value := 'OK: refused by the owner guard (' || sqlerrm || ')';
    when others then
      step := 'R7-3: the OPERATOR deletes their own participant row (leaves)';
      value := 'FAIL: refused, but by something else (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  reset role;
  return next;

  select role into v_state from public.group_trip_participants
   where trip_id = v_trip and user_id = v_operator;
  step := 'R7-3 state: the operator''s row survives their own leave attempt';
  if v_state = 'host' then value := 'OK: role=' || v_state;
  else value := 'FAIL: operator role=' || coalesce(v_state, 'ROW GONE'); end if;
  return next;

  -- 4. REGRESSION: a non-owner admin must still be demotable and removable,
  --    or this guard has simply broken co-hosting. Uses a THIRD user, so
  --    v_user stays a host and assertion 5 below is not left removing the
  --    last one (enforce_min_one_trip_host would then raise for an unrelated
  --    reason and the result would be meaningless).
  update public.group_trips set max_participants = 100 where id = v_trip;
  insert into public.group_trip_participants (trip_id, user_id, role)
  values (v_trip, v_user2, 'member')
  on conflict (trip_id, user_id) do update set role = 'member';

  begin
    set local role authenticated;
    perform public.promote_trip_host(v_trip, v_user2);
    perform public.demote_trip_host(v_trip, v_user2);
    select role into v_state from public.group_trip_participants
     where trip_id = v_trip and user_id = v_user2;
    step := 'R7-4a: the operator can still demote a NON-owner admin';
    if v_state = 'member' then value := 'OK: back to member';
    else value := 'FAIL: role is ' || coalesce(v_state, 'null'); end if;
  exception when others then
    step := 'R7-4a: the operator can still demote a NON-owner admin';
    value := 'FAIL: refused (' || sqlerrm || ')';
  end;
  reset role;
  return next;

  begin
    set local role authenticated;
    delete from public.group_trip_participants
     where trip_id = v_trip and user_id = v_user2;
    get diagnostics v_rows = row_count;
    step := 'R7-4b: the operator can still remove a NON-owner participant';
    if v_rows = 1 then value := 'OK: removed';
    else value := 'FAIL: row_count=' || v_rows; end if;
  exception when others then
    step := 'R7-4b: the operator can still remove a NON-owner participant';
    value := 'FAIL: refused (' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return next;

  -- 4c. REGRESSION, the most common participant DELETE in the whole app and
  --     asserted nowhere until now: an ordinary member leaving a trip under
  --     their own steam (leaveTrip -> `delete ... where user_id = self`,
  --     allowed by the policy's `auth.uid() = user_id` arm). If §11 were too
  --     broad this is what would break, for every user on every trip, and no
  --     other assertion here would notice.
  insert into public.group_trip_participants (trip_id, user_id, role)
  values (v_trip, v_user2, 'member')
  on conflict (trip_id, user_id) do update set role = 'member';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user2)::text, true);
  begin
    set local role authenticated;
    delete from public.group_trip_participants
     where trip_id = v_trip and user_id = v_user2;
    get diagnostics v_rows = row_count;
    step := 'R7-4c: an ordinary MEMBER can still leave a trip themselves';
    if v_rows = 1 then value := 'OK: left';
    else value := 'FAIL: row_count=' || v_rows; end if;
  exception when others then
    step := 'R7-4c: an ordinary MEMBER can still leave a trip themselves';
    value := 'FAIL: refused (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return next;

  -- 5. The service-role path (auth.uid() is null) must still be able to
  --    remove the owner, because the auth.users ON DELETE CASCADE runs in
  --    exactly that context. If this were blocked, deleting an account would
  --    start failing for every trip that account owns.
  --    v_user is still a host here, so enforce_min_one_trip_host is satisfied
  --    and a failure below can only mean the new guard.
  begin
    delete from public.group_trip_participants
     where trip_id = v_trip and user_id = v_operator;
    get diagnostics v_rows = row_count;
    select host_id into v_setby from public.group_trips where id = v_trip;
    step := 'R7-5: service role (no JWT) may still remove the owner -- account deletion';
    if v_rows = 1 and v_setby = v_user then
      value := 'OK: removed, host_id reassigned to the remaining host';
    else
      value := 'FAIL: row_count=' || v_rows
               || ', host_id=' || coalesce(v_setby::text, 'null');
    end if;
  exception when others then
    step := 'R7-5: service role (no JWT) may still remove the owner -- account deletion';
    value := 'FAIL: blocked (' || sqlerrm || ')';
  end;
  return next;

  -- 6. Deleting the whole trip must still cascade. The FK from
  --    group_trip_participants is ON DELETE CASCADE and deleteGroupTrip()
  --    deletes the group_trips row directly, so the parent is already gone
  --    when the child trigger fires -- which is exactly the `not found`
  --    exemption. Run on v_trip2 (untouched by 1-5) as its own operator.
  select host_id into v_setby from public.group_trips where id = v_trip2;
  insert into public.group_trip_participants (trip_id, user_id, role)
  values (v_trip2, v_setby, 'host')
  on conflict (trip_id, user_id) do update set role = 'host';

  perform set_config('request.jwt.claims', json_build_object('sub', v_setby)::text, true);
  begin
    set local role authenticated;
    delete from public.group_trips where id = v_trip2;
    get diagnostics v_rows = row_count;
    step := 'R7-6: deleting the whole trip still cascades past the owner guard';
    -- "cascaded" was previously CLAIMED and never checked. Assert the child
    -- rows are actually gone: the guard sits on the child table, so a
    -- deleted parent with surviving children is the precise shape of a
    -- half-applied exemption.
    if v_rows <> 1 then
      value := 'FAIL: row_count=' || v_rows;
    elsif exists (select 1 from public.group_trip_participants where trip_id = v_trip2) then
      value := 'FAIL: trip deleted but participant rows survived the cascade';
    else
      value := 'OK: trip deleted, participants verified gone';
    end if;
  exception when others then
    step := 'R7-6: deleting the whole trip still cascades past the owner guard';
    value := 'FAIL: blocked (' || sqlstate || ': ' || sqlerrm || ')';
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return next;

  return;
end;
$$;

select * from pg_temp.__verify_payments();

rollback;
