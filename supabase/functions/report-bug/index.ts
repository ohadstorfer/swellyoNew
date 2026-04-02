import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Swellyo <onboarding@resend.dev>'
const NOTIFY_EMAIL = 'app@swellyo.com'

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

function generateEmailHtml(userName: string, userEmail: string, description: string, platform: string): string {
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
          <tr>
            <td style="background-color:#0788B0;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Bug Report</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#333;font-size:15px;line-height:1.6;">
                A user has reported a bug.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 12px;color:#7b7b7b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Reporter</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Name:</strong> ${escapeHtml(userName)}</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Email:</strong> ${escapeHtml(userEmail)}</p>
                    <p style="margin:0;color:#333;font-size:15px;"><strong>Platform:</strong> ${escapeHtml(platform)}</p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f7fa;border-radius:12px;border:1px solid #d0e8f0;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 8px;color:#7b7b7b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Bug Description</p>
                    <p style="margin:0;color:#333;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(description)}</p>
                  </td>
                </tr>
              </table>
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
    const { userName, userEmail, description, platform } = await req.json();

    if (!description) {
      return new Response(JSON.stringify({ error: 'Missing required field: description' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    console.log(`[Bug Report] Received from ${userName} (${userEmail})`);

    if (!RESEND_API_KEY) {
      console.error('[Bug Report] RESEND_API_KEY not set');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const emailHtml = generateEmailHtml(
      userName || 'Unknown',
      userEmail || 'Unknown',
      description,
      platform || 'Unknown',
    );

    const emailText = `Bug Report\n\nFrom: ${userName || 'Unknown'} (${userEmail || 'Unknown'})\nPlatform: ${platform || 'Unknown'}\n\nDescription:\n${description}`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [NOTIFY_EMAIL],
        subject: `🐛 Bug Report — ${userName || 'Unknown'}`,
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json().catch(() => ({ message: 'Unknown error' }));
      console.error('[Bug Report] Resend API error:', JSON.stringify(errorData));
      throw new Error(`Resend API error (${resendResponse.status}): ${JSON.stringify(errorData)}`);
    }

    const result = await resendResponse.json();
    console.log(`[Bug Report] Email sent successfully. ID: ${result.id || 'N/A'}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('[Bug Report] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send report' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
