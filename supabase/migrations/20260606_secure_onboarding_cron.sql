-- Security fix #2a: the hourly notify-abandoned-onboarding cron previously
-- called the edge function with only the public anon JWT, so anyone could
-- trigger it. The function now requires an x-internal-secret header matching
-- the ADMIN_FUNCTION_SECRET edge-function secret. This migration reschedules
-- the cron job to send that header, sourcing the value from Supabase Vault so
-- the secret never lands in git.
--
-- PREREQUISITE (run once, NOT committed — do it in the SQL editor):
--   select vault.create_secret('<the-same-value-as-ADMIN_FUNCTION_SECRET>', 'admin_function_secret');
-- The value MUST equal the ADMIN_FUNCTION_SECRET edge-function secret.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing job if re-running.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-abandoned-onboarding-hourly') THEN
    PERFORM cron.unschedule('notify-abandoned-onboarding-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'notify-abandoned-onboarding-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/notify-abandoned-onboarding',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- anon JWT: satisfies the gateway's verify_jwt. Public, not a secret.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      -- shared secret pulled from Vault, matches ADMIN_FUNCTION_SECRET in the fn.
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
