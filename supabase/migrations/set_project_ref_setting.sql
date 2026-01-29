-- Set project_ref in database settings
-- This is a one-time setup - much simpler than a config table (no RLS, no table maintenance)
-- 
-- IMPORTANT: Replace 'YOUR_PROJECT_REF' with your actual project reference!
-- Get it from: Supabase Dashboard → Settings → API → Project URL
-- Example: If your URL is https://rdjzrnzokcfukfyivgzm.supabase.co
--          Then project_ref is: rdjzrnzokcfukfyivgzm

-- Note: This requires superuser privileges, but it's a one-time setup
-- If you don't have superuser access, you'll need to ask your Supabase admin to run this

ALTER DATABASE postgres SET app.settings.project_ref = 'rfdhtvcmagsbxqntnepv';

-- Verify it was set correctly:
SELECT current_setting('app.settings.project_ref', true) as project_ref;

