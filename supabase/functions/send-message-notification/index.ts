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
function generateEmailTemplate(data: EmailTemplateData, appUrl: string = 'https://swellyomvp.netlify.app'): string {
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

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0;">
                    <a href="${conversationUrl}" style="display: inline-block; padding: 14px 32px; background-color: #B72DF2; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; text-align: center;">
                      Go to Swellyo
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
const APP_URL = Deno.env.get('APP_URL') || 'https://swellyomvp.netlify.app'

// Resend email service configuration
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
// Use Resend's default domain for testing, or set EMAIL_FROM secret to your verified domain
// Default: onboarding@resend.dev (works without domain verification)
// Production: Set EMAIL_FROM secret to 'Swellyo <noreply@swellyo.com>' after verifying domain
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Swellyo <onboarding@resend.dev>'

// Configuration constants
const RATE_LIMIT_MINUTES = 30 // 30-minute cooldown between emails per sender→recipient
const ONLINE_THRESHOLD_MINUTES = 5 // Skip if user was online in last 5 minutes

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
 * Send single email notification immediately
 */
async function sendSingleEmail(
  supabase: any,
  recipientId: string,
  senderId: string,
  messageId: string,
  conversationId: string
): Promise<void> {
  console.log(`[sendSingleEmail] Sending email - recipient: ${recipientId}, sender: ${senderId}, message: ${messageId}`);

  // Get the message
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('id, body, created_at')
    .eq('id', messageId)
    .single();

  if (msgError || !msg) {
    console.error('[Email Notification] Error loading message:', msgError);
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

  // Get recipient email
  const { data: recipientUser, error: recipientError } = await supabase.auth.admin.getUserById(recipientId);
  if (recipientError || !recipientUser?.user?.email) {
    console.error('[Email Notification] Error loading recipient user:', recipientError);
    return;
  }

  const recipientEmail = recipientUser.user.email as string;

  // Get recipient name
  const { data: recipientSurfer } = await supabase
    .from('surfers')
    .select('name')
    .eq('user_id', recipientId)
    .single();

  const recipientName = recipientSurfer?.name;

  // Build email content (single message)
  const messageData: MessageData = {
    id: msg.id,
    body: msg.body || '',
    created_at: msg.created_at
  };

  const emailHtml = generateEmailTemplate({
    sender: {
      name: senderName,
      avatar: senderAvatar
    },
    messages: [messageData],
    conversationId,
    recipientName
  }, APP_URL);

  // Send via Resend
  if (!RESEND_API_KEY) {
    console.error('[Email Notification] RESEND_API_KEY not set');
    return;
  }

  const emailSubject = `${senderName} sent you a message on Swellyo`;
  const emailTextContent = `You received a new message from ${senderName} on Swellyo.\n\n${messageData.body}\n\nView conversation: ${APP_URL}/messages/${conversationId}`;

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [recipientEmail],
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
    console.log(`[Email Notification] Email sent successfully via Resend to ${recipientEmail} from ${senderName}. Email ID: ${resendResult.id || 'N/A'}`);
    
    // Record email as sent
    const now = new Date().toISOString();
    const { error: recordError } = await supabase
      .from('message_email_notifications')
      .upsert({
        message_id: messageId,
        recipient_id: recipientId,
        sender_id: senderId,
        conversation_id: conversationId,
        email_sent_at: now,
      }, {
        onConflict: 'message_id,recipient_id'
      });

    if (recordError) {
      console.error('[Email Notification] Error recording email_sent_at:', recordError);
    } else {
      console.log(`[Email Notification] Recorded email sent for message ${messageId} to recipient ${recipientId}`);
    }
  } catch (emailSendError) {
    console.error('[Email Notification] Error sending email:', emailSendError);
    throw emailSendError;
  }
}

/**
 * Main handler
 */
serve(async (req) => {
  let requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Email Notification] [${requestId}] Request received - Method: ${req.method}`);
  
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      console.log(`[Email Notification] [${requestId}] Method not allowed: ${req.method}`);
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role (available as env vars)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const body = await req.json().catch(() => ({}));
    console.log(`[Email Notification] [${requestId}] Request body:`, JSON.stringify(body));
    
    // Handle Supabase Database Webhook format
    // Webhook sends: { type, table, record: { id, conversation_id, sender_id, ... }, schema, old_record }
    // Or direct format: { message_id, conversation_id, sender_id }
    let message_id: string | undefined;
    let conversation_id: string | undefined;
    let sender_id: string | undefined;

    if (body.record) {
      // Supabase Database Webhook format
      message_id = body.record.id;
      conversation_id = body.record.conversation_id;
      sender_id = body.record.sender_id;
    } else {
      // Direct format (for manual calls or other webhooks)
      message_id = body.message_id || body.id;
      conversation_id = body.conversation_id;
      sender_id = body.sender_id;
    }

    // Validate required fields
    if (!message_id || !conversation_id || !sender_id) {
      console.error(`[Email Notification] [${requestId}] Missing required fields - message_id: ${message_id}, conversation_id: ${conversation_id}, sender_id: ${sender_id}`);
      console.error(`[Email Notification] [${requestId}] Body structure:`, JSON.stringify(body, null, 2));
      return new Response(
        JSON.stringify({ error: 'Missing required fields: message_id, conversation_id, sender_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Email Notification] [${requestId}] Processing notification - message_id: ${message_id}, conversation_id: ${conversation_id}, sender_id: ${sender_id}`);

    // Get conversation members (recipients)
    const { data: members, error: membersError } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversation_id)
      .neq('user_id', sender_id); // Exclude sender

    if (membersError) {
      console.error(`[Email Notification] [${requestId}] Error fetching conversation members:`, membersError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch conversation members' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!members || members.length === 0) {
      console.log(`[Email Notification] [${requestId}] No recipients found`);
      return new Response(
        JSON.stringify({ message: 'No recipients to notify' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Process each recipient - send email immediately if rate limit allows
    for (const member of members) {
      const recipientId = member.user_id;

      // Check if should send email (30-minute cooldown + online detection)
      const shouldSend = await shouldSendEmail(supabase, recipientId, sender_id);
      if (!shouldSend) {
        console.log(`[Email Notification] [${requestId}] Skipping email for recipient ${recipientId} (rate limit or online)`);
        continue;
      }

      // Send email immediately
      try {
        await sendSingleEmail(supabase, recipientId, sender_id, message_id, conversation_id);
        console.log(`[Email Notification] [${requestId}] Email sent to recipient ${recipientId}`);
      } catch (error) {
        console.error(`[Email Notification] [${requestId}] Error sending email to recipient ${recipientId}:`, error);
        // Continue processing other recipients even if one fails
      }
    }

    return new Response(
      JSON.stringify({ message: 'Notification processed', request_id: requestId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[Email Notification] [${requestId}] ❌ Unexpected error:`, error);
    console.error(`[Email Notification] [${requestId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error',
        request_id: requestId
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

