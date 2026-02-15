-- Enable Realtime for messages table
-- This is REQUIRED for postgres_changes subscriptions to work

-- Check if Realtime is already enabled
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'messages'
  ) THEN
    RAISE NOTICE 'Realtime is already enabled for messages table';
  ELSE
    -- Enable Realtime for messages table
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    RAISE NOTICE 'Realtime enabled for messages table';
  END IF;
END $$;

-- Also enable for conversations table (for conversation updates)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'conversations'
  ) THEN
    RAISE NOTICE 'Realtime is already enabled for conversations table';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
    RAISE NOTICE 'Realtime enabled for conversations table';
  END IF;
END $$;

-- Verify Realtime is enabled
SELECT 
  schemaname,
  tablename,
  pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('messages', 'conversations')
ORDER BY tablename;

