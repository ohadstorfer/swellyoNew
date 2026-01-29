# Debug Guide for Batch Processing

This guide helps you troubleshoot why batch processing isn't working.

## Step 1: Run the Migration

First, make sure you've run the batch scheduler migration:

```sql
-- Run this in Supabase SQL Editor
\i supabase/migrations/create_batch_scheduler.sql
```

Or copy and paste the contents of `supabase/migrations/create_batch_scheduler.sql` into the SQL Editor.

## Step 2: Set Configuration

You MUST set these configuration values:

```sql
-- Get these from Supabase Dashboard → Settings → API
-- Project URL: https://YOUR_PROJECT_REF.supabase.co
-- Service Role Key: The secret key (not the anon key)

ALTER DATABASE postgres SET app.settings.project_ref = 'YOUR_PROJECT_REF_HERE';
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';
```

## Step 3: Run Debug Queries

Run the queries in `supabase/migrations/debug_batch_processing.sql` to check:

1. **Configuration status** - Are the settings set?
2. **Scheduled jobs** - Are any batch jobs scheduled?
3. **Recent notifications** - Are notifications being created?
4. **Pending batches** - Are there batches waiting to be processed?
5. **Trigger status** - Does the trigger exist?
6. **Function status** - Do all functions exist?

## Step 4: Check Logs

### Database Logs
In Supabase Dashboard → Database → Logs, look for:
- `[on_batch_created]` - Trigger fired
- `[schedule_batch_processing]` - Job scheduled
- `[process_single_batch]` - Job executed

### Edge Function Logs
```bash
supabase functions logs send-message-notification
```

Or in Supabase Dashboard → Edge Functions → `send-message-notification` → Logs

Look for:
- `[Email Notification]` - Request received
- `[getOrCreateBatch]` - Batch creation
- `[isBatchReady]` - Batch readiness check

## Common Issues

### Issue 1: Configuration Not Set
**Symptoms:** Jobs are scheduled but fail with "Configuration missing"
**Fix:** Run the configuration SQL (Step 2)

### Issue 2: Trigger Not Firing
**Symptoms:** No `[on_batch_created]` logs, no jobs scheduled
**Fix:** 
1. Check if trigger exists (debug query #6)
2. Verify `message_email_notifications` table exists
3. Check if notifications are being inserted

### Issue 3: Jobs Not Running
**Symptoms:** Jobs exist but never execute
**Fix:**
1. Check if `pg_cron` extension is enabled
2. Check if jobs are active: `SELECT * FROM cron.job WHERE jobname LIKE 'process-batch-%';`
3. Check cron logs in Supabase Dashboard

### Issue 4: Edge Function Not Called
**Symptoms:** Jobs run but edge function isn't called
**Fix:**
1. Check `project_ref` and `service_role_key` are correct
2. Verify edge function URL is correct
3. Check `pg_net` extension is enabled
4. Check edge function logs for errors

## Testing Manually

### Test 1: Send a Message
1. Send a message in your app
2. Check if notification was created:
```sql
SELECT * FROM message_email_notifications ORDER BY created_at DESC LIMIT 1;
```
3. Check if job was scheduled:
```sql
SELECT * FROM list_batch_jobs();
```

### Test 2: Check Batch Status
```sql
-- Get the batch_id from the notification above
SELECT * FROM check_batch_status('YOUR_BATCH_ID');
```

### Test 3: Manually Trigger Processing
```sql
-- Get values from a notification
SELECT process_single_batch(
  'BATCH_ID'::uuid,
  'MESSAGE_ID'::uuid,
  'CONVERSATION_ID'::uuid,
  'SENDER_ID'::uuid,
  'process-batch-BATCH_ID'::text
);
```

## Expected Flow

1. **Message sent** → Webhook calls edge function
2. **Edge function** → Creates notification record in `message_email_notifications`
3. **Database trigger** → `on_batch_created()` fires
4. **Trigger** → Calls `schedule_batch_processing()` if first message in batch
5. **Scheduler** → Creates cron job to run every minute
6. **Cron job** → Calls `process_single_batch()` every minute
7. **Process function** → Checks if batch is ready (5 minutes or 5 messages)
8. **If ready** → Calls edge function via `pg_net`
9. **Edge function** → Sends email and marks notifications as sent
10. **Process function** → Unschedules the job

## Next Steps

If it's still not working after following this guide:

1. Share the output of all debug queries
2. Share the database logs (filter for `[on_batch_created]`, `[schedule_batch_processing]`, `[process_single_batch]`)
3. Share the edge function logs
4. Share any error messages you see

