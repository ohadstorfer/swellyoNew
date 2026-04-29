-- Group Trips: host_been_there + approximate budget
-- Adds host's prior-visit signal and an approximate per-person budget range
-- so guests can see cost expectations and host familiarity before requesting to join.

alter table public.group_trips
  add column if not exists host_been_there boolean,
  add column if not exists budget_min integer,
  add column if not exists budget_max integer,
  add column if not exists budget_currency text default 'USD';

alter table public.group_trips
  drop constraint if exists group_trips_budget_range_chk;

alter table public.group_trips
  add constraint group_trips_budget_range_chk
  check (budget_min is null or budget_max is null or budget_max >= budget_min);
