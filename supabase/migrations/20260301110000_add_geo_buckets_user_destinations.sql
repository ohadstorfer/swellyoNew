-- Add geohash-based geo buckets to user_destinations for geo matching.
-- Buckets are derived from (lat, lng) in geocode-user-destinations.

ALTER TABLE public.user_destinations
  ADD COLUMN IF NOT EXISTS geo_bucket_4 text,
  ADD COLUMN IF NOT EXISTS geo_bucket_5 text,
  ADD COLUMN IF NOT EXISTS geo_bucket_6 text;

-- Single-column indexes for flexible querying
CREATE INDEX IF NOT EXISTS idx_user_destinations_geo_bucket_4 ON public.user_destinations(geo_bucket_4);
CREATE INDEX IF NOT EXISTS idx_user_destinations_geo_bucket_5 ON public.user_destinations(geo_bucket_5);
CREATE INDEX IF NOT EXISTS idx_user_destinations_geo_bucket_6 ON public.user_destinations(geo_bucket_6);

-- Composite indexes for common access patterns:
-- spot / fine-grained: country + bucket_6
CREATE INDEX IF NOT EXISTS idx_user_destinations_country_geo_bucket_6
  ON public.user_destinations(country, geo_bucket_6);

-- town / metro: country + bucket_5
CREATE INDEX IF NOT EXISTS idx_user_destinations_country_geo_bucket_5
  ON public.user_destinations(country, geo_bucket_5);

-- state / admin region: country + admin_level_1
CREATE INDEX IF NOT EXISTS idx_user_destinations_country_admin_level_1
  ON public.user_destinations(country, admin_level_1);

