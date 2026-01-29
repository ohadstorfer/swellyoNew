-- Simplified email queue processor - NO pg_net required!
-- This function only checks for ready batches (for monitoring/debugging)
-- Actual batch processing is done by the edge function when called via external cron
--
-- SETUP: Use an external cron service to call the edge function directly:
--   URL: https://YOUR_PROJECT.supabase.co/functions/v1/send-message-notification
--   Method: POST
--   Body: {"process_batches": true}
--   Schedule: Every 5 minutes
--
-- The edge function will query the database itself and process all ready batches
-- No database function HTTP calls needed!

-- Function to check for ready batches (monitoring/debugging only)
CREATE OR REPLACE FUNCTION process_ready_email_batches()
RETURNS TABLE(ready_count int, batch_ids text[])
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
  RAISE NOTICE '[process_ready_email_batches] Batch IDs: %', array_to_string(ready_batch_ids, ', ');
  RAISE NOTICE '[process_ready_email_batches] NOTE: This function only checks for ready batches.';
  RAISE NOTICE '[process_ready_email_batches] Actual processing is done by edge function called via external cron.';
  RAISE NOTICE '[process_ready_email_batches] Set up cron to call: https://YOUR_PROJECT.supabase.co/functions/v1/send-message-notification';
  RAISE NOTICE '[process_ready_email_batches] With body: {"process_batches": true}';
  
  RETURN QUERY SELECT ready_batch_count, COALESCE(ready_batch_ids, '{}'::text[]);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_ready_email_batches TO service_role;

-- Schedule the cron job to run every 5 minutes
-- Note: This requires pg_cron extension to be enabled
-- Uncomment the following if pg_cron is available:

/*
SELECT cron.schedule(
  'process-ready-email-batches',
  $$*/5 * * * *$$, -- Every 5 minutes
  $$SELECT process_ready_email_batches();$$
);
*/

-- To manually test:
-- SELECT * FROM process_ready_email_batches();
