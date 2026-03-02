-- Add display and address fields to user_destinations for UI and canonical labels.
-- Populated by geocode-user-destinations from the place name used in the request and Google formatted_address.

ALTER TABLE public.user_destinations
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS formatted_address text;

COMMENT ON COLUMN public.user_destinations.display_name IS 'Place name used for display (e.g. from geocode request or map picker)';
COMMENT ON COLUMN public.user_destinations.formatted_address IS 'Full address string from Google Geocoding/Places API';
