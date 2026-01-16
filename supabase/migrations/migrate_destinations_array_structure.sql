-- Migration: Update destinations_array structure
-- Changes from: {destination_name, time_in_days, time_in_text}
-- To: {country, area[], time_in_days, time_in_text}
--
-- This migration:
-- 1. Converts existing destination_name strings to country and area fields
-- 2. Maintains backward compatibility during transition

-- Step 1: Create a function to migrate existing data
CREATE OR REPLACE FUNCTION migrate_destinations_array()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  surfer_record RECORD;
  updated_destinations JSONB;
  destination JSONB;
  dest_name TEXT;
  parts TEXT[];
  country_name TEXT;
  area_parts TEXT[];
  i INTEGER;
BEGIN
  -- Loop through all surfers with destinations_array
  FOR surfer_record IN 
    SELECT user_id, destinations_array 
    FROM public.surfers 
    WHERE destinations_array IS NOT NULL 
      AND jsonb_array_length(destinations_array) > 0
  LOOP
    updated_destinations := '[]'::JSONB;
    
    -- Process each destination in the array
    FOR i IN 0..jsonb_array_length(surfer_record.destinations_array) - 1 LOOP
      destination := surfer_record.destinations_array->i;
      dest_name := destination->>'destination_name';
      
      -- Skip if already migrated (has country field)
      IF destination ? 'country' THEN
        updated_destinations := updated_destinations || destination;
        CONTINUE;
      END IF;
      
      -- Skip if no destination_name
      IF dest_name IS NULL OR dest_name = '' THEN
        updated_destinations := updated_destinations || destination;
        CONTINUE;
      END IF;
      
      -- Parse destination_name: "Country, Area1, Area2, Area3" or "Country, Area"
      parts := string_to_array(dest_name, ',');
      
      -- First part is country
      country_name := trim(parts[1]);
      
      -- Remaining parts are areas (towns)
      area_parts := ARRAY[]::TEXT[];
      IF array_length(parts, 1) > 1 THEN
        FOR i IN 2..array_length(parts, 1) LOOP
          area_parts := array_append(area_parts, trim(parts[i]));
        END LOOP;
      END IF;
      
      -- Build new destination object
      destination := jsonb_build_object(
        'country', country_name,
        'area', CASE WHEN array_length(area_parts, 1) > 0 THEN to_jsonb(area_parts) ELSE '[]'::JSONB END,
        'time_in_days', COALESCE((destination->>'time_in_days')::INTEGER, 0),
        'time_in_text', destination->>'time_in_text'
      );
      
      updated_destinations := updated_destinations || destination;
    END LOOP;
    
    -- Update the surfer record
    UPDATE public.surfers
    SET destinations_array = updated_destinations
    WHERE user_id = surfer_record.user_id;
  END LOOP;
END;
$$;

-- Step 2: Run the migration function
SELECT migrate_destinations_array();

-- Step 3: Drop the migration function (cleanup)
DROP FUNCTION IF EXISTS migrate_destinations_array();

-- Note: The destinations_array column structure is now:
-- [
--   {
--     "country": "Australia",
--     "area": ["Gold Coast", "Byron Bay", "Noosa"],
--     "time_in_days": 84,
--     "time_in_text": "12 weeks"
--   }
-- ]
--
-- The area field is an array that can contain multiple town/area names.
-- If no areas are specified, area will be an empty array [].

