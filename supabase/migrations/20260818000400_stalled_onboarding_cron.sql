-- Schedule the stalled-onboarding scanner.
--
-- ✅ APPLIED to prod 2026-08-18, on Ohad's explicit say-so, as jobid 8.
--
--    Both prerequisites were deployed first, in this order:
--
--      1. `scan-stalled-onboarding` (new — without it this cron would 404 once
--         a day, forever, silently).
--      2. `dispatch-notification-queue` — its live copy was BEHIND the repo,
--         and it holds the copy for both new types. Without the deploy every
--         nudge would render as the default fallback, "You have a new trip
--         update", which is worse than not sending it. Checked before
--         deploying: the only pending change besides the new cases was one
--         unreachable `operator_requirement_due_soon` fallback from c9ef9a1,
--         so nothing existing moved. Confirmed healthy afterwards — the
--         once-a-minute job kept returning 200.
--
--    Then the function was invoked once by hand, with these exact headers, as
--    a live smoke test: 200, `{"travelerNudges":0,"operatorDigests":0}`. That
--    also proves the service-role path end to end — see the `auth.uid() is
--    null` note in 20260818000300, without which it would have found nobody.
--
--    It turned on quiet, by design: prod had ZERO stalled onboarders (all 8
--    participants across the type-C trips were 'active'), so the first runs
--    send nothing.
--
-- ── Why 07:20 UTC ──────────────────────────────────────────────────────────
-- Daily, and off the hour. `notify-abandoned-onboarding` runs at :00 and the
-- storage check was moved to minute 7 precisely because top-of-hour is a load
-- spike — see PRE_BUILD_CHECKLIST. :20 keeps it clear of both, and clear of
-- scan-trip-reminders at 06:07.
--
-- The time barely affects delivery: `tg_enqueue_push` gives every row a
-- quiet-hours `send_after` per recipient, so a nudge scanned at 07:20 UTC still
-- lands in the recipient's morning, not their 3am.

select cron.schedule(
  'scan-stalled-onboarding-daily',
  '20 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/scan-stalled-onboarding',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ⚠️ The anon JWT is INLINE, copied verbatim from `scan-trip-reminders-daily`.
-- The first draft of this file read it from `vault.decrypted_secrets` as
-- 'anon_key', which reads better — and would have silently broken the job:
-- the vault holds only `admin_function_secret` and `thumbnail_secret`, so the
-- subquery returns NULL and `'Bearer ' || NULL` is NULL. Checked, not assumed.
--
-- The anon bearer only satisfies the gateway. Authorisation is the
-- `x-internal-secret` header, which the function checks against
-- ADMIN_FUNCTION_SECRET (it also accepts a service-role bearer).

-- To undo:
--   select cron.unschedule('scan-stalled-onboarding-daily');
