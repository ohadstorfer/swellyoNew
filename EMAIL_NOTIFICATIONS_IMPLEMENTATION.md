# Email Notifications Implementation Summary

## Overview

This implementation adds email notifications for direct messages between users, with intelligent batching to reduce email volume.

## Files Created

### Database Migrations

1. **`supabase/migrations/create_message_email_notifications.sql`**
   - Creates `message_email_notifications` table to track sent emails
   - Includes indexes for efficient querying
   - Enables RLS policies

2. **`supabase/migrations/add_user_activity_tracking.sql`**
   - Creates `user_activity` table to track user online status
   - Helps avoid sending emails when users are actively using the app

3. **`supabase/migrations/create_email_sending_function.sql`**
   - Creates `send_email` database function
   - Placeholder for email sending (needs to be configured with actual email service)

4. **`supabase/migrations/create_message_notification_trigger.sql`**
   - Creates database trigger that fires when new messages are inserted
   - Calls edge function to process notifications
   - Includes fallback instructions for using Supabase webhooks

5. **`supabase/migrations/create_batch_processor_cron.sql`**
   - Creates function to process pending email batches
   - Optional: Can be scheduled with pg_cron to process batches periodically

### Edge Function

**`supabase/functions/send-message-notification/index.ts`**
- Main edge function that processes message notifications
- Implements batching logic (5 minute window or max 5 messages)
- Rate limiting (max 1 email per user per 10 minutes)
- Online detection (skips if user was online in last 5 minutes)
- Calls email sending function

**`supabase/functions/send-message-notification/email-template.ts`**
- Generates beautiful HTML email templates
- Supports single or multiple messages
- Includes sender info, message content, timestamps
- Responsive design with Swellyo branding

**`supabase/functions/send-message-notification/README.md`**
- Setup and deployment instructions
- Configuration guide
- Testing instructions

## Features

### Batching
- Groups multiple messages from the same sender
- Waits up to 5 minutes or until 5 messages are received
- Reduces email volume significantly

### Rate Limiting
- Maximum 1 email per user per 10 minutes
- Prevents email spam

### Online Detection
- Skips sending emails if user was online in last 5 minutes
- Assumes user will see messages in-app

### Beautiful Emails
- Responsive HTML design
- Shows sender name and avatar
- Displays message content with timestamps
- "View Conversation" button linking to app

## Setup Instructions

### 1. Run Database Migrations

Run the migration files in order:
```sql
-- Run these in Supabase SQL Editor or via migration tool
1. create_message_email_notifications.sql
2. add_user_activity_tracking.sql
3. create_email_sending_function.sql
4. create_message_notification_trigger.sql
5. create_batch_processor_cron.sql (optional)
```

### 2. Deploy Edge Function

```bash
supabase functions deploy send-message-notification
```

### 3. Configure Environment Variables

In Supabase Dashboard → Project Settings → Edge Functions → Secrets:
- `APP_URL` (optional): Your app URL (default: https://swellyo.com)
- `EMAIL_FROM` (optional): Sender email (default: noreply@swellyo.com)

### 4. Set Up Email Sending with Resend

**The edge function is now integrated with Resend for email sending.**

**Steps to configure Resend:**

1. **Sign up for Resend** (if you haven't already):
   - Go to https://resend.com
   - Create a free account (free tier includes 3,000 emails/month)

2. **Get your API key**:
   - Go to https://resend.com/api-keys
   - Click "Create API Key"
   - Give it a name (e.g., "Swellyo Email Notifications")
   - Copy the API key

3. **Add API key to Supabase**:
   - Go to Supabase Dashboard → Project Settings → Edge Functions → Secrets
   - Click "Add new secret"
   - Name: `RESEND_API_KEY`
   - Value: Your Resend API key
   - Click "Save"

4. **Verify your domain** (for production):
   - In Resend dashboard, go to Domains
   - Add your domain (e.g., swellyo.com)
   - Add the DNS records provided by Resend to your domain
   - Update `EMAIL_FROM` secret to use your verified domain (e.g., `Swellyo <noreply@swellyo.com>`)

5. **Set up Database Trigger or Webhook**:
   - **Option A: Use Supabase Database Webhooks** (Recommended)
     - Go to Supabase Dashboard → Database → Webhooks
     - Create new webhook:
       - **Table**: `messages`
       - **Events**: `INSERT`
       - **Type**: HTTP Request
       - **URL**: `https://YOUR_PROJECT.supabase.co/functions/v1/send-message-notification`
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
   - **Option B: Enable pg_net Extension**
     - Enable pg_net extension in Supabase Dashboard → Database → Extensions
     - The trigger will automatically call the edge function

### 5. Update User Activity Tracking

Add code to your app to update user activity when users are active:

```typescript
// In your app, when user is active:
await supabase
  .from('user_activity')
  .upsert({
    user_id: currentUser.id,
    last_seen_at: new Date().toISOString(),
    is_online: true,
    updated_at: new Date().toISOString()
  });
```

## How It Works

1. **User sends message** → Message inserted into `messages` table
2. **Database trigger fires** → Calls edge function (via webhook or pg_net)
3. **Edge function processes**:
   - Gets conversation members (recipients)
   - For each recipient:
     - Checks if should send email (not online, rate limit OK)
     - Creates notification record with batch ID
     - Checks if batch is ready (5 min or 5 messages)
     - If ready, sends email with all batched messages
4. **Email sent** → Notifications marked as sent

## Testing

### Test Edge Function Locally

```bash
supabase functions serve send-message-notification
```

### Test with curl

```bash
curl -X POST http://localhost:54321/functions/v1/send-message-notification \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "test-message-id",
    "conversation_id": "test-conversation-id",
    "sender_id": "test-sender-id"
  }'
```

### Monitor Logs

```bash
supabase functions logs send-message-notification
```

## Configuration

### Adjust Batching Window

Edit `BATCH_WINDOW_MINUTES` in `index.ts`:
```typescript
const BATCH_WINDOW_MINUTES = 5 // Change to desired minutes
```

### Adjust Rate Limit

Edit `RATE_LIMIT_MINUTES` in `index.ts`:
```typescript
const RATE_LIMIT_MINUTES = 10 // Change to desired minutes
```

### Adjust Online Threshold

Edit `ONLINE_THRESHOLD_MINUTES` in `index.ts`:
```typescript
const ONLINE_THRESHOLD_MINUTES = 5 // Change to desired minutes
```

## Next Steps

1. ✅ **Email Service Configured**: Resend is now integrated
2. **Test End-to-End**: Send a test message and verify email is received
3. **Monitor Performance**: Check edge function logs and database queries
4. **Update User Activity**: Add code to track when users are online
5. **Customize Email Template**: Adjust colors, branding, or layout as needed
6. **Verify Domain** (for production): Set up domain verification in Resend for better deliverability

## Troubleshooting

### Emails not sending
- Check edge function logs for errors
- Verify email service is configured correctly
- Check database trigger is firing (check Supabase logs)
- Verify webhook is configured (if using webhooks)

### Too many emails
- Adjust `BATCH_WINDOW_MINUTES` to increase batching window
- Adjust `RATE_LIMIT_MINUTES` to increase rate limit
- Check online detection is working

### Emails sending when user is online
- Verify user activity tracking is updating `user_activity` table
- Check `ONLINE_THRESHOLD_MINUTES` setting

## Notes

- The email sending function is a placeholder and needs to be configured with an actual email service
- Supabase doesn't have built-in email, so you'll need to use an external service or configure Supabase's email extension
- The trigger uses pg_net or webhooks - choose based on what's available in your Supabase setup
- User activity tracking is optional but recommended to avoid sending emails to active users

