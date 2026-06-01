-- Flow C "What's included" moves from a flat text[] (price_includes) to a rich
-- nested JSONB structure (price_inclusions). The JSONB is opaque to the DB —
-- never filtered in SQL — so it can grow new categories without a migration.
--
-- See src/services/trips/priceInclusions.ts for the shape.

alter table public.group_trips
  add column if not exists price_inclusions jsonb;

-- The old flat column is superseded — Flow C is the only writer and it's being
-- rebuilt on the new model. Drop it (no production Flow C trips rely on it).
alter table public.group_trips
  drop column if exists price_includes;

comment on column public.group_trips.price_inclusions is
  'Flow C "What''s included" — nested JSONB (meals, accommodation, transportation, '
  'surf sessions/equipment/film, video analysis, activities, wellness, custom). '
  'Opaque to the DB. See src/services/trips/priceInclusions.ts.';
