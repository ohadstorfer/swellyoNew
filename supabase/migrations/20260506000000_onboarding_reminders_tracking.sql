-- Track which onboarding-abandonment reminders have been sent to each user.
-- Three independent timestamp columns (one per reminder window) so the cron
-- job can guard each send idempotently without race conditions.

ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS onboarding_reminder_1h_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_reminder_24h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_reminder_7d_sent_at  timestamptz;

-- Partial index keeps the recurring scan cheap: only rows where onboarding
-- isn't finished are ever candidates.
CREATE INDEX IF NOT EXISTS idx_surfers_unfinished_onboarding
  ON public.surfers (created_at)
  WHERE finished_onboarding = false;
