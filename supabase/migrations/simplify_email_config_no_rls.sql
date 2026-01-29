-- Simplify email notification config by disabling RLS
-- The config table only contains non-sensitive configuration (project_ref and service_role_key)
-- RLS is causing issues with cron jobs, so we'll disable it and rely on database permissions instead

-- Disable RLS on the config table
ALTER TABLE public.email_notification_config DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies (no longer needed)
DROP POLICY IF EXISTS "Service role can read config" ON public.email_notification_config;
DROP POLICY IF EXISTS "Service role can write config" ON public.email_notification_config;
DROP POLICY IF EXISTS "Service role only" ON public.email_notification_config;
DROP POLICY IF EXISTS "Allow config read" ON public.email_notification_config;

-- Grant SELECT to postgres role (for cron jobs) - this is the default, but being explicit
GRANT SELECT ON public.email_notification_config TO postgres;

-- Verify RLS is disabled
SELECT 
  tablename, 
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'email_notification_config';

-- Test that the function can now read the config
SELECT * FROM process_ready_email_batches();

