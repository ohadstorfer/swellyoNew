-- group_trip_destinations is now the single source of truth for a trip's
-- location — every trip query embeds it, and the app no longer reads or writes
-- the denormalized mirror columns on group_trips. Drop them.
--
-- destination_spot (text[]) is a separate dead column handled in its own
-- cleanup pass; intentionally left untouched here.
-- Applied 2026-05-31.

alter table public.group_trips
  drop column if exists destination_country,
  drop column if exists destination_area;
