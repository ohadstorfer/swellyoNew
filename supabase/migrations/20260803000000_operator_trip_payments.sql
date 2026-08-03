-- Stripe payments for operator trips.
-- Spec: docs/superpowers/specs/2026-08-03-stripe-payments-operator-trips-design.md
--
-- Nothing here modifies an existing column or policy. Every A and B trip, and
-- every existing C trip, behaves exactly as before until an operator opts in.

-- ══════════════════════════════════════════════════════════════════
-- 1. Operator payout identity
-- ══════════════════════════════════════════════════════════════════
alter table public.users
  add column if not exists stripe_account_id      text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists commission_bps         integer not null default 1200;

-- Basis points, so 1200 = 12%. An integer avoids the float-rounding argument
-- entirely when the fee is computed in cents.
alter table public.users
  drop constraint if exists users_commission_bps_range;
alter table public.users
  add constraint users_commission_bps_range
  check (commission_bps between 0 and 10000);

-- ══════════════════════════════════════════════════════════════════
-- 2. Trip-level payment config
-- ══════════════════════════════════════════════════════════════════
-- text, not boolean: an Israeli gateway becomes a third value, not a migration.
alter table public.group_trips
  add column if not exists payment_mode   text not null default 'offline',
  add column if not exists deposit_amount numeric;

alter table public.group_trips
  drop constraint if exists group_trips_payment_mode_check;
alter table public.group_trips
  add constraint group_trips_payment_mode_check
  check (payment_mode in ('offline', 'managed'));

-- Collecting money is an operator-trip feature. Enforced here so no client bug
-- can turn it on for a peer trip.
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

-- ══════════════════════════════════════════════════════════════════
-- 3. Per-traveler price — the order line
-- ══════════════════════════════════════════════════════════════════
-- The trip price is only the default. These columns are what the traveler
-- actually owes, frozen when they join, so a later price edit cannot rewrite
-- an existing traveler's deal.
--
-- Nullable on purpose: rows that existed before this feature stay null and
-- fall back to the trip price. No backfill needed.
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

-- ══════════════════════════════════════════════════════════════════
-- 4. Two new requirement kinds
-- ══════════════════════════════════════════════════════════════════
-- The requirement row is the SCHEDULE only — which step, and when it is due.
-- It carries no amount; amounts are per-traveler (section 3).
alter table public.organized_trip_requirements
  drop constraint if exists organized_trip_requirements_kind_check;
alter table public.organized_trip_requirements
  add constraint organized_trip_requirements_kind_check
  check (kind in ('passport', 'waiver', 'medical', 'insurance',
                  'visa', 'flights', 'custom', 'deposit', 'balance'));

-- A pay row may only exist on an operator trip that is actually collecting.
-- Mirrors trg_passport_requires_operator_trip. A CHECK cannot do this because
-- it may not read another table.
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

-- SECURITY DEFINER keeps the default PUBLIC execute grant. Without this,
-- anon can call it over /rest/v1/rpc/.
revoke execute on function public.enforce_pay_requires_managed_trip() from public, anon;

drop trigger if exists trg_pay_requires_managed_trip on public.organized_trip_requirements;
create trigger trg_pay_requires_managed_trip
  before insert or update of req_type, trip_id
  on public.organized_trip_requirements
  for each row execute function public.enforce_pay_requires_managed_trip();

-- ══════════════════════════════════════════════════════════════════
-- 5. The ledger — append only
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.organized_trip_payment_events (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.group_trips(id) on delete cascade,
  user_id             uuid not null references auth.users(id)          on delete cascade,
  -- SET NULL, not cascade. Every other child of requirements cascades; this one
  -- must not. Deleting a requirement cannot erase the record that someone paid.
  requirement_id      uuid references public.organized_trip_requirements(id) on delete set null,
  provider            text not null default 'stripe',
  provider_event_id   text not null,
  provider_object_id  text,
  event_type          text not null check (event_type in ('paid', 'refunded', 'failed')),
  -- Signed: a refund is negative, so the balance is always a plain sum().
  amount_usd          numeric not null,
  amount_charged      numeric,
  currency_charged    text,
  application_fee_usd numeric,
  created_at          timestamptz not null default now()
);

-- What makes the webhook safe to retry. Stripe redelivers events; the second
-- insert fails on this index and the handler swallows it.
create unique index if not exists uq_otpe_provider_event
  on public.organized_trip_payment_events (provider, provider_event_id);

create index if not exists idx_otpe_lookup
  on public.organized_trip_payment_events (trip_id, user_id, requirement_id);

alter table public.organized_trip_payment_events enable row level security;

revoke all    on public.organized_trip_payment_events from anon, public;
grant  select on public.organized_trip_payment_events to   authenticated;

-- Read only. There is deliberately NO insert/update/delete policy: only the
-- service role (the webhook) writes. Nothing sent from a phone can invent a
-- payment.
drop policy if exists otpe_read_own on public.organized_trip_payment_events;
create policy otpe_read_own on public.organized_trip_payment_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_trip_host(trip_id));

-- ══════════════════════════════════════════════════════════════════
-- 6. What one traveler owes for one step
-- ══════════════════════════════════════════════════════════════════
-- The single server-side home for this arithmetic. tripPaymentsService.ts
-- mirrors it on the client; the two must agree.
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
    when 'balance' then coalesce(p.price_total_usd, t.cost_per_person)
                      - coalesce(p.deposit_usd, t.deposit_amount, 0)
    else null
  end
  from public.group_trips t
  left join public.group_trip_participants p
    on p.trip_id = t.id and p.user_id = p_user_id
  where t.id = p_trip_id;
$$;

revoke execute on function public.operator_traveler_amount_due(uuid, uuid, text) from public, anon;
grant  execute on function public.operator_traveler_amount_due(uuid, uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 7. Pay state — replaces the v1 stub
-- ══════════════════════════════════════════════════════════════════
-- The stub's comment promised: "the payments spec replaces the body with a read
-- of the ledger. The signature never changes." This is that. Every caller of
-- operator_trip_my_requirements keeps working untouched.
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
  )
  select case
    -- No price set for this traveler yet: nothing can be owed, so nothing is due.
    when (select amount from due) is null then 'not_started'
    when (select total from paid) >= (select amount from due) then 'approved'
    else 'not_started'
  end;
$$;

revoke execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) from public, anon;
grant  execute on function public.operator_requirement_pay_state(uuid, uuid, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 8. Freeze the price when a traveler joins
-- ══════════════════════════════════════════════════════════════════
-- Copying the trip price onto the participant row at join time is what makes a
-- later price edit harmless to people already on the trip — the same reason an
-- order line stores its own amount instead of pointing at the product.
create or replace function public.freeze_traveler_price()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_mode text; v_price numeric; v_dep numeric;
begin
  -- An explicit price passed in wins; never overwrite a deliberate value.
  if new.price_total_usd is not null then
    return new;
  end if;

  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_dep
    from public.group_trips
   where id = new.trip_id;

  -- Offline trips carry no prices at all, so there is nothing to freeze.
  if v_mode is distinct from 'managed' then
    return new;
  end if;

  new.price_total_usd := v_price;
  new.deposit_usd     := v_dep;
  return new;
end $$;

revoke execute on function public.freeze_traveler_price() from public, anon;

drop trigger if exists trg_freeze_traveler_price on public.group_trip_participants;
create trigger trg_freeze_traveler_price
  before insert on public.group_trip_participants
  for each row execute function public.freeze_traveler_price();

-- ══════════════════════════════════════════════════════════════════
-- 9. Turning collection OFF must not destroy money history
-- ══════════════════════════════════════════════════════════════════
-- Switching a live trip back to 'offline' hides the pay rows. It deactivates
-- them; it never deletes them. A deleted requirement would leave ledger rows
-- pointing at nothing (requirement_id goes SET NULL), and the trip's payment
-- history would become unreadable.
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

revoke execute on function public.deactivate_pay_rows_when_offline() from public, anon;

drop trigger if exists trg_deactivate_pay_rows_when_offline on public.group_trips;
create trigger trg_deactivate_pay_rows_when_offline
  after update of payment_mode on public.group_trips
  for each row execute function public.deactivate_pay_rows_when_offline();
