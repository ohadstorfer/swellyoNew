-- Stay gallery: more than one photo of the accommodation.
--
-- accommodation_image_url stays the MAIN photo (the one every screen and
-- every app build already in the stores reads). The new column holds the
-- extra photos, in order. The stay section on the trip page shows them all
-- as a swipeable gallery: main photo first, then these.
--
-- At most 9 extras (10 photos in total). NULL or empty = no extras.
-- The table already grants SELECT/UPDATE at table level, so the new column
-- needs no grant of its own.

alter table public.group_trips
  add column if not exists accommodation_gallery_urls text[];

alter table public.group_trips
  drop constraint if exists group_trips_accommodation_gallery_max;
alter table public.group_trips
  add constraint group_trips_accommodation_gallery_max
  check (accommodation_gallery_urls is null or coalesce(array_length(accommodation_gallery_urls, 1), 0) <= 9);
