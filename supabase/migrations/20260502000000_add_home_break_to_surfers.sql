-- Add home break columns to surfers table.
-- Home break = a surfer's main beach/spot (one per user, identity-level).
-- Source: Google Places API (New). Selected via autocomplete in onboarding.
-- We store both the full formatted_address (display fallback) and a short
-- "{name}, {locality}" version computed at save time, so we never have to
-- re-parse strings at read time.

ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS home_break_place_id  text,
  ADD COLUMN IF NOT EXISTS home_break_full      text,
  ADD COLUMN IF NOT EXISTS home_break_short     text,
  ADD COLUMN IF NOT EXISTS home_break_locality  text,
  ADD COLUMN IF NOT EXISTS home_break_country   text,
  ADD COLUMN IF NOT EXISTS home_break_lat       double precision,
  ADD COLUMN IF NOT EXISTS home_break_lng       double precision;

-- Bound the lat/lng to valid ranges (NULLs allowed, since not every user has
-- set a home break yet).
ALTER TABLE public.surfers
  DROP CONSTRAINT IF EXISTS surfers_home_break_lat_check,
  ADD CONSTRAINT surfers_home_break_lat_check
    CHECK (home_break_lat IS NULL OR (home_break_lat >= -90 AND home_break_lat <= 90));

ALTER TABLE public.surfers
  DROP CONSTRAINT IF EXISTS surfers_home_break_lng_check,
  ADD CONSTRAINT surfers_home_break_lng_check
    CHECK (home_break_lng IS NULL OR (home_break_lng >= -180 AND home_break_lng <= 180));

-- Index country for cheap "users with home break in X" lookups (matching).
CREATE INDEX IF NOT EXISTS idx_surfers_home_break_country
  ON public.surfers(home_break_country)
  WHERE home_break_country IS NOT NULL;

COMMENT ON COLUMN public.surfers.home_break_place_id IS 'Google Places (New) place ID. Refresh if older than ~12 months per Google guidance.';
COMMENT ON COLUMN public.surfers.home_break_full     IS 'Google formattedAddress, e.g. "Ocean Beach, San Diego, CA, USA". Display fallback.';
COMMENT ON COLUMN public.surfers.home_break_short    IS 'Pre-computed display label without state/country, e.g. "Ocean Beach, San Diego".';
COMMENT ON COLUMN public.surfers.home_break_locality IS 'City/town from addressComponents (locality, sublocality_level_1, or postal_town fallback).';
COMMENT ON COLUMN public.surfers.home_break_country  IS '2-letter ISO country code from addressComponents (shortText where types contains "country").';
