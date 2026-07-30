-- Daily cron for purge-group-documents.
--
-- Same shape as 20260610000100_schedule_trip_reminders.sql: anon bearer to get
-- past the gateway, plus the admin secret from Vault as the real gate.
--
-- 03:20 UTC, chosen to sit away from the 06:07 reminder scan so the two jobs do
-- not compete for the same connection pool.
--
-- After ANY point-in-time restore, run this function once by hand: a restore
-- inside the retention window brings deleted rows and objects back.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-group-documents-daily') THEN
    PERFORM cron.unschedule('purge-group-documents-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'purge-group-documents-daily',
  '20 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/purge-group-documents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
