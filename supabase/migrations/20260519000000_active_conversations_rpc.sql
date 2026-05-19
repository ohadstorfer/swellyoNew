-- =============================================================
-- Active conversations metric for the admin analytics dashboard.
--
-- "Active conversation" = a 1:1 (direct) conversation that has at least one
-- real message (not system, not deleted) whose timestamp falls inside the
-- selected range. Each conversation counts once regardless of message volume.
-- Conversations with any demo or admin participant are excluded, to stay
-- consistent with the rest of the dashboard.
--
-- Sourced live from the `messages` table — NOT analytics_events — so it works
-- retroactively across all history with no instrumentation needed.
--
-- Verify after applying:
--   SELECT count_active_conversations(NULL, NULL);          -- all-time
--   SELECT * FROM active_conversations_series(30);          -- last 30 days
-- =============================================================

-- Total distinct active 1:1 conversations in a range.
-- NULL bound = unbounded on that side (all-time when both are NULL).
CREATE OR REPLACE FUNCTION count_active_conversations(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
) RETURNS bigint AS $$
  SELECT COUNT(DISTINCT m.conversation_id)
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.is_direct = true
    AND NOT COALESCE(m.is_system, false)
    AND NOT COALESCE(m.deleted, false)
    AND m.created_at >= COALESCE(p_from, '-infinity'::timestamptz)
    AND m.created_at <  COALESCE(p_to,   'infinity'::timestamptz)
    AND NOT EXISTS (
      SELECT 1 FROM conversation_members cm
      JOIN surfers s ON s.user_id = cm.user_id
      WHERE cm.conversation_id = c.id
        AND (s.is_demo_user OR s.is_admin)
    )
$$ LANGUAGE sql STABLE;

-- Daily active-conversation counts for the last p_days days (UTC), one row
-- per day that had activity. Powers the dashboard tile's sparkline.
CREATE OR REPLACE FUNCTION active_conversations_series(
  p_days int DEFAULT 30
) RETURNS TABLE(day date, n bigint) AS $$
  SELECT (m.created_at AT TIME ZONE 'UTC')::date AS day,
         COUNT(DISTINCT m.conversation_id)       AS n
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.is_direct = true
    AND NOT COALESCE(m.is_system, false)
    AND NOT COALESCE(m.deleted, false)
    AND m.created_at >= (CURRENT_DATE - (p_days - 1))
    AND NOT EXISTS (
      SELECT 1 FROM conversation_members cm
      JOIN surfers s ON s.user_id = cm.user_id
      WHERE cm.conversation_id = c.id
        AND (s.is_demo_user OR s.is_admin)
    )
  GROUP BY day
  ORDER BY day
$$ LANGUAGE sql STABLE;
