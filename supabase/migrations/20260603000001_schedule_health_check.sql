-- Run the health-check edge function every hour via pg_cron + pg_net.
-- The function is deployed with --no-verify-jwt and authenticates the caller via
-- the x-healthcheck-token header (HEALTHCHECK_TOKEN secret). It runs all checks,
-- persists a row to health_check_log, and emails the devs on 2 consecutive failures.
--
-- timeout_milliseconds is raised to 15s so pg_net waits for the full response
-- (the checks can take up to ~8s); the function completes server-side regardless.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing job if re-running this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'health-check-hourly') THEN
    PERFORM cron.unschedule('health-check-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'health-check-hourly',
  '0 * * * *',  -- every hour, on the hour
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-healthcheck-token', '2c2fef1c3f6d7040db6e61747d497a57919c5db9f3f32883'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
