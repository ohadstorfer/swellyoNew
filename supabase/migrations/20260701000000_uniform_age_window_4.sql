-- Uniform minimum age-range span for group trips: 4 years for every hosting
-- style (was A>=7 / B>=5 / C>=2, which had drifted from the client's
-- validation of A:4 — hosts saw a raw Postgres CHECK error on publish).
-- Must stay in sync with AGE_WINDOW_BY_STYLE in src/screens/trips/CreateTripFlowA.tsx.
--
-- NULL semantics unchanged: one-sided ranges (only min or only max) and
-- "any age" (both NULL) make the expression NULL, which passes the CHECK.
-- Verified 2026-07-01: no existing group_trips row violates the new rule.

alter table public.group_trips
  drop constraint if exists group_trips_age_window_min;

alter table public.group_trips
  add constraint group_trips_age_window_min
  check (age_max - age_min >= 4);
