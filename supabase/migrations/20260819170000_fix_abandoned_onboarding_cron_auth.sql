-- Fix `notify-abandoned-onboarding-hourly` (jobid 4): dead since it was created.
--
-- The job's anon JWT was pasted with a LINE BREAK inside it ("…nZXYyIi\n  wicm9sZSI6…"),
-- so every run since 7 June sent a malformed Authorization header and the gateway
-- answered 401 UNAUTHORIZED_INVALID_JWT_FORMAT before the function ever ran.
-- 1,753 runs, all recorded `succeeded` by pg_cron (it only measures the HTTP
-- request being made) — the same blind spot as the 18 Aug dispatcher outage.
-- Last onboarding reminder actually delivered: 6 June, the day before the job
-- existed. It has never sent one.
--
-- Same command, token on ONE line. The anon JWT is INLINE on purpose — the vault
-- holds only admin_function_secret and thumbnail_secret, so reading it from
-- vault would yield NULL (see 20260818000700 for the same note). The anon bearer
-- only satisfies the gateway; authorisation is x-internal-secret.

select cron.alter_job(
  4,
  command := $$
    select net.http_post(
      url := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/notify-abandoned-onboarding',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk',
        'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'admin_function_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- No retro-blast on revival: each reminder bucket only scans users whose
-- created_at just entered its window (1–2h, 24–25h, 7d–7d1h), so everyone the
-- dead job missed stays missed. Verified 0 candidates at fix time.
