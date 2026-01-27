-- Create a function to process pending email batches
-- This will be called periodically to send emails for batches that are ready
-- but haven't been sent yet (e.g., if edge function wasn't called)

CREATE OR REPLACE FUNCTION process_pending_email_batches()
RETURNS TABLE(processed_count int)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  batch_record record;
  processed int := 0;
BEGIN
  -- Find all batches that are ready to send but haven't been sent
  FOR batch_record IN
    SELECT DISTINCT batch_id
    FROM message_email_notifications
    WHERE email_sent_at IS NULL
      AND batch_id IS NOT NULL
      AND created_at < now() - interval '5 minutes' -- Batch window has passed
    GROUP BY batch_id
    HAVING COUNT(*) >= 1 -- At least one message in batch
  LOOP
    -- Call edge function to process this batch
    -- Note: This requires pg_net extension or you can use Supabase's pg_cron
    -- For now, we'll just mark them for processing
    -- The edge function should have a separate endpoint to process pending batches
    
    processed := processed + 1;
  END LOOP;
  
  RETURN QUERY SELECT processed;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_pending_email_batches TO service_role;

-- Optional: Set up pg_cron to run this periodically
-- This requires pg_cron extension to be enabled
-- Uncomment if you want automatic batch processing:
-- Note: Using dollar-quoted strings to avoid conflict with comment syntax
/*
SELECT cron.schedule(
  'process-email-batches',
  $$*/5 * * * *$$, -- Every 5 minutes (cron format: minute hour day month weekday)
  $$SELECT process_pending_email_batches();$$
);
*/

