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

- `RESEND_API_KEY` (required): Your Resend API key - Get it from https://resend.com/api-keys
- `APP_URL` (optional): Your app URL for email links (default: https://swellyo.com)
- `EMAIL_FROM` (optional): Email sender address (default: Swellyo <noreply@swellyo.com>)

**To get your Resend API key:**
1. Sign up at https://resend.com (free tier available)
2. Go to API Keys section
3. Create a new API key
4. Copy the key and add it as `RESEND_API_KEY` secret in Supabase

### 3. Set Up Database Trigger

Run the migration files in order:
1. `create_message_email_notifications.sql`
2. `add_user_activity_tracking.sql`
3. `create_email_sending_function.sql`
4. `create_message_notification_trigger.sql`
5. `create_batch_processor_cron.sql`

### 4. Configure Email Sending with Resend

The edge function is now integrated with Resend for email sending. You need to:

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
   - Update `EMAIL_FROM` secret to use your verified domain

5. **Set up Database Trigger or Webhook**:
   - **Option A: Use Supabase Database Webhooks** (Recommended)
     - Go to Supabase Dashboard → Database → Webhooks
     - Create webhook that calls the edge function when messages are inserted
   - **Option B: Use pg_net Extension**
     - Enable pg_net extension in Supabase
     - The trigger will automatically call the edge function

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

