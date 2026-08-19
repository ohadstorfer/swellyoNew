-- The stalled-onboarding scan moves from daily to hourly.
--
-- Not tidying: the re-timed ladder (20260819000400) sends its first nudge four
-- hours after the traveler's last action, and on a `20 7 * * *` schedule "four
-- hours" would have quietly resolved to "some time tomorrow morning". The whole
-- change would have looked applied and done nothing.
--
-- Minute 20 is kept. The health check runs at :07, the push dispatcher every
-- minute, and the top of the hour already carries notify-abandoned-onboarding —
-- there is no reason to add a third thing to :00.
--
-- The job is edited in place rather than unscheduled and re-created: jobid 8 is
-- referenced by name in 20260818000700 (which copied its inlined anon JWT
-- verbatim) and re-creating it would hand out a new id for nothing. The command
-- is untouched.

select cron.alter_job(8, schedule => '20 * * * *');

-- ⚠️ The job is still NAMED `scan-stalled-onboarding-daily`, and now runs
-- hourly. Renaming it needs `update cron.job`, which the migration role is not
-- permitted to do (42501 — the table is owned by the postgres superuser, and
-- `cron.alter_job` has no rename argument). Nothing reads the name —
-- `health_cron_http_failures` matches on the HTTP response, not the job — so
-- the only cost is a misleading label. Read the schedule, not the name.
--
-- ✅ APPLIED to prod 2026-08-19.
