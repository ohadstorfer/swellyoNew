-- Migration: Convert travel_experience from ENUM to INTEGER
-- This migration converts the travel_experience column from an enum type to an integer type
-- representing the number of trips (0-20+)

-- Step 1: Drop the existing enum constraint and convert to integer
-- First, we need to alter the column type, converting enum values to integers
ALTER TABLE surfers 
ALTER COLUMN travel_experience TYPE integer 
USING CASE 
  WHEN travel_experience::text = 'new_nomad' THEN 0
  WHEN travel_experience::text = 'rising_voyager' THEN 4
  WHEN travel_experience::text = 'wave_hunter' THEN 10
  WHEN travel_experience::text = 'chicken_joe' THEN 20
  ELSE NULL
END;

-- Step 2: Add a check constraint to ensure values are within valid range (0-20+)
-- Optional: Add constraint to ensure values are non-negative
ALTER TABLE surfers
ADD CONSTRAINT travel_experience_check 
CHECK (travel_experience IS NULL OR travel_experience >= 0);

-- Note: If you want to drop the old enum type (after ensuring no other tables use it):
-- DROP TYPE IF EXISTS travel_experience;

