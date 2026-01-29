-- Remove complex batch scheduling system
-- This migration removes the trigger and functions that were too complex

-- Drop the trigger on message_email_notifications
DROP TRIGGER IF EXISTS trigger_schedule_batch_processing ON message_email_notifications;

-- Drop the trigger function
DROP FUNCTION IF EXISTS on_batch_created();

-- Drop the complex scheduling functions (they will be replaced with simpler ones)
DROP FUNCTION IF EXISTS schedule_batch_processing(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS process_single_batch(uuid, uuid, uuid, uuid, text);

-- Note: We keep check_batch_status and list_batch_jobs as they might be useful for debugging
-- But we can remove them if not needed:
-- DROP FUNCTION IF EXISTS check_batch_status(uuid);
-- DROP FUNCTION IF EXISTS list_batch_jobs();

