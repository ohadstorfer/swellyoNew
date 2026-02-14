-- Add index for message updates (for efficient UPDATE/DELETE queries)
-- This index supports the real-time message editing and deletion features

CREATE INDEX IF NOT EXISTS idx_messages_conversation_updated 
  ON messages(conversation_id, updated_at DESC)
  WHERE deleted = false;

-- This index helps with:
-- 1. Efficient queries for edited messages (ORDER BY updated_at)
-- 2. Conflict resolution when merging cached and server messages
-- 3. Real-time subscription filtering for UPDATE events


