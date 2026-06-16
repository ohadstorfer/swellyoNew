import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

function generateEmailHtml(reporterName: string, reporterEmail: string, reportedName: string, reportedId: string, alsoBlocked: boolean, details: string): string {
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
            <td style="background-color:#FB3748;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">User Report</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#333;font-size:15px;line-height:1.6;">
                A user has been reported.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 12px;color:#7b7b7b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Report Details</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Reported user:</strong> ${escapeHtml(reportedName)}</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Reported user ID:</strong> ${escapeHtml(reportedId)}</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Also blocked:</strong> ${alsoBlocked ? 'Yes' : 'No'}</p>${details ? `
                    <p style="margin:8px 0 0;color:#333;font-size:15px;"><strong>Details:</strong></p>
                    <p style="margin:4px 0 0;color:#333;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(details)}</p>` : ''}
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 12px;color:#7b7b7b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Reporter</p>
                    <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Name:</strong> ${escapeHtml(reporterName)}</p>
                    <p style="margin:0;color:#333;font-size:15px;"><strong>Email:</strong> ${escapeHtml(reporterEmail)}</p>
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
    // Require a valid authenticated user (same pattern as the other hardened functions)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const { reporterName: bodyReporterName, reportedName, reportedId, alsoBlocked, details } = await req.json();

    // Reporter identity comes from the verified token, not the request body
    const reporterName = user.user_metadata?.full_name || user.user_metadata?.name || bodyReporterName || 'Unknown';
    const reporterEmail = user.email || 'Unknown';

    if (!reportedName && !reportedId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    console.log(`[User Report] ${reporterName} (${user.id}) reported ${reportedName} (${reportedId}), blocked: ${alsoBlocked}`);

    if (!RESEND_API_KEY) {
      console.error('[User Report] RESEND_API_KEY not set');
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const emailHtml = generateEmailHtml(
      reporterName,
      reporterEmail,
      reportedName || 'Unknown',
      reportedId || 'Unknown',
      alsoBlocked || false,
      details || '',
    );

    const emailText = `User Report\n\nReported: ${reportedName} (${reportedId})\nAlso blocked: ${alsoBlocked ? 'Yes' : 'No'}${details ? `\nDetails: ${details}` : ''}\nReporter: ${reporterName} (${reporterEmail})`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [NOTIFY_EMAIL],
        subject: `🚩 User Report — ${reportedName} (reported by ${reporterName})`,
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json().catch(() => ({ message: 'Unknown error' }));
      console.error('[User Report] Resend API error:', JSON.stringify(errorData));
      throw new Error(`Resend API error (${resendResponse.status}): ${JSON.stringify(errorData)}`);
    }

    const result = await resendResponse.json();
    console.log(`[User Report] Email sent. ID: ${result.id || 'N/A'}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('[User Report] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to send report' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
