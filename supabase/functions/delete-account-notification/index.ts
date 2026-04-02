import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Swellyo <onboarding@resend.dev>'
const NOTIFY_EMAIL = 'app@swellyo.com'

function generateEmailHtml(userName: string, userEmail: string, reason: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f7f7f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color:#FB3748;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Account Deletion Request</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#333;font-size:15px;line-height:1.6;">
                A user has requested to delete their account.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 12px;color:#7b7b7b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">User Details</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Name:</strong> ${escapeHtml(userName)}</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Email:</strong> ${escapeHtml(userEmail)}</p>
                    <p style="margin:0;color:#333;font-size:15px;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#7b7b7b;font-size:13px;line-height:1.5;">
                The user has been told their account will be permanently deleted within 30 days.
              </p>
              <p style="margin:0;color:#7b7b7b;font-size:13px;line-height:1.5;">
                Sent at ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const { userName, userEmail, reason } = await req.json();

    if (!userName || !userEmail || !reason) {
      return new Response(JSON.stringify({ error: 'Missing required fields: userName, userEmail, reason' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    console.log(`[Delete Account] Request received - user: ${userName}, email: ${userEmail}, reason: ${reason}`);

    if (!RESEND_API_KEY) {
      console.error('[Delete Account] RESEND_API_KEY not set');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const emailHtml = generateEmailHtml(userName, userEmail, reason);
    const emailText = `Account Deletion Request\n\nName: ${userName}\nEmail: ${userEmail}\nReason: ${reason}\n\nThe user has been told their account will be permanently deleted within 30 days.`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [NOTIFY_EMAIL],
        subject: `🚨 Account Deletion Request — ${userName}`,
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json().catch(() => ({ message: 'Unknown error' }));
      console.error('[Delete Account] Resend API error:', JSON.stringify(errorData));
      throw new Error(`Resend API error (${resendResponse.status}): ${JSON.stringify(errorData)}`);
    }

    const result = await resendResponse.json();
    console.log(`[Delete Account] Email sent successfully. ID: ${result.id || 'N/A'}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('[Delete Account] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send notification' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
