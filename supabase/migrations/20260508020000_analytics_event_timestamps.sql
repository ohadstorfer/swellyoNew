-- Analytics dashboard: first-event timestamp columns on surfers.
-- One row per user, set ONCE the first time the event happens (idempotent COALESCE writes from the app).
-- Demo users (is_demo_user = true) are filtered out by all dashboard queries.

ALTER TABLE surfers
  ADD COLUMN IF NOT EXISTS onboarding_phase1_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS swelly_first_search_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS swelly_first_match_at          TIMESTAMPTZ;

-- Partial indexes: dashboard queries always filter on non-demo and IS NOT NULL.
CREATE INDEX IF NOT EXISTS surfers_onb_phase1_idx
  ON surfers (onboarding_phase1_completed_at)
  WHERE is_demo_user = false AND onboarding_phase1_completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS surfers_onb_completed_idx
  ON surfers (onboarding_completed_at)
  WHERE is_demo_user = false AND onboarding_completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS surfers_swelly_search_idx
  ON surfers (swelly_first_search_at)
  WHERE is_demo_user = false AND swelly_first_search_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS surfers_swelly_match_idx
  ON surfers (swelly_first_match_at)
  WHERE is_demo_user = false AND swelly_first_match_at IS NOT NULL;

-- Best-effort backfill for users who already finished onboarding before this migration.
UPDATE surfers
SET onboarding_completed_at = updated_at
WHERE finished_onboarding = true
  AND onboarding_completed_at IS NULL;

-- Best-effort backfill for users who already created Swelly matches.
-- A Swelly match = a direct conversation where one member has adv_role = 'adv_seeker'.
UPDATE surfers s
SET swelly_first_match_at = sub.first_match
FROM (
  SELECT cm.user_id, MIN(c.created_at) AS first_match
  FROM conversations c
  JOIN conversation_members cm
    ON cm.conversation_id = c.id
   AND cm.adv_role = 'adv_seeker'
  WHERE c.is_direct = true
  GROUP BY cm.user_id
) sub
WHERE s.user_id = sub.user_id
  AND s.swelly_first_match_at IS NULL;
