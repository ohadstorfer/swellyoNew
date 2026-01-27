/**
 * Email template for message notifications
 * Supports single or multiple messages from the same sender
 */

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
 * Generate HTML email template
 */
export function generateEmailTemplate(data: EmailTemplateData, appUrl: string = 'https://swellyo.com'): string {
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

