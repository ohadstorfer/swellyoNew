-- Prevent duplicate 1-to-1 conversations between the same two users.
--
-- Adds a canonical sorted pair key to the conversations table and a partial
-- unique index over it. The index only covers is_direct=true rows, so group
-- conversations and incomplete direct conversations (NULL key) are unaffected.

ALTER TABLE conversations
  ADD COLUMN direct_pair_key text;

COMMENT ON COLUMN conversations.direct_pair_key IS
  'Sorted "uid_min:uid_max" pair key for is_direct=true conversations. Enforces 1-to-1 uniqueness via partial unique index.';

-- Backfill: for every is_direct=true conversation with exactly 2 members,
-- compute key = LEAST(uid_a,uid_b) || ':' || GREATEST(uid_a,uid_b).
WITH pairs AS (
  SELECT
    cm.conversation_id,
    LEAST(MIN(cm.user_id::text), MAX(cm.user_id::text)) || ':' ||
    GREATEST(MIN(cm.user_id::text), MAX(cm.user_id::text)) AS pair_key
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  WHERE c.is_direct = true
  GROUP BY cm.conversation_id
  HAVING COUNT(*) = 2
)
UPDATE conversations c
SET direct_pair_key = p.pair_key
FROM pairs p
WHERE p.conversation_id = c.id;

-- Enforce uniqueness for direct conversations only.
CREATE UNIQUE INDEX idx_conversations_direct_pair_unique
  ON conversations (direct_pair_key)
  WHERE is_direct = true AND direct_pair_key IS NOT NULL;
