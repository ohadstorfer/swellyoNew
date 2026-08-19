-- Schedule the requirement-deadline scanner.
--
-- Prerequisites, in order, before this can be applied:
--   1. `operator_requirement_deadline_owed` — 20260820000000.
--   2. `scan-requirement-deadlines` deployed (CLI). Without it this cron 404s
--      once a day, silently, forever — same trap 20260818000400 documents.
--   3. `dispatch-notification-queue` redeployed if its live copy is behind the
--      repo (it usually is — see reference_dispatch_queue_live_is_behind_repo
--      in agent memory) so operator_requirement_overdue and
--      operator_requirement_overdue_operator render real copy instead of the
--      generic fallback.
--
-- ── Why 07:35 UTC ────────────────────────────────────────────────────────
-- Off the hour, and clear of every other cron: health-check hourly (:07),
-- trip reminders (06:07), stalled-onboarding (07:20), refresh-connect
-- (05:40), purge (03:20), unstick-sending-pushes (every 10 min, unavoidable).
-- 15 minutes after stalled-onboarding so the two never compete for the same
-- trips' rows during a busy minute.
--
-- Quiet-hours delivery is unaffected either way — `tg_enqueue_push` computes
-- each recipient's own `send_after`, so a 07:35 UTC scan still lands in their
-- morning, not their 3am.

select cron.schedule(
  'scan-requirement-deadlines-daily',
  '35 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/scan-requirement-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
      'x-internal-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_function_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To undo:
--   select cron.unschedule('scan-requirement-deadlines-daily');
