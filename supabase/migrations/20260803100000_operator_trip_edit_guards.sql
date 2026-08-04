-- Operator "Edit trip" screen — the two guards the client cannot enforce alone.
-- Spec: docs/specs/operator-trips/operator-trip-edit.md §7.1 and §7.2
--
-- APPLY BY HAND. Never `supabase db push` on this project — 168 local files are
-- unregistered and a push would replay them.
--   supabase db query --linked -f supabase/migrations/20260803100000_operator_trip_edit_guards.sql

begin;

-- ══════════════════════════════════════════════════════════════════
-- 1. Capacity floor
-- ══════════════════════════════════════════════════════════════════
-- participant_count is trigger-maintained and includes the host, so it is the
-- same number the UI shows as "X/Y going". A trigger, not a CHECK: a CHECK
-- cannot be added to a table that already violates it, and trips that are
-- already over capacity exist. This only guards the transition.
create or replace function public.tg_group_trips_capacity_floor()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  if new.max_participants is not null
     and new.max_participants < coalesce(old.max_participants, new.max_participants)
     and new.max_participants < coalesce(new.participant_count, 0)
  then
    raise exception
      'max_participants (%) is below the % people already on this trip',
      new.max_participants, new.participant_count
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- SECURITY INVOKER keeps this off the PostgREST RPC surface for anon, but
-- `create or replace` still hands PUBLIC an execute grant every time.
revoke execute on function public.tg_group_trips_capacity_floor() from public, anon;

drop trigger if exists trg_group_trips_capacity_floor on public.group_trips;
create trigger trg_group_trips_capacity_floor
  before update of max_participants on public.group_trips
  for each row
  execute function public.tg_group_trips_capacity_floor();

-- ══════════════════════════════════════════════════════════════════
-- 2. Freeze existing travelers' prices
-- ══════════════════════════════════════════════════════════════════
-- Call this BEFORE writing a new cost_per_person. Every joined traveler whose
-- price_total_usd is still null is pinned to the price they joined at, so the
-- edit applies to new bookings only.
--
-- trg_freeze_traveler_price (section 8 of 20260803000000) already does this at
-- JOIN time — but only for payment_mode = 'managed'; on an offline trip it
-- writes null deliberately. This function covers the rows that trigger left
-- null: everyone who joined before the operator switched collection on.
--
-- SECURITY DEFINER because the only UPDATE policy on group_trip_participants is
-- self-only (auth.uid() = user_id) — a host has no RLS path to another
-- traveler's row. Same reason operator_set_traveler_price is definer. The
-- UPDATE below passes cleanly through trg_freeze_traveler_price: its UPDATE
-- branch leaves a host's write untouched.
--
-- host_id, NOT is_trip_host(). This mirrors the C3 ruling already applied to
-- operator_set_traveler_price (20260803000100): `is_trip_host` is flat
-- multi-host and includes every promoted admin, while `group_trips.host_id` is
-- the single operator of record — the one `operator_payout_accounts` pays.
-- This function writes the same money columns, so it takes the same gate.
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
  select payment_mode, cost_per_person, deposit_amount
    into v_mode, v_price, v_deposit
    from public.group_trips
   where id = p_trip_id and host_id = auth.uid()
   for update;

  if not found then
    raise exception 'not your trip' using errcode = '42501';
  end if;

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

-- EXECUTE was revoked from public project-wide, so without this grant every
-- client call is a 403. The revoke comes first because `create or replace`
-- re-grants PUBLIC on every run.
revoke execute on function public.operator_freeze_trip_prices(uuid) from public, anon;
grant  execute on function public.operator_freeze_trip_prices(uuid) to authenticated;

commit;
