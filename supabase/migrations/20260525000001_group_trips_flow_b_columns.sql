-- Flow B (hosting_style 'B') trip-creation columns.
-- All nullable, additive, no RLS change. trip_vibe/wave_type are conceptually
-- shared with Flow A. Pricing is a fixed total + optional per-person (distinct
-- from the budget_min/max range used by Flow A); currency reuses budget_currency.

alter table public.group_trips
  add column if not exists trip_vibe text,             -- 'surf' | 'chill' | 'mixed'
  add column if not exists wave_type text,             -- 'reef' | 'beach' | 'point'
  add column if not exists included_components text[],  -- flights|accommodation|surf_spots|meals|activities
  add column if not exists total_cost numeric,
  add column if not exists cost_per_person numeric,
  add column if not exists price_includes text[];       -- accommodation|surf_guide|transport|flights|meals
