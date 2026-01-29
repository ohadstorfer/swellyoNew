-- Fix RLS policy to allow postgres user (cron jobs) to read config
-- SECURITY DEFINER functions should bypass RLS, but let's be explicit

-- Drop existing policies
DROP POLICY IF EXISTS "Service role can read config" ON public.email_notification_config;
DROP POLICY IF EXISTS "Service role can write config" ON public.email_notification_config;
DROP POLICY IF EXISTS "Service role only" ON public.email_notification_config;

-- Grant SELECT to postgres role (for cron jobs)
GRANT SELECT ON public.email_notification_config TO postgres;

-- Policy for reading: Allow service_role and postgres (for cron jobs)
-- Also allow if no JWT (for SECURITY DEFINER functions)
CREATE POLICY "Allow config read" ON public.email_notification_config
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'service_role' 
    OR current_user = 'postgres'
    OR auth.jwt() IS NULL  -- For SECURITY DEFINER functions
  );

-- Policy for writing: Only service_role
CREATE POLICY "Service role can write config" ON public.email_notification_config
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Verify the grants
SELECT 
  grantee, 
  privilege_type 
FROM information_schema.role_table_grants 
WHERE table_schema = 'public' 
  AND table_name = 'email_notification_config';

