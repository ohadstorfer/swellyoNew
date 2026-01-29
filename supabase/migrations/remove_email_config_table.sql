-- Remove email_notification_config table
-- This table is no longer needed as the edge function uses its own environment variables
-- The database function now extracts project_ref from the connection hostname

-- Drop the table if it exists
DROP TABLE IF EXISTS public.email_notification_config CASCADE;

-- Note: This migration removes the config table entirely.
-- The system now works without it:
-- 1. Edge function uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env vars
-- 2. Database function extracts project_ref from connection hostname
-- 3. No configuration table needed!

