-- group_trips: replace the old wave_fat_to_barreling slider (0..10) with a
-- multi-select wave_shapes array (soft / wally / barrel). The old column is
-- dropped — existing rows lose their slider value (acceptable: low volume,
-- new UX is the source of truth going forward).

alter table group_trips
  add column if not exists wave_shapes text[];

alter table group_trips
  drop constraint if exists group_trips_wave_shapes_valid;

alter table group_trips
  add constraint group_trips_wave_shapes_valid check (
    wave_shapes is null
    or wave_shapes <@ array['soft', 'wally', 'barrel']::text[]
  );

comment on column group_trips.wave_shapes is
  'Wave shape preferences: any subset of {soft, wally, barrel}. NULL = not specified.';

alter table group_trips
  drop column if exists wave_fat_to_barreling;
