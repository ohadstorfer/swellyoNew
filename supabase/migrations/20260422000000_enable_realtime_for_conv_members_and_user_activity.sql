-- Enable Supabase Realtime for conversation_members and user_activity.
--
-- Context:
--   The existing enable_realtime_for_messages.sql only publishes `messages`
--   and `conversations`. Without `conversation_members` in the publication,
--   postgres_changes UPDATE events on last_read_at never reach the other
--   participant, so read receipts (blue double-check in DMs) only update on
--   remount. Publishing `user_activity` lets us also observe last_seen_at
--   changes as a supplementary signal to the Presence API.
--
-- Safety:
--   Idempotent — each block is guarded with pg_publication_tables so re-running
--   the migration is a no-op once the tables are already published.
--
-- Deployment:
--   Per project convention, run this SQL in the Supabase dashboard SQL editor.

-- conversation_members → enables realtime read receipts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_members'
  ) THEN
    RAISE NOTICE 'Realtime is already enabled for conversation_members table';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;
    RAISE NOTICE 'Realtime enabled for conversation_members table';
  END IF;
END $$;

-- user_activity → enables watching last_seen_at as a presence supplement
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_activity'
  ) THEN
    RAISE NOTICE 'Realtime is already enabled for user_activity table';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE user_activity;
    RAISE NOTICE 'Realtime enabled for user_activity table';
  END IF;
END $$;

-- Verify
SELECT schemaname, tablename, pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('conversation_members', 'user_activity')
ORDER BY tablename;
