-- Give the per-minute push dispatcher an explicit pg_net timeout.
--
-- Without `timeout_milliseconds` pg_net uses its 5000 ms default. The function
-- is not slow — the cold start is: the job runs once a minute, so the edge
-- worker is evicted between runs and every invocation boots fresh. Measured
-- over 6h on 1 Oct: of 343 runs, 33 (~10%) did not reach the handler until
-- 5s+ after cron fired, with up to 7.5s sitting between the worker logging
-- "Listening" and the runtime handing it the request.
--
-- pg_net giving up does NOT stop the function; it finishes and drains the
-- queue either way. The only casualty was the hourly `cron_http` health check,
-- which counts those as timeouts and went CRITICAL above 2 in an hour
-- (30 Sep 19:07 + 20:07, 29 Sep 20:07 + 22:07, 28 Sep 18:07, ...).
--
-- 20s is well clear of the observed tail and still far below the 60s cadence.
-- This does not weaken the check: a 401/500 still lands in net._http_response
-- as an HTTP error, which cronHttp.ts reports with no tolerance at all.
--
-- Keep the JWT on ONE line. A line-broken JWT in a sibling job command is what
-- made notify-abandoned-onboarding answer 401 hourly for 73 days.

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'dispatch-notification-queue-1min'),
  command := $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/dispatch-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
