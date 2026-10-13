-- Operator "Trip Vibe" step (Figma 17317:28362): two yes/no answers about the
-- stay, asked while creating an operator trip.
--
--   stoke_certified        "Do you have a STOKE Certification?"
--   ci_surf_conservation   "Do they participate with CI Surf Conservation?"
--
-- Nullable on purpose: null = never asked (every A/B trip, and every operator
-- trip made before this). The client writes true/false only for operator trips.
-- Columns only — no RLS change, no backfill.

alter table public.group_trips
  add column if not exists stoke_certified boolean,
  add column if not exists ci_surf_conservation boolean;

comment on column public.group_trips.stoke_certified is
  'Operator answered yes to "Do you have a STOKE Certification?". Null = not asked.';
comment on column public.group_trips.ci_surf_conservation is
  'Operator answered yes to "Do they participate with CI Surf Conservation?". Null = not asked.';
