-- Add admin levels, place types, and geohash buckets to group_trip_destinations
-- so it mirrors the geo-enrichment columns on user_destinations. Populated by
-- the geocode-group-trip-destinations edge function (Google Geocoding API +
-- geohash derived from lat/lng). Enables surfer<->trip matching by region and
-- proximity, and "trips in <state>" style queries.

ALTER TABLE public.group_trip_destinations
  ADD COLUMN IF NOT EXISTS admin_level_1 text,
  ADD COLUMN IF NOT EXISTS admin_level_2 text,
  ADD COLUMN IF NOT EXISTS types text[],
  ADD COLUMN IF NOT EXISTS geo_bucket_4 text,
  ADD COLUMN IF NOT EXISTS geo_bucket_5 text,
  ADD COLUMN IF NOT EXISTS geo_bucket_6 text;

COMMENT ON COLUMN public.group_trip_destinations.admin_level_1 IS
  'administrative_area_level_1 from Google address_components';
COMMENT ON COLUMN public.group_trip_destinations.admin_level_2 IS
  'administrative_area_level_2 from Google address_components';
COMMENT ON COLUMN public.group_trip_destinations.geo_bucket_4 IS
  'Geohash precision 4 derived from lat/lng (~20km cell)';
COMMENT ON COLUMN public.group_trip_destinations.geo_bucket_5 IS
  'Geohash precision 5 derived from lat/lng (~5km cell)';
COMMENT ON COLUMN public.group_trip_destinations.geo_bucket_6 IS
  'Geohash precision 6 derived from lat/lng (~1km cell)';

-- Single-column indexes for flexible querying
CREATE INDEX IF NOT EXISTS group_trip_destinations_geo_bucket_4_idx
  ON public.group_trip_destinations(geo_bucket_4);
CREATE INDEX IF NOT EXISTS group_trip_destinations_geo_bucket_5_idx
  ON public.group_trip_destinations(geo_bucket_5);
CREATE INDEX IF NOT EXISTS group_trip_destinations_geo_bucket_6_idx
  ON public.group_trip_destinations(geo_bucket_6);

-- Composite indexes for common access patterns
CREATE INDEX IF NOT EXISTS group_trip_destinations_country_admin_level_1_idx
  ON public.group_trip_destinations(country, admin_level_1);
CREATE INDEX IF NOT EXISTS group_trip_destinations_country_geo_bucket_5_idx
  ON public.group_trip_destinations(country, geo_bucket_5);
CREATE INDEX IF NOT EXISTS group_trip_destinations_country_geo_bucket_6_idx
  ON public.group_trip_destinations(country, geo_bucket_6);
