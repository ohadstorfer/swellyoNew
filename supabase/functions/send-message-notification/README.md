# Email Notification Edge Function

This edge function handles email notifications for direct messages between users.

## Features

- **Batching**: Groups multiple messages from the same sender (5 minute window or max 5 messages)
- **Rate Limiting**: Max 1 email per user per 10 minutes
- **Online Detection**: Skips emails if user was online in last 5 minutes
- **Beautiful HTML Emails**: Responsive email template with sender info and message content

## Setup

### 1. Deploy the Function

```bash
supabase functions deploy send-message-notification
```

### 2. Configure Environment Variables

In Supabase Dashboard → Project Settings → Edge Functions → Secrets:

- `APP_URL` (optional): Your app URL for email links (default: https://swellyo.com)
- `EMAIL_FROM` (optional): Email sender address (default: noreply@swellyo.com)

### 3. Set Up Database Trigger

Run the migration files in order:
1. `create_message_email_notifications.sql`
2. `add_user_activity_tracking.sql`
3. `create_email_sending_function.sql`
4. `create_message_notification_trigger.sql`
5. `create_batch_processor_cron.sql`

### 4. Configure Email Sending

Supabase doesn't have built-in email sending. You need to:

**Option A: Use Supabase Database Webhooks**
1. Go to Supabase Dashboard → Database → Webhooks
2. Create webhook that calls the edge function when messages are inserted

**Option B: Use pg_net Extension**
1. Enable pg_net extension in Supabase
2. The trigger will automatically call the edge function

**Option C: Use External Email Service**
1. Modify `send_email` function in `create_email_sending_function.sql`
2. Integrate with Resend, SendGrid, or AWS SES
3. Update the edge function to use the external service

## How It Works

1. User sends a message → Database trigger fires
2. Trigger calls edge function with message details
3. Edge function checks if recipient should receive email:
   - Not the sender
   - Not online recently
   - Rate limit not exceeded
4. Message added to notification queue with batch ID
5. When batch is ready (5 min or 5 messages), email is sent
6. Email includes all batched messages from same sender

## Email Template

The email template includes:
- Sender name and avatar
- Message content(s) with timestamps
- "View Conversation" button
- Branding consistent with Swellyo

## Testing

Test the function locally:

```bash
supabase functions serve send-message-notification
```

Then trigger it with:

```bash
curl -X POST http://localhost:54321/functions/v1/send-message-notification \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "uuid"
  }'
```

## Monitoring

Check function logs:

```bash
supabase functions logs send-message-notification
```

Or in Supabase Dashboard → Edge Functions → Logs

