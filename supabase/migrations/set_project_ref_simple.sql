-- Set project_ref in the config table (RLS disabled, no permission issues)
-- This is simpler than ALTER DATABASE SET (which requires superuser privileges)

-- Make sure the table exists and RLS is disabled
CREATE TABLE IF NOT EXISTS public.email_notification_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Disable RLS to avoid permission issues
ALTER TABLE public.email_notification_config DISABLE ROW LEVEL SECURITY;

-- Insert or update project_ref
-- IMPORTANT: Replace 'rfdhtvcmagsbxqntnepv' with your actual project reference!
-- Get it from: Supabase Dashboard → Settings → API → Project URL
INSERT INTO public.email_notification_config (key, value) 
VALUES ('project_ref', 'rfdhtvcmagsbxqntnepv')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  updated_at = now();

-- Verify it was set correctly:
SELECT key, value, updated_at 
FROM public.email_notification_config 
WHERE key = 'project_ref';

