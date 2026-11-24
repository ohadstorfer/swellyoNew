-- Hero gallery: more than one cover photo on a trip.
--
-- hero_image_url stays the MAIN cover (the one Explore, invite previews, the
-- trip chat avatar, every RPC and every app build already in the stores
-- reads). The new column holds the extra cover photos, in order. The trip
-- page swipes through them: main cover first, then these.
--
-- At most 9 extras (10 photos in total). NULL or empty = no extras.
-- Same shape as accommodation_gallery_urls (20261113000100_stay_gallery.sql).
-- The table already grants SELECT/UPDATE at table level, so the new column
-- needs no grant of its own.

alter table public.group_trips
  add column if not exists hero_gallery_urls text[];

alter table public.group_trips
  drop constraint if exists group_trips_hero_gallery_max;
alter table public.group_trips
  add constraint group_trips_hero_gallery_max
  check (hero_gallery_urls is null or coalesce(array_length(hero_gallery_urls, 1), 0) <= 9);
