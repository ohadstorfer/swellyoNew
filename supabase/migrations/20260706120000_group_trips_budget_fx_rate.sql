-- 20260706120000_group_trips_budget_fx_rate.sql
-- Multi-currency pricing: freeze the USD->ILS rate on each trip at price-set time.
-- USD stays canonical in budget_min/budget_max/cost_per_person; this rate derives ₪.

alter table public.group_trips
  add column if not exists budget_fx_rate numeric;

comment on column public.group_trips.budget_fx_rate is
  'ILS per 1 USD, captured once when the price was set/estimated. Never updated. '
  'Used to display ₪ to Israeli viewers. Null = legacy USD-only trip.';

-- Backfill existing rows with a one-time snapshot rate so Israeli viewers see ₪
-- on pre-existing trips too. Safe: all existing amounts are USD, no real operators yet.
update public.group_trips
  set budget_fx_rate = 3.0
  where budget_fx_rate is null;
