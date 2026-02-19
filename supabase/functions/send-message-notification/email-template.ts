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
export function generateEmailTemplate(data: EmailTemplateData, appUrl: string = 'https://swellyo.com'): string {
  const { sender, messages, conversationId, recipientName } = data;
  const messageCount = messages.length;
  const isMultiple = messageCount > 1;
  const greetingName = recipientName || 'there';

  const conversationUrl = `${appUrl}/messages/${conversationId}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>New Message${isMultiple ? 's' : ''} from ${sender.name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,800;1,900&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: Montserrat, -apple-system, BlinkMacSystemFont, sans-serif; background-color: #0d0d0d; color-scheme: dark;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #0d0d0d;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; border-radius: 15px; border: 1px solid #05BCD3; background: #202125; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="border-radius: 15px 15px 0 0; background: linear-gradient(90deg, #05BCD3 0.01%, #DBCDBC 125.83%); padding: 28px 24px; text-align: center;">
              <h1 style="margin: 0; color: #FFF; text-align: center; font-family: Montserrat, sans-serif; font-size: 32px; font-style: italic; font-weight: 900; line-height: 120%;">
                SWELLYO
              </h1>
            </td>
          </tr>
          <!-- Greeting -->
          <tr>
            <td style="padding: 24px 24px 0 24px; text-align: center;">
              <p style="margin: 0; color: #FFF; text-align: center; font-family: Montserrat, sans-serif; font-size: 24px; font-style: normal; font-weight: 800; line-height: 120%;">
                Yo ${escapeHtml(greetingName)}!
              </p>
            </td>
          </tr>
          <!-- Profile picture -->
          <tr>
            <td align="center" style="padding: 20px 24px;">
              ${sender.avatar
    ? `<img src="${escapeHtml(sender.avatar)}" alt="${escapeHtml(sender.name)}" width="80" height="80" style="display: block; width: 80px; height: 80px; border-radius: 40px; border: 3px solid #FFF; object-fit: cover;" />`
    : `<div style="display: inline-block; width: 80px; height: 80px; border-radius: 40px; border: 3px solid #FFF; background: #05BCD3; color: #FFF; font-family: Montserrat, sans-serif; font-size: 28px; font-weight: 800; line-height: 74px; text-align: center;">${escapeHtml(sender.name.charAt(0).toUpperCase())}</div>`}
            </td>
          </tr>
          <!-- Main content text -->
          <tr>
            <td style="padding: 0 24px 24px 24px; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #FFF; text-align: center; font-family: Montserrat, sans-serif; font-size: 18px; font-style: normal; font-weight: 400; line-height: 120%;">
                You got a message from <span style="color: #FFF; font-family: Montserrat, sans-serif; font-size: 18px; font-style: normal; font-weight: 600; line-height: 120%;">${escapeHtml(sender.name)}</span>!
              </p>
              <p style="margin: 0 0 24px 0; color: #FFF; text-align: center; font-family: Montserrat, sans-serif; font-size: 18px; font-style: normal; font-weight: 400; line-height: 120%;">
                Keep the chat going!
              </p>
              <table role="presentation" style="margin: 0 auto; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="${conversationUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(90deg, #06BCD3 0%, #AECAC1 100%); color: #FFF; text-decoration: none; border-radius: 8px; font-family: Montserrat, sans-serif; font-size: 16px; font-weight: 700; text-align: center;">
                      Go To Swellyo
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px; text-align: center; border-top: 1px solid #05BCD3;">
              <p style="margin: 0; color: #FFF; text-align: center; font-family: Montserrat, sans-serif; font-size: 14px; font-style: normal; font-weight: 400; line-height: 120%;">
                You're receiving this email because you have a conversation with ${escapeHtml(sender.name)} on Swellyo.
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
