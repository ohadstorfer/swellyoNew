# Simplified Email Notification System

## Overview

The email notification system has been simplified from a complex multi-trigger, cron-scheduling system to a straightforward 3-step flow that's easier to maintain and debug.

## Architecture

```
Message Inserted
    ↓
Database Webhook (Supabase built-in)
    ↓
Edge Function (send-message-notification)
    ↓
Check: Online? Rate limit? → Send immediately OR Queue for batching
    ↓
Simple Cron Job (every 5 min) → Process queued emails
```

## How It Works

### Step 1: Message Arrives
When a message is inserted into the `messages` table:
- Database webhook calls the edge function
- Edge function receives: `message_id`, `conversation_id`, `sender_id`

### Step 2: Edge Function Processing
The edge function:
1. **Checks if recipient should receive email:**
   - User is online? → Skip (they'll see it in-app)
   - Rate limit exceeded? → Skip (already sent email recently)
   - Should send? → Continue

2. **Gets or creates a batch:**
   - Groups messages by: recipient + sender + conversation
   - If batch exists and < 5 minutes old → Add to batch
   - If no batch or batch expired → Create new batch

3. **Creates notification record:**
   - Inserts into `message_email_notifications` table
   - Links to batch_id

4. **Checks if batch is ready:**
   - 5+ minutes old? → Send immediately
   - 5+ messages? → Send immediately
   - Otherwise → Queue for later (cron will process)

### Step 3: Cron Job Processing
Every 5 minutes, a cron job:
- Finds batches that are ready (5+ minutes old OR 5+ messages)
- Calls edge function with `batch_id` parameter
- Edge function processes the batch and sends email

## Features Preserved

✅ **Online Detection** - Skips email if user was online in last 5 minutes  
✅ **Rate Limiting** - Max 1 email per user per 10 minutes  
✅ **Batching** - Groups multiple messages into one email  
✅ **Beautiful Emails** - Same HTML template with sender info, messages, timestamps  

## Setup Instructions

### 1. Run Migrations

Run these migrations in order:

```sql
-- Remove complex triggers (if they exist)
\i supabase/migrations/remove_complex_batch_scheduler.sql

-- Create simple queue processor
\i supabase/migrations/create_simple_email_queue.sql
```

### 2. Set Configuration

Set these database settings (replace with your values):

```sql
-- Get from: Supabase Dashboard → Settings → API
ALTER DATABASE postgres SET app.settings.project_ref = 'YOUR_PROJECT_REF';
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

### 3. Schedule Cron Job

Enable pg_cron extension (if not already enabled):
- Go to Supabase Dashboard → Database → Extensions
- Enable "pg_cron"

Then schedule the job:

```sql
SELECT cron.schedule(
  'process-ready-email-batches',
  '*/5 * * * *', -- Every 5 minutes
  $$SELECT process_ready_email_batches();$$
);
```

### 4. Set Up Database Webhook

Go to Supabase Dashboard → Database → Webhooks:

1. Create new webhook:
   - **Name**: `message-email-notification`
   - **Table**: `messages`
   - **Events**: `INSERT`
   - **Type**: `HTTP Request`
   - **URL**: `https://YOUR_PROJECT_ID.supabase.co/functions/v1/send-message-notification`
   - **HTTP Method**: `POST`
   - **HTTP Headers**:
     - `Authorization: Bearer YOUR_SERVICE_ROLE_KEY`
     - `Content-Type: application/json`
   - **HTTP Body**:
     ```json
     {
       "message_id": "{{ $1.id }}",
       "conversation_id": "{{ $1.conversation_id }}",
       "sender_id": "{{ $1.sender_id }}"
     }
     ```

### 5. Deploy Edge Function

```bash
supabase functions deploy send-message-notification
```

## Testing

### Test 1: Send a Message
1. Send a message in your app
2. Check edge function logs:
   ```bash
   supabase functions logs send-message-notification
   ```
3. Should see: "Added message to batch X for recipient Y"

### Test 2: Check Queued Batches
```sql
SELECT 
  batch_id,
  COUNT(*) as message_count,
  MIN(created_at) as oldest_message,
  EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60 as minutes_old
FROM message_email_notifications
WHERE email_sent_at IS NULL
  AND batch_id IS NOT NULL
GROUP BY batch_id;
```

### Test 3: Manually Process Batches
```sql
SELECT * FROM process_ready_email_batches();
```

## Benefits Over Previous System

- **Simpler**: 3 steps instead of 5+
- **More reliable**: Fewer failure points
- **Easier to debug**: Clear flow, better logging
- **Standard pattern**: Webhook → Function → Queue → Processor
- **Same features**: All original features preserved

## Troubleshooting

### Emails not sending?
1. Check webhook is configured and enabled
2. Check edge function logs for errors
3. Check cron job is scheduled: `SELECT * FROM cron.job WHERE jobname = 'process-ready-email-batches';`
4. Check configuration is set: `SELECT current_setting('app.settings.project_ref', true);`

### Batches not processing?
1. Check cron job is running: `SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-ready-email-batches');`
2. Manually test: `SELECT * FROM process_ready_email_batches();`
3. Check database logs for errors

## Files Changed

- ✅ `supabase/migrations/remove_complex_batch_scheduler.sql` - Removes complex triggers
- ✅ `supabase/migrations/create_simple_email_queue.sql` - Simple queue processor
- ✅ `supabase/functions/send-message-notification/index.ts` - Simplified logic

## Files Removed/Deprecated

- ❌ `supabase/migrations/create_batch_scheduler.sql` - Too complex, replaced
- ❌ Trigger on `message_email_notifications` table - No longer needed

