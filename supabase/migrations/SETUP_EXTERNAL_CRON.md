# Setup External Cron for Email Batch Processing

Since `pg_net` extension is not available, we'll use an external cron service to call the edge function directly.

## Option 1: Use cron-job.org (Free)

1. Go to https://cron-job.org and create a free account
2. Create a new cron job:
   - **Title**: Process Email Batches
   - **Address**: `https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/send-message-notification`
   - **Schedule**: Every 5 minutes (`*/5 * * * *`)
   - **Request Method**: POST
   - **Request Headers**:
     - `Content-Type: application/json`
     - `X-Internal-Request: true`
   - **Request Body**:
     ```json
     {
       "process_batches": true
     }
     ```
3. Save and activate the cron job

## Option 2: Use GitHub Actions (Free for public repos)

Create `.github/workflows/process-email-batches.yml`:

```yaml
name: Process Email Batches

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:  # Allow manual trigger

jobs:
  process-batches:
    runs-on: ubuntu-latest
    steps:
      - name: Call Edge Function
        run: |
          curl -X POST \
            https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/send-message-notification \
            -H "Content-Type: application/json" \
            -H "X-Internal-Request: true" \
            -d '{"process_batches": true}'
```

## Option 3: Use EasyCron (Free tier available)

1. Go to https://www.easycron.com
2. Create a new cron job with the same settings as Option 1

## Option 4: Use Supabase Database Webhooks (If available)

If Supabase supports scheduled webhooks, you can set one up to call the edge function every 5 minutes.

## Testing

After setting up the cron, test it manually:

```bash
curl -X POST \
  https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/send-message-notification \
  -H "Content-Type: application/json" \
  -H "X-Internal-Request: true" \
  -d '{"process_batches": true}'
```

You should see a response like:
```json
{
  "message": "Batches processed",
  "processed": 1,
  "batchIds": ["batch-id-here"],
  "request_id": "abc123"
}
```

## Monitoring

Check for ready batches using:
```sql
SELECT * FROM process_ready_email_batches();
```

This will show how many batches are ready to be processed.

