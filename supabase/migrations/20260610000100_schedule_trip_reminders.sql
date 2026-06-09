CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-trip-reminders-daily') THEN
    PERFORM cron.unschedule('scan-trip-reminders-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'scan-trip-reminders-daily',
  '7 6 * * *',  -- 06:07 UTC daily; per-user local timing is set at enqueue via next_quiet_window
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/scan-trip-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
