-- Daily "still alive" heartbeat + 24h summary email.
-- Calls the health-check function's ?action=daily-summary once a day. The email
-- ARRIVING is the proof the function + crons are alive; its ABSENCE is the signal
-- something died. The body summarizes the last 24h of hourly runs.
--
-- Time is 08:00 UTC. Change the cron expression to shift it (pg_cron uses the
-- database timezone, normally UTC).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'health-check-daily-summary') THEN
    PERFORM cron.unschedule('health-check-daily-summary');
  END IF;
END $$;

SELECT cron.schedule(
  'health-check-daily-summary',
  '0 8 * * *',  -- every day at 08:00 UTC
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/health-check?action=daily-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-healthcheck-token', '2c2fef1c3f6d7040db6e61747d497a57919c5db9f3f32883'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
