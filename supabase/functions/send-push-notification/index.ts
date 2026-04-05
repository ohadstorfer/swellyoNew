import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

/**
 * Send push notification via Expo Push API
 */
async function sendPushNotification(
  supabase: any,
  recipientId: string,
  senderId: string,
  messageId: string,
  conversationId: string
): Promise<void> {
  // Check if either user has blocked the other
  const { data: blockExists } = await supabase
    .from('user_blocks')
    .select('id')
    .or(`and(blocker_id.eq.${recipientId},blocked_id.eq.${senderId}),and(blocker_id.eq.${senderId},blocked_id.eq.${recipientId})`)
    .limit(1);

  if (blockExists && blockExists.length > 0) {
    console.log(`[Push Notification] Skipping - block exists between ${recipientId} and ${senderId}`);
    return;
  }

  // Get recipient's push token
  const { data: recipientSurfer } = await supabase
    .from('surfers')
    .select('expo_push_token')
    .eq('user_id', recipientId)
    .single();

  const pushToken = recipientSurfer?.expo_push_token;
  if (!pushToken) {
    console.log(`[Push Notification] Skipping - no push token for recipient ${recipientId}`);
    return;
  }

  // Get sender name
  const { data: senderSurfer } = await supabase
    .from('surfers')
    .select('name')
    .eq('user_id', senderId)
    .single();

  const senderName = senderSurfer?.name || 'Someone';

  // Get message body
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('body, type')
    .eq('id', messageId)
    .single();

  if (msgError || !msg) {
    console.error('[Push Notification] Error loading message:', msgError);
    return;
  }

  // Build notification body
  let body: string;
  if (msg.type === 'image') {
    body = 'Sent a photo';
  } else {
    body = msg.body || '';
    if (body.length > 100) {
      body = body.substring(0, 97) + '...';
    }
  }

  // Send via Expo Push API
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (EXPO_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: pushToken,
      title: senderName,
      body,
      sound: 'default',
      data: { conversationId, senderId },
    }),
  });

  if (!pushResponse.ok) {
    const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }));
    console.error(`[Push Notification] Expo API error (${pushResponse.status}):`, JSON.stringify(errorData));
    return;
  }

  const result = await pushResponse.json();
  console.log(`[Push Notification] Sent to ${recipientId}:`, JSON.stringify(result));

  // Handle DeviceNotRegistered - clear stale token
  if (result.data?.status === 'error' && result.data?.details?.error === 'DeviceNotRegistered') {
    console.log(`[Push Notification] Clearing stale token for ${recipientId} (DeviceNotRegistered)`);
    await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .eq('user_id', recipientId);
  }
}

/**
 * Main handler
 */
serve(async (req) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Push Notification] [${requestId}] Request received - Method: ${req.method}`);

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const body = await req.json().catch(() => ({}));
    console.log(`[Push Notification] [${requestId}] Request body:`, JSON.stringify(body));

    // Handle Supabase Database Webhook format or direct format
    let message_id: string | undefined;
    let conversation_id: string | undefined;
    let sender_id: string | undefined;

    if (body.record) {
      message_id = body.record.id;
      conversation_id = body.record.conversation_id;
      sender_id = body.record.sender_id;
    } else {
      message_id = body.message_id || body.id;
      conversation_id = body.conversation_id;
      sender_id = body.sender_id;
    }

    if (!message_id || !conversation_id || !sender_id) {
      console.error(`[Push Notification] [${requestId}] Missing required fields`);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: message_id, conversation_id, sender_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Skip system and deleted messages (extra safety — trigger should already filter these)
    const { data: messageCheck } = await supabase
      .from('messages')
      .select('is_system, deleted')
      .eq('id', message_id)
      .single();

    if (messageCheck?.is_system || messageCheck?.deleted) {
      console.log(`[Push Notification] [${requestId}] Skipping system/deleted message`);
      return new Response(
        JSON.stringify({ message: 'Skipped system/deleted message' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get conversation members (exclude sender)
    const { data: members, error: membersError } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversation_id)
      .neq('user_id', sender_id);

    if (membersError) {
      console.error(`[Push Notification] [${requestId}] Error fetching members:`, membersError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch conversation members' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!members || members.length === 0) {
      console.log(`[Push Notification] [${requestId}] No recipients found`);
      return new Response(
        JSON.stringify({ message: 'No recipients to notify' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Send push notification to each recipient
    for (const member of members) {
      try {
        await sendPushNotification(supabase, member.user_id, sender_id, message_id, conversation_id);
      } catch (error) {
        console.error(`[Push Notification] [${requestId}] Error for recipient ${member.user_id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({ message: 'Push notifications processed', request_id: requestId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[Push Notification] [${requestId}] Unexpected error:`, error);
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
