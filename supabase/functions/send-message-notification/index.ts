import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Email template types and functions (inlined since Supabase Edge Functions don't support local imports)
export interface MessageData {
  id: string;
  body: string;
  created_at: string;
}

export interface SenderData {
  name: string;
  avatar?: string;
}

export interface EmailTemplateData {
  sender: SenderData;
  messages: MessageData[];
  conversationId: string;
  recipientName?: string;
}

/**
 * Format timestamp for display in email
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  // Format as date if older than a week
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Generate HTML email template
 */
function generateEmailTemplate(data: EmailTemplateData, appUrl: string = 'https://swellyo.com'): string {
  const { sender, messages, conversationId, recipientName } = data;
  const messageCount = messages.length;
  const isMultiple = messageCount > 1;
  
  // Get conversation URL (adjust based on your app's routing)
  const conversationUrl = `${appUrl}/messages/${conversationId}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Message${isMultiple ? 's' : ''} from ${sender.name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #B72DF2 0%, #8B1FC7 100%); padding: 32px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
                Swellyo
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 24px;">
              <!-- Greeting -->
              <p style="margin: 0 0 24px 0; color: #333333; font-size: 16px; line-height: 24px;">
                ${recipientName ? `Hi ${recipientName},` : 'Hi there,'}
              </p>

              <!-- Sender Info -->
              <div style="display: flex; align-items: center; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #e5e5e5;">
                ${sender.avatar ? `
                  <img src="${sender.avatar}" alt="${sender.name}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-right: 12px; border: 2px solid #e5e5e5;">
                ` : `
                  <div style="width: 48px; height: 48px; border-radius: 50%; background-color: #B72DF2; display: flex; align-items: center; justify-content: center; margin-right: 12px; color: #ffffff; font-size: 18px; font-weight: 600;">
                    ${sender.name.charAt(0).toUpperCase()}
                  </div>
                `}
                <div>
                  <p style="margin: 0; color: #333333; font-size: 18px; font-weight: 600;">
                    ${sender.name}
                  </p>
                  <p style="margin: 4px 0 0 0; color: #7B7B7B; font-size: 14px;">
                    ${isMultiple ? `sent you ${messageCount} new messages` : 'sent you a message'}
                  </p>
                </div>
              </div>

              <!-- Messages -->
              <div style="margin-bottom: 32px;">
                ${messages.map((message, index) => `
                  <div style="margin-bottom: ${index < messages.length - 1 ? '20px' : '0'}; padding: 16px; background-color: #f9f9f9; border-radius: 12px; border-left: 3px solid #B72DF2;">
                    <p style="margin: 0 0 8px 0; color: #333333; font-size: 16px; line-height: 24px; white-space: pre-wrap; word-wrap: break-word;">
                      ${escapeHtml(message.body || '')}
                    </p>
                    <p style="margin: 0; color: #7B7B7B; font-size: 12px;">
                      ${formatTimestamp(message.created_at)}
                    </p>
                  </div>
                `).join('')}
              </div>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0;">
                    <a href="${conversationUrl}" style="display: inline-block; padding: 14px 32px; background-color: #B72DF2; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; text-align: center;">
                      View Conversation
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px; background-color: #f9f9f9; text-align: center; border-top: 1px solid #e5e5e5;">
              <p style="margin: 0 0 8px 0; color: #7B7B7B; font-size: 12px; line-height: 18px;">
                You're receiving this email because you have a conversation with ${sender.name} on Swellyo.
              </p>
              <p style="margin: 0; color: #7B7B7B; font-size: 12px; line-height: 18px;">
                <a href="${appUrl}" style="color: #B72DF2; text-decoration: none;">Visit Swellyo</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://swellyo.com'

// Resend email service configuration
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Swellyo <noreply@swellyo.com>'

// Configuration constants
const BATCH_WINDOW_MINUTES = 5 // Wait up to 5 minutes to batch messages
const MAX_BATCH_SIZE = 5 // Maximum messages per batch
const RATE_LIMIT_MINUTES = 10 // Max 1 email per user per 10 minutes
const ONLINE_THRESHOLD_MINUTES = 5 // Skip if user was online in last 5 minutes

interface NotificationRequest {
  message_id: string;
  conversation_id: string;
  sender_id: string;
}

interface BatchedNotification {
  batch_id: string;
  recipient_id: string;
  sender_id: string;
  conversation_id: string;
  message_ids: string[];
  created_at: string;
}

/**
 * Check if user should receive email notification
 */
async function shouldSendEmail(
  supabase: any,
  recipientId: string,
  senderId: string
): Promise<boolean> {
  // Don't send email to sender
  if (recipientId === senderId) {
    return false;
  }

  // Check if user was online recently (skip email if active)
  const { data: activity } = await supabase
    .from('user_activity')
    .select('last_seen_at, is_online')
    .eq('user_id', recipientId)
    .single();

  if (activity) {
    const lastSeen = new Date(activity.last_seen_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 60000;

    if (activity.is_online || diffMinutes < ONLINE_THRESHOLD_MINUTES) {
      console.log(`[Email Notification] Skipping - user ${recipientId} is online or was active recently`);
      return false;
    }
  }

  // Check rate limiting - don't send if email was sent recently
  const { data: recentNotification } = await supabase
    .from('message_email_notifications')
    .select('email_sent_at')
    .eq('recipient_id', recipientId)
    .eq('sender_id', senderId)
    .not('email_sent_at', 'is', null)
    .order('email_sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recentNotification?.email_sent_at) {
    const lastSent = new Date(recentNotification.email_sent_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSent.getTime()) / 60000;

    if (diffMinutes < RATE_LIMIT_MINUTES) {
      console.log(`[Email Notification] Skipping - rate limit (last email sent ${diffMinutes.toFixed(1)} minutes ago)`);
      return false;
    }
  }

  return true;
}

/**
 * Get or create batch ID for pending notifications
 */
async function getOrCreateBatch(
  supabase: any,
  recipientId: string,
  senderId: string,
  conversationId: string
): Promise<string | null> {
  // Check for existing pending batch
  const { data: existingBatch } = await supabase
    .from('message_email_notifications')
    .select('batch_id, created_at')
    .eq('recipient_id', recipientId)
    .eq('sender_id', senderId)
    .eq('conversation_id', conversationId)
    .is('email_sent_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingBatch?.batch_id) {
    // Check if batch is still within time window
    const batchCreated = new Date(existingBatch.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - batchCreated.getTime()) / 60000;

    if (diffMinutes < BATCH_WINDOW_MINUTES) {
      // Check batch size
      const { count } = await supabase
        .from('message_email_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', existingBatch.batch_id)
        .is('email_sent_at', null);

      if (count && count < MAX_BATCH_SIZE) {
        return existingBatch.batch_id;
      }
    }
  }

  // Create new batch ID
  return crypto.randomUUID();
}

/**
 * Check if batch is ready to send
 */
async function isBatchReady(
  supabase: any,
  batchId: string
): Promise<boolean> {
  const { data: batchNotifications } = await supabase
    .from('message_email_notifications')
    .select('created_at')
    .eq('batch_id', batchId)
    .is('email_sent_at', null)
    .order('created_at', { ascending: true });

  if (!batchNotifications || batchNotifications.length === 0) {
    return false;
  }

  // Check if max batch size reached
  if (batchNotifications.length >= MAX_BATCH_SIZE) {
    return true;
  }

  // Check if batch window has passed
  const oldestNotification = new Date(batchNotifications[0].created_at);
  const now = new Date();
  const diffMinutes = (now.getTime() - oldestNotification.getTime()) / 60000;

  return diffMinutes >= BATCH_WINDOW_MINUTES;
}

/**
 * Send email notification for batched messages
 */
async function sendBatchedEmail(
  supabase: any,
  batchId: string
): Promise<void> {
  // Get all messages in batch
  const { data: notifications, error: notifError } = await supabase
    .from('message_email_notifications')
    .select(`
      message_id,
      recipient_id,
      sender_id,
      conversation_id,
      messages!inner(id, body, created_at),
      conversations!inner(id)
    `)
    .eq('batch_id', batchId)
    .is('email_sent_at', null)
    .order('created_at', { ascending: true });

  if (notifError || !notifications || notifications.length === 0) {
    console.error('[Email Notification] Error fetching batch notifications:', notifError);
    return;
  }

  const firstNotif = notifications[0];
  const recipientId = firstNotif.recipient_id;
  const senderId = firstNotif.sender_id;
  const conversationId = firstNotif.conversation_id;

  // Get recipient email
  const { data: recipientUser, error: recipientError } = await supabase.auth.admin.getUserById(recipientId);
  if (recipientError || !recipientUser?.user?.email) {
    console.error('[Email Notification] Error fetching recipient:', recipientError);
    return;
  }

  // Get sender info
  const { data: senderSurfer } = await supabase
    .from('surfers')
    .select('name, profile_image_url')
    .eq('user_id', senderId)
    .single();

  const senderName = senderSurfer?.name || 'Someone';
  const senderAvatar = senderSurfer?.profile_image_url || null;

  // Get recipient name
  const { data: recipientSurfer } = await supabase
    .from('surfers')
    .select('name')
    .eq('user_id', recipientId)
    .single();

  const recipientName = recipientSurfer?.name;

  // Prepare message data
  const messages: MessageData[] = notifications.map((notif: any) => ({
    id: notif.messages.id,
    body: notif.messages.body || '',
    created_at: notif.messages.created_at
  }));

  // Generate email HTML
  const emailHtml = generateEmailTemplate({
    sender: {
      name: senderName,
      avatar: senderAvatar
    },
    messages,
    conversationId,
    recipientName
  }, APP_URL);

  // Send email using Resend API
  const messageCount = messages.length;
  const emailSubject = `${senderName} ${messageCount > 1 ? `sent you ${messageCount} new messages` : 'sent you a message'} on Swellyo`;
  const emailTextContent = `You received ${messageCount > 1 ? `${messageCount} new messages` : 'a new message'} from ${senderName} on Swellyo.\n\n${messages.map(m => `${m.body}\n\n`).join('')}\n\nView conversation: ${APP_URL}/messages/${conversationId}`;
  
  try {
    // Check if Resend API key is configured
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured. Please set it in Supabase Edge Functions secrets.');
    }

    // Send email via Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [recipientUser.user.email],
        subject: emailSubject,
        html: emailHtml,
        text: emailTextContent,
      }),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(`Resend API error (${resendResponse.status}): ${JSON.stringify(errorData)}`);
    }

    const resendResult = await resendResponse.json();
    console.log(`[Email Notification] Email sent successfully via Resend to ${recipientUser.user.email} for ${messages.length} message(s) from ${senderName}. Email ID: ${resendResult.id || 'N/A'}`);
    
    // Mark notifications as sent
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('message_email_notifications')
      .update({ email_sent_at: now })
      .eq('batch_id', batchId)
      .is('email_sent_at', null);

    if (updateError) {
      console.error('[Email Notification] Error updating notification status:', updateError);
    } else {
      console.log(`[Email Notification] Marked ${notifications.length} notifications as sent`);
    }
  } catch (emailSendError) {
    console.error('[Email Notification] Error sending email:', emailSendError);
    // Don't mark as sent if email failed - will retry on next batch check
    throw emailSendError;
  }
}

/**
 * Main handler
 */
serve(async (req) => {
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { message_id, conversation_id, sender_id }: NotificationRequest = await req.json();

    if (!message_id || !conversation_id || !sender_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: message_id, conversation_id, sender_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get conversation members (recipients)
    const { data: members, error: membersError } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversation_id)
      .neq('user_id', sender_id); // Exclude sender

    if (membersError) {
      console.error('[Email Notification] Error fetching conversation members:', membersError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch conversation members' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!members || members.length === 0) {
      console.log('[Email Notification] No recipients found');
      return new Response(
        JSON.stringify({ message: 'No recipients to notify' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Process each recipient
    for (const member of members) {
      const recipientId = member.user_id;

      // Check if should send email
      const shouldSend = await shouldSendEmail(supabase, recipientId, sender_id);
      if (!shouldSend) {
        continue;
      }

      // Get or create batch ID
      const batchId = await getOrCreateBatch(supabase, recipientId, sender_id, conversation_id);
      if (!batchId) {
        console.error('[Email Notification] Failed to get/create batch ID');
        continue;
      }

      // Create notification record
      const { error: insertError } = await supabase
        .from('message_email_notifications')
        .insert({
          message_id,
          recipient_id: recipientId,
          sender_id,
          conversation_id,
          batch_id: batchId
        });

      if (insertError) {
        console.error('[Email Notification] Error inserting notification:', insertError);
        continue;
      }

      console.log(`[Email Notification] Added message ${message_id} to batch ${batchId} for recipient ${recipientId}`);

      // Check if batch is ready to send
      const batchReady = await isBatchReady(supabase, batchId);
      if (batchReady) {
        console.log(`[Email Notification] Batch ${batchId} is ready, sending email...`);
        await sendBatchedEmail(supabase, batchId);
      } else {
        console.log(`[Email Notification] Batch ${batchId} is not ready yet, waiting...`);
      }
    }

    return new Response(
      JSON.stringify({ message: 'Notification processed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Email Notification] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

