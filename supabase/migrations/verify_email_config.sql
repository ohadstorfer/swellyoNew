-- Verify email notification configuration
-- Run this to check if the config table exists and has values

-- Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'email_notification_config'
) as table_exists;

-- Check if values exist
SELECT 
  key, 
  CASE 
    WHEN key = 'service_role_key' THEN 'SET (length: ' || length(value) || ')'
    ELSE value
  END as value_display,
  updated_at
FROM public.email_notification_config
ORDER BY key;

-- Test if function can read the config (simulates what the cron job does)
SELECT 
  (SELECT value FROM public.email_notification_config WHERE key = 'project_ref') as project_ref,
  CASE 
    WHEN (SELECT value FROM public.email_notification_config WHERE key = 'service_role_key') IS NOT NULL 
    THEN 'SET (length: ' || length((SELECT value FROM public.email_notification_config WHERE key = 'service_role_key')) || ')'
    ELSE 'NOT SET'
  END as service_role_key_status;

