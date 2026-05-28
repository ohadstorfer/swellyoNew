-- One-shot SQL backfill: populate geo_bucket_4/5/6 on existing
-- group_trip_destinations rows from their lat/lng. Mirrors the JS geohash
-- encoder in supabase/functions/geocode-user-destinations/index.ts. The helper
-- function is created and dropped within this migration so it doesn't linger.
-- admin_level_1/2 + types are backfilled separately via the
-- admin-backfill-group-trip-destinations edge function (requires Google API).

CREATE OR REPLACE FUNCTION public._tmp_encode_geohash(p_lat double precision, p_lng double precision, p_precision int)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  base32 text := '0123456789bcdefghjkmnpqrstuvwxyz';
  latitude double precision := GREATEST(-90, LEAST(90, p_lat));
  longitude double precision := GREATEST(-180, LEAST(180, p_lng));
  lat_min double precision := -90.0;
  lat_max double precision := 90.0;
  lng_min double precision := -180.0;
  lng_max double precision := 180.0;
  hash text := '';
  is_even boolean := true;
  bit int := 0;
  ch int := 0;
  mid double precision;
BEGIN
  WHILE length(hash) < p_precision LOOP
    IF is_even THEN
      mid := (lng_min + lng_max) / 2;
      IF longitude >= mid THEN
        ch := ch | (1 << (4 - bit));
        lng_min := mid;
      ELSE
        lng_max := mid;
      END IF;
    ELSE
      mid := (lat_min + lat_max) / 2;
      IF latitude >= mid THEN
        ch := ch | (1 << (4 - bit));
        lat_min := mid;
      ELSE
        lat_max := mid;
      END IF;
    END IF;
    is_even := NOT is_even;
    IF bit < 4 THEN
      bit := bit + 1;
    ELSE
      hash := hash || substr(base32, ch + 1, 1);
      bit := 0;
      ch := 0;
    END IF;
  END LOOP;
  RETURN hash;
END;
$$;

UPDATE public.group_trip_destinations
SET
  geo_bucket_4 = public._tmp_encode_geohash(lat, lng, 4),
  geo_bucket_5 = public._tmp_encode_geohash(lat, lng, 5),
  geo_bucket_6 = public._tmp_encode_geohash(lat, lng, 6)
WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_bucket_5 IS NULL;

DROP FUNCTION public._tmp_encode_geohash(double precision, double precision, int);
