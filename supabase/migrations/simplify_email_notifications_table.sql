-- Simplify email notifications table by removing batch functionality
-- This migration removes the batch_id column and related indexes

-- Drop batch-related index if it exists
DROP INDEX IF EXISTS idx_message_notifications_batch;

-- Remove batch_id column
ALTER TABLE public.message_email_notifications
  DROP COLUMN IF EXISTS batch_id;

-- Ensure we have the right index for rate limiting (recipient_id, sender_id, email_sent_at)
-- This index helps with checking last email sent time for rate limiting
CREATE INDEX IF NOT EXISTS idx_message_notifications_recipient_sender_sent
  ON message_email_notifications(recipient_id, sender_id, email_sent_at NULLS FIRST);

-- Verify the changes
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'message_email_notifications'
ORDER BY ordinal_position;

