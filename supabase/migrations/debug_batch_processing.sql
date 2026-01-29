-- Debug helper queries for batch processing
-- Run these queries in Supabase SQL Editor to troubleshoot

-- 1. Check if configuration is set
SELECT 
  current_setting('app.settings.project_ref', true) as project_ref,
  CASE 
    WHEN current_setting('app.settings.service_role_key', true) IS NOT NULL 
    THEN 'SET (length: ' || length(current_setting('app.settings.service_role_key', true)) || ')'
    ELSE 'NOT SET'
  END as service_role_key_status;

-- 2. List all scheduled batch jobs
SELECT * FROM list_batch_jobs();

-- 3. Check recent message notifications
SELECT 
  id,
  message_id,
  recipient_id,
  sender_id,
  conversation_id,
  batch_id,
  email_sent_at,
  created_at,
  EXTRACT(EPOCH FROM (now() - created_at)) / 60 as minutes_ago
FROM message_email_notifications
ORDER BY created_at DESC
LIMIT 20;

-- 4. Check batch status for a specific batch (replace with actual batch_id)
-- SELECT * FROM check_batch_status('YOUR_BATCH_ID_HERE');

-- 5. Check all pending batches
SELECT 
  batch_id,
  COUNT(*) as message_count,
  MIN(created_at) as oldest_message,
  MAX(created_at) as newest_message,
  EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60 as minutes_since_oldest,
  CASE 
    WHEN COUNT(*) >= 5 THEN true
    WHEN MIN(created_at) < now() - interval '5 minutes' THEN true
    ELSE false
  END as is_ready,
  EXISTS(
    SELECT 1 FROM cron.job 
    WHERE jobname = 'process-batch-' || batch_id::text
  ) as has_scheduled_job
FROM message_email_notifications
WHERE email_sent_at IS NULL
  AND batch_id IS NOT NULL
GROUP BY batch_id
ORDER BY oldest_message DESC;

-- 6. Check if trigger exists
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'message_email_notifications'
  AND trigger_name = 'trigger_schedule_batch_processing';

-- 7. Check if functions exist
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('schedule_batch_processing', 'process_single_batch', 'on_batch_created', 'check_batch_status', 'list_batch_jobs')
ORDER BY routine_name;

-- 8. Test scheduling a batch (replace with actual values)
-- SELECT schedule_batch_processing(
--   'BATCH_ID_HERE'::uuid,
--   'MESSAGE_ID_HERE'::uuid,
--   'CONVERSATION_ID_HERE'::uuid,
--   'SENDER_ID_HERE'::uuid
-- );

-- 9. Check pg_cron extension
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- 10. Check all cron jobs
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active,
  jobid
FROM cron.job
ORDER BY jobid;

