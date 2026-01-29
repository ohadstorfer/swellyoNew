-- Create batch scheduling functions with comprehensive logging
-- This schedules one-time jobs to process batches after 5 minutes

-- Function to schedule a one-time job to process a batch in 5 minutes
CREATE OR REPLACE FUNCTION schedule_batch_processing(batch_id_param uuid, message_id_param uuid, conversation_id_param uuid, sender_id_param uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_name text;
  sql_command text;
  job_exists boolean;
BEGIN
  RAISE NOTICE '[schedule_batch_processing] Starting - batch_id: %, message_id: %', batch_id_param, message_id_param;
  
  -- Create unique job name based on batch_id
  job_name := 'process-batch-' || batch_id_param::text;
  RAISE NOTICE '[schedule_batch_processing] Job name: %', job_name;

  -- Check if job already exists for this batch
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname = job_name) INTO job_exists;
  
  IF job_exists THEN
    RAISE NOTICE '[schedule_batch_processing] Job % already exists, skipping', job_name;
    RETURN;
  END IF;

  RAISE NOTICE '[schedule_batch_processing] Creating new job: %', job_name;

  -- Build the SQL command
  sql_command := format('SELECT process_single_batch(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L);',
    batch_id_param, message_id_param, conversation_id_param, sender_id_param, job_name);

  RAISE NOTICE '[schedule_batch_processing] SQL command: %', sql_command;

  -- Schedule the job to run every minute (the function will check if it's time)
  BEGIN
    PERFORM cron.schedule(
      job_name,
      '* * * * *', -- Run every minute (the function will check if it's time)
      sql_command
    );
    RAISE NOTICE '[schedule_batch_processing] Successfully scheduled job: %', job_name;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[schedule_batch_processing] Error scheduling job %: %', job_name, SQLERRM;
    RAISE;
  END;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[schedule_batch_processing] Unexpected error: %', SQLERRM;
  RAISE;
END;
$$;

-- Function to process a single batch (called by the scheduled job)
CREATE OR REPLACE FUNCTION process_single_batch(
  batch_id_param uuid,
  message_id_param uuid,
  conversation_id_param uuid,
  sender_id_param uuid,
  job_name_param text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_function_url text;
  service_role_key text;
  project_ref text;
  response_status int;
  response_content text;
  batch_ready boolean;
  oldest_message_time timestamptz;
  message_count int;
  diff_minutes numeric;
  config_error boolean := false;
BEGIN
  RAISE NOTICE '[process_single_batch] Starting - batch_id: %, job_name: %', batch_id_param, job_name_param;

  -- Get configuration
  BEGIN
    project_ref := current_setting('app.settings.project_ref', true);
    service_role_key := current_setting('app.settings.service_role_key', true);
    RAISE NOTICE '[process_single_batch] Config loaded - project_ref: %, service_role_key: % (length: %)', 
      project_ref, 
      CASE WHEN service_role_key IS NOT NULL THEN 'SET' ELSE 'NULL' END,
      CASE WHEN service_role_key IS NOT NULL THEN length(service_role_key) ELSE 0 END;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[process_single_batch] Configuration missing: %', SQLERRM;
    config_error := true;
  END;

  IF config_error OR project_ref IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING '[process_single_batch] Missing configuration, unscheduling job';
    BEGIN
      PERFORM cron.unschedule(job_name_param);
      RAISE NOTICE '[process_single_batch] Job unscheduled due to config error';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[process_single_batch] Error unscheduling job: %', SQLERRM;
    END;
    RETURN;
  END IF;

  edge_function_url := 'https://' || project_ref || '.supabase.co/functions/v1/send-message-notification';
  RAISE NOTICE '[process_single_batch] Edge function URL: %', edge_function_url;

  -- Check if batch still exists and get message count
  SELECT 
    MIN(created_at),
    COUNT(*)
  INTO 
    oldest_message_time,
    message_count
  FROM message_email_notifications
  WHERE batch_id = batch_id_param
    AND email_sent_at IS NULL;

  RAISE NOTICE '[process_single_batch] Batch status - oldest_message_time: %, message_count: %', 
    oldest_message_time, message_count;

  -- If no pending messages, batch was already sent - unschedule and exit
  IF oldest_message_time IS NULL THEN
    RAISE NOTICE '[process_single_batch] No pending messages, batch already sent. Unscheduling job.';
    BEGIN
      PERFORM cron.unschedule(job_name_param);
      RAISE NOTICE '[process_single_batch] Job unscheduled (batch already sent)';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[process_single_batch] Error unscheduling job: %', SQLERRM;
    END;
    RETURN;
  END IF;

  -- Calculate time difference
  diff_minutes := EXTRACT(EPOCH FROM (now() - oldest_message_time)) / 60;
  RAISE NOTICE '[process_single_batch] Time since oldest message: % minutes', diff_minutes;

  -- Check if batch is ready (5 minutes passed OR 5 messages)
  batch_ready := false;
  
  IF message_count >= 5 THEN
    batch_ready := true;
    RAISE NOTICE '[process_single_batch] Batch ready: message count >= 5 (% messages)', message_count;
  ELSIF diff_minutes >= 5 THEN
    batch_ready := true;
    RAISE NOTICE '[process_single_batch] Batch ready: 5 minutes passed (%.2f minutes)', diff_minutes;
  ELSE
    RAISE NOTICE '[process_single_batch] Batch not ready yet - messages: %, minutes: %.2f', message_count, diff_minutes;
  END IF;

  -- If batch is not ready yet, exit (job will run again next minute)
  IF NOT batch_ready THEN
    RAISE NOTICE '[process_single_batch] Exiting, will check again next minute';
    RETURN;
  END IF;

  -- Batch is ready - call edge function
  RAISE NOTICE '[process_single_batch] Batch is ready! Calling edge function...';
  
  BEGIN
    SELECT status, content INTO response_status, response_content
    FROM net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object(
        'message_id', message_id_param,
        'conversation_id', conversation_id_param,
        'sender_id', sender_id_param
      )::text
    );

    RAISE NOTICE '[process_single_batch] Edge function response - status: %, content: %', 
      response_status, 
      CASE WHEN length(response_content) > 200 THEN left(response_content, 200) || '...' ELSE response_content END;

    IF response_status >= 200 AND response_status < 300 THEN
      RAISE NOTICE '[process_single_batch] Batch % processed successfully', batch_id_param;
    ELSE
      RAISE WARNING '[process_single_batch] Failed to process batch %: status %', batch_id_param, response_status;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[process_single_batch] Error calling edge function for batch %: %', batch_id_param, SQLERRM;
  END;

  -- Always unschedule the job after processing (one-time job)
  RAISE NOTICE '[process_single_batch] Unscheduling job: %', job_name_param;
  BEGIN
    PERFORM cron.unschedule(job_name_param);
    RAISE NOTICE '[process_single_batch] Job unscheduled successfully';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[process_single_batch] Error unscheduling job: %', SQLERRM;
  END;

EXCEPTION WHEN OTHERS THEN
  -- Ensure job is unscheduled even on error
  RAISE WARNING '[process_single_batch] Unexpected error: %', SQLERRM;
  BEGIN
    PERFORM cron.unschedule(job_name_param);
    RAISE NOTICE '[process_single_batch] Job unscheduled after error';
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore errors when unscheduling
  END;
  RAISE;
END;
$$;

-- Trigger function to schedule batch processing when a new batch is created
CREATE OR REPLACE FUNCTION on_batch_created()
RETURNS TRIGGER AS $$
DECLARE
  batch_count int;
BEGIN
  RAISE NOTICE '[on_batch_created] Trigger fired - message_id: %, batch_id: %', NEW.message_id, NEW.batch_id;

  -- Count how many messages are in this batch (including the new one)
  SELECT COUNT(*) INTO batch_count
  FROM message_email_notifications
  WHERE batch_id = NEW.batch_id
    AND email_sent_at IS NULL;

  RAISE NOTICE '[on_batch_created] Batch count: %', batch_count;

  -- If this is the first message in a new batch, schedule processing
  -- (batch_count = 1 means this is the first/only message)
  IF batch_count = 1 THEN
    RAISE NOTICE '[on_batch_created] First message in batch, scheduling processing...';
    BEGIN
      PERFORM schedule_batch_processing(
        NEW.batch_id,
        NEW.message_id,
        NEW.conversation_id,
        NEW.sender_id
      );
      RAISE NOTICE '[on_batch_created] Batch processing scheduled successfully';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[on_batch_created] Error scheduling batch processing: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE '[on_batch_created] Not first message in batch (count: %), skipping schedule', batch_count;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[on_batch_created] Unexpected error: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_schedule_batch_processing ON message_email_notifications;
CREATE TRIGGER trigger_schedule_batch_processing
  AFTER INSERT ON message_email_notifications
  FOR EACH ROW
  WHEN (NEW.email_sent_at IS NULL) -- Only for unsent notifications
  EXECUTE FUNCTION on_batch_created();

-- Grant permissions
GRANT EXECUTE ON FUNCTION schedule_batch_processing TO service_role;
GRANT EXECUTE ON FUNCTION process_single_batch TO service_role;

-- Helper function to check batch status (for debugging)
CREATE OR REPLACE FUNCTION check_batch_status(batch_id_param uuid)
RETURNS TABLE(
  batch_id uuid,
  message_count bigint,
  oldest_message_time timestamptz,
  minutes_since_oldest numeric,
  is_ready boolean,
  has_scheduled_job boolean,
  job_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_name_var text;
BEGIN
  job_name_var := 'process-batch-' || batch_id_param::text;
  
  RETURN QUERY
  SELECT 
    batch_id_param,
    COUNT(*)::bigint as message_count,
    MIN(created_at) as oldest_message_time,
    EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60 as minutes_since_oldest,
    CASE 
      WHEN COUNT(*) >= 5 THEN true
      WHEN MIN(created_at) < now() - interval '5 minutes' THEN true
      ELSE false
    END as is_ready,
    EXISTS(SELECT 1 FROM cron.job WHERE jobname = job_name_var) as has_scheduled_job,
    job_name_var as job_name
  FROM message_email_notifications
  WHERE batch_id = batch_id_param
    AND email_sent_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION check_batch_status TO service_role;

-- Helper function to list all scheduled batch jobs
CREATE OR REPLACE FUNCTION list_batch_jobs()
RETURNS TABLE(
  job_id bigint,
  job_name text,
  schedule text,
  command text,
  active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    j.jobid,
    j.jobname::text,
    j.schedule::text,
    j.command::text,
    j.active
  FROM cron.job j
  WHERE j.jobname::text LIKE 'process-batch-%'
  ORDER BY j.jobid;
END;
$$;

GRANT EXECUTE ON FUNCTION list_batch_jobs TO service_role;

