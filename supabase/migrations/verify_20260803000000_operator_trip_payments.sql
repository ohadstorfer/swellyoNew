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
-- Round-1 fix verification (2026-08-03) covers, beyond the original happy
-- path:
--   - the freeze trigger actually fired (not the coalesce fallback) --
--     asserted directly on group_trip_participants, then proven stable
--     against a later trip-price change (C1 context, not the vuln itself).
--   - C1 closed: a non-host's own PATCH to price_total_usd/deposit_usd is
--     silently ignored; a host's PATCH still sticks (the load-bearing case
--     a later task depends on).

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

create unique index if not exists uq_otpe_object
  on public.organized_trip_payment_events (provider, provider_object_id, event_type)
  where provider_object_id is not null;

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
  select case p_kind
    when 'deposit' then coalesce(p.deposit_usd, t.deposit_amount)
    when 'balance' then greatest(
                           coalesce(p.price_total_usd, t.cost_per_person)
                         - coalesce(p.deposit_usd, t.deposit_amount, 0),
                           0)
    else null
  end
  from public.group_trips t
  left join public.group_trip_participants p
    on p.trip_id = t.id and p.user_id = p_user_id
  where t.id = p_trip_id;
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
  if auth.uid() is not null and not public.is_trip_host(new.trip_id) then
    if TG_OP = 'UPDATE' then
      new.price_total_usd := old.price_total_usd;
      new.deposit_usd     := old.deposit_usd;
      return new;
    end if;

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

-- ══════════════════════════════════════════════════════════════════
-- Assertions -- returns rows instead of RAISE NOTICE (see header)
-- ══════════════════════════════════════════════════════════════════
create or replace function pg_temp.__verify_payments()
returns table(step text, value text)
language plpgsql
as $$
declare
  v_trip  uuid; v_user uuid; v_host uuid; v_req uuid;
  v_state text; v_due numeric; v_price numeric; v_dep numeric;
begin
  select id into v_trip from public.group_trips where hosting_style = 'C' limit 1;
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
  step := 'participant.price_total_usd after insert (expect 2000)'; value := v_price::text; return next;
  step := 'participant.deposit_usd after insert (expect 500)';      value := v_dep::text;   return next;

  select public.operator_traveler_amount_due(v_trip, v_user, 'deposit') into v_due;
  step := 'deposit due (expect 500)'; value := v_due::text; return next;

  select public.operator_traveler_amount_due(v_trip, v_user, 'balance') into v_due;
  step := 'balance due (expect 1500)'; value := v_due::text; return next;

  update public.group_trips set cost_per_person = 9999 where id = v_trip;

  select public.operator_traveler_amount_due(v_trip, v_user, 'deposit') into v_due;
  step := 'deposit due after trip cost_per_person changed to 9999 (expect still 500)'; value := v_due::text; return next;

  select public.operator_traveler_amount_due(v_trip, v_user, 'balance') into v_due;
  step := 'balance due after trip cost_per_person changed to 9999 (expect still 1500)'; value := v_due::text; return next;

  update public.group_trips set cost_per_person = 2000 where id = v_trip;

  -- ── Ledger / pay-state happy path (unchanged from round 0) ────────────
  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'state before paying (expect not_started)'; value := v_state; return next;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_1', 'paid', 500);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'state after paying (expect approved)'; value := v_state; return next;

  insert into public.organized_trip_payment_events
    (trip_id, user_id, requirement_id, provider_event_id, event_type, amount_usd)
  values (v_trip, v_user, v_req, 'evt_test_2', 'refunded', -500);

  select public.operator_requirement_pay_state(v_trip, v_user, v_req) into v_state;
  step := 'state after refund (expect not_started)'; value := v_state; return next;

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
  select user_id into v_host
    from public.group_trip_participants
   where trip_id = v_trip and role = 'host'
   limit 1;

  if v_host is null then
    step := 'C1 fixture'; value := 'FAIL: no host participant found on test trip'; return next;
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
  reset role;

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
  reset role;

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

  return;
end;
$$;

select * from pg_temp.__verify_payments();

rollback;
