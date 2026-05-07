-- Schedule the notify-abandoned-onboarding edge function to run hourly via
-- pg_cron + pg_net. The function decides which users get reminded
-- (1h / 24h / 7d windows) and is idempotent via per-window timestamp columns.
--
-- The Authorization header uses the project's publishable (anon) JWT, which
-- is already shipped to clients via EXPO_PUBLIC_SUPABASE_ANON_KEY — not a
-- secret. The edge function still authenticates with the service role key
-- internally via Deno.env when querying the DB.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing job if re-running this migration.
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk'
    ),
    body := '{}'::jsonb
  );
  $$
);
