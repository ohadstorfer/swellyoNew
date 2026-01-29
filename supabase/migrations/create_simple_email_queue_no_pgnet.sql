-- Simplified email queue processor - NO pg_net required
-- Instead of calling the edge function from the database, we'll use Supabase's built-in
-- cron/webhook system to call the edge function directly
--
-- This approach:
-- 1. Database function just finds ready batches (for monitoring/debugging)
-- 2. Cron job calls edge function directly via HTTP (using Supabase's cron system)
-- 3. Edge function processes batches using its own env vars

-- Function to find ready batches (for monitoring/debugging only)
-- The actual processing is done by the edge function when called via cron
CREATE OR REPLACE FUNCTION process_ready_email_batches()
RETURNS TABLE(processed_count int, batch_ids text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ready_batch_count int;
  ready_batch_ids text[];
BEGIN
  RAISE NOTICE '[process_ready_email_batches] Checking for ready batches...';

  -- Find batches that are ready to send
  -- Ready = 5+ minutes old OR 5+ messages
  SELECT 
    COUNT(DISTINCT batch_id),
    ARRAY_AGG(DISTINCT batch_id::text)
  INTO ready_batch_count, ready_batch_ids
  FROM message_email_notifications
  WHERE email_sent_at IS NULL
    AND batch_id IS NOT NULL
  GROUP BY batch_id
  HAVING 
    -- Either 5+ minutes have passed
    MIN(created_at) < now() - interval '5 minutes'
    OR
    -- Or we have 5+ messages
    COUNT(*) >= 5;

  IF ready_batch_count IS NULL THEN
    ready_batch_count := 0;
    ready_batch_ids := '{}'::text[];
  END IF;

  RAISE NOTICE '[process_ready_email_batches] Found % ready batches', ready_batch_count;
  RAISE NOTICE '[process_ready_email_batches] Note: Actual processing is done by edge function called via cron/webhook';
  RAISE NOTICE '[process_ready_email_batches] Set up a cron job or webhook to call: https://YOUR_PROJECT.supabase.co/functions/v1/send-message-notification';
  RAISE NOTICE '[process_ready_email_batches] With body: {"process_batches": true}';
  
  RETURN QUERY SELECT ready_batch_count, COALESCE(ready_batch_ids, '{}'::text[]);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_ready_email_batches TO service_role;

-- Note: To actually process batches, set up one of these:
--
-- Option 1: Supabase Cron Job (if available)
-- Create a cron job that calls the edge function directly:
-- URL: https://YOUR_PROJECT.supabase.co/functions/v1/send-message-notification
-- Method: POST
-- Body: {"process_batches": true}
-- Schedule: Every 5 minutes
--
-- Option 2: External Cron Service
-- Use a service like cron-job.org or GitHub Actions to call the edge function every 5 minutes
--
-- Option 3: Enable pg_net and use the original approach
-- Run: CREATE EXTENSION IF NOT EXISTS pg_net;
-- Then use the version with net.http_post

-- To manually test (just checks, doesn't process):
-- SELECT * FROM process_ready_email_batches();

