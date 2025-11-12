-- Fix profile_image_url column length issue
-- Run this in Supabase SQL Editor

-- Option 1: Increase the column size (recommended if you expect long URLs)
ALTER TABLE public.surfers 
ALTER COLUMN profile_image_url TYPE varchar(5000);

-- Option 2: If you want to keep it at 2048 but allow longer URLs, use TEXT instead
-- ALTER TABLE public.surfers 
-- ALTER COLUMN profile_image_url TYPE text;

-- Verify the change
SELECT 
    column_name,
    data_type,
    character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'surfers'
AND column_name = 'profile_image_url';


