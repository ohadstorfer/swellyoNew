-- Schedule the daily Stripe Connect sweep.
--
-- ⚠️ Apply this LAST. `refresh-connect-accounts` must be deployed first, or
--    this cron 404s once a day, forever, silently — and 20260818000600 must be
--    applied first, or the sweep refreshes rows and tells nobody, which is the
--    exact bug it was written to fix.
--
-- ── Why 05:40 UTC ──────────────────────────────────────────────────────────
-- Daily, and off the hour. `notify-abandoned-onboarding` runs at :00 and the
-- storage check was deliberately moved to minute 7 because top-of-hour is a
-- load spike (see PRE_BUILD_CHECKLIST). :40 keeps clear of both, and of
-- purge-group-documents at 03:20, scan-trip-reminders at 06:07,
-- scan-stalled-onboarding at 07:20 and the daily summary at 08:00.
--
-- The time barely affects delivery. `tg_enqueue_push` gives every row a
-- quiet-hours `send_after` per recipient, so a warning found at 05:40 UTC still
-- lands in that operator's morning — except for `charges_disabled` and
-- `blocked`, which are priority 0 and go straight out, because an operator
-- whose payments have stopped is better woken than left selling.

select cron.schedule(
  'refresh-connect-accounts-daily',
  '40 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/refresh-connect-accounts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ⚠️ The anon JWT is INLINE, copied verbatim from `scan-stalled-onboarding-daily`.
-- Reading it from `vault.decrypted_secrets` reads better and would silently
-- break the job: the vault holds only `admin_function_secret` and
-- `thumbnail_secret`, so the subquery returns NULL and `'Bearer ' || NULL` is
-- NULL. Checked, not assumed.
--
-- The anon bearer only satisfies the gateway. Authorisation is the
-- `x-internal-secret` header, which the function checks against
-- ADMIN_FUNCTION_SECRET (it also accepts a service-role bearer).

-- To undo:
--   select cron.unschedule('refresh-connect-accounts-daily');
