-- Update configuration for email notification system
-- This creates the table if it doesn't exist and updates the values

-- IMPORTANT: Replace these with your actual values!
-- Get from: Supabase Dashboard → Settings → API

-- Project Reference: Extract from your Project URL
-- If your URL is: https://rdjzrnzokcfukfyivgzm.supabase.co
-- Then project_ref is: rdjzrnzokcfukfyivgzm

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.email_notification_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS if not already enabled
ALTER TABLE public.email_notification_config ENABLE ROW LEVEL SECURITY;

-- Create policies if they don't exist (drop first to avoid error if exists)
DROP POLICY IF EXISTS "Service role can read config" ON public.email_notification_config;
DROP POLICY IF EXISTS "Service role can write config" ON public.email_notification_config;
DROP POLICY IF EXISTS "Service role only" ON public.email_notification_config;

-- Policy for reading: Allow service_role and postgres (for cron jobs)
CREATE POLICY "Service role can read config" ON public.email_notification_config
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'service_role' 
    OR current_user = 'postgres'
  );

-- Policy for writing: Only service_role
CREATE POLICY "Service role can write config" ON public.email_notification_config
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Insert or update project reference
INSERT INTO public.email_notification_config (key, value) 
VALUES ('project_ref', 'rdjzrnzokcfukfyivgzm')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  updated_at = now();

-- Insert or update service role key (replace with your actual service role key)
INSERT INTO public.email_notification_config (key, value) 
VALUES ('service_role_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjcwNzcxNiwiZXhwIjoyMDc4MjgzNzE2fQ.WDFPKNIlC3SQ32kblnRFQge7nPdRE4BYAMgxr3jN4_A')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  updated_at = now();

-- Verify the settings were updated correctly:
SELECT key, 
  CASE 
    WHEN key = 'service_role_key' THEN 'SET (length: ' || length(value) || ')'
    ELSE value
  END as value_display,
  updated_at
FROM public.email_notification_config
ORDER BY key;

