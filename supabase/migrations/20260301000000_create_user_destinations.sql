-- Geocoded user destinations: one row per resolved place per user.
-- Populated by geocode-user-destinations edge function from surfers.destinations_array.
-- Enables querying by country, admin levels, locality, and distance (lat/lng).

CREATE TABLE IF NOT EXISTS public.user_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id text NOT NULL CHECK (trim(place_id) <> ''),
  lat double precision NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng double precision NOT NULL CHECK (lng >= -180 AND lng <= 180),
  country text,
  admin_level_1 text,
  admin_level_2 text,
  locality text,
  types text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, place_id)
);

COMMENT ON TABLE public.user_destinations IS 'Geocoded places from user onboarding destinations (Google Geocoding API). One row per place per user.';
COMMENT ON COLUMN public.user_destinations.place_id IS 'Google Geocoding API place_id';
COMMENT ON COLUMN public.user_destinations.admin_level_1 IS 'administrative_area_level_1 from address_components';
COMMENT ON COLUMN public.user_destinations.admin_level_2 IS 'administrative_area_level_2 from address_components';

CREATE INDEX IF NOT EXISTS idx_user_destinations_user_id ON public.user_destinations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_destinations_country ON public.user_destinations(country);
CREATE INDEX IF NOT EXISTS idx_user_destinations_country_admin_locality
  ON public.user_destinations(country, admin_level_1, locality)
  WHERE country IS NOT NULL;

ALTER TABLE public.user_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own destinations"
ON public.user_destinations
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own destinations"
ON public.user_destinations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own destinations"
ON public.user_destinations
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own destinations"
ON public.user_destinations
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
