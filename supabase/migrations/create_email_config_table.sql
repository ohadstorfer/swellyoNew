-- Create configuration table for email notifications
-- This avoids needing superuser privileges to set database parameters

CREATE TABLE IF NOT EXISTS public.email_notification_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_notification_config ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can read/write (for security)
CREATE POLICY "Service role only" ON public.email_notification_config
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Insert configuration values
-- IMPORTANT: Replace these with your actual values!
-- Get from: Supabase Dashboard → Settings → API

-- Project Reference: Extract from your Project URL
-- If your URL is: https://rdjzrnzokcfukfyivgzm.supabase.co
-- Then project_ref is: rdjzrnzokcfukfyivgzm
INSERT INTO public.email_notification_config (key, value) VALUES
  ('project_ref', 'rdjzrnzokcfukfyivgzm'),
  ('service_role_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjcwNzcxNiwiZXhwIjoyMDc4MjgzNzE2fQ.WDFPKNIlC3SQ32kblnRFQge7nPdRE4BYAMgxr3jN4_A')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  updated_at = now();

-- Verify the configuration
SELECT key, 
  CASE 
    WHEN key = 'service_role_key' THEN 'SET (length: ' || length(value) || ')'
    ELSE value
  END as value_display
FROM public.email_notification_config
ORDER BY key;

