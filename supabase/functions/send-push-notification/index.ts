import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

// Rewrite an image URL to its EXIF-corrected static thumbnail. The raw upload
// keeps its EXIF Orientation tag, which iOS's INImage(imageData:) in the
// Notification Service Extension ignores — so a portrait phone photo renders
// rotated 90° in the push. The 320px thumbnail (generate-thumbnail /
// generate-thumbnail-s3 bake orientation upright) renders correctly.
//
// Two storage backends, two URL shapes:
//   • Supabase public object → swap into the separate `image-thumbnails` bucket
//   • S3 (`swellyo-images`)  → variants live in the SAME bucket at
//     `<sourceKey>__<size>.jpg`, so just append the suffix (no bucket swap)
// Anything else (e.g. Google avatars) and URLs that are already a variant pass
// through unchanged.
// Mirrors src/services/media/thumbnails.ts → toThumbUrl(url, 320).
const THUMB_OBJECT_MARKER = '/storage/v1/object/public/'
const THUMBNAILS_BUCKET = 'image-thumbnails'
const S3_IMAGES_MARKER = 'swellyo-images.s3'
const VARIANT_RE = /__(?:\d+|\d+w)\.jpg(?:\?|$)/
const THUMB_CACHE_VERSION = 2
const AVATAR_THUMB_SIZE = 320
function toThumbUrl(url: string | null): string | null {
  if (!url) return null
  if (url.includes(S3_IMAGES_MARKER)) {
    if (VARIANT_RE.test(url)) return url // already a variant
    return `${url}__${AVATAR_THUMB_SIZE}.jpg?v=${THUMB_CACHE_VERSION}`
  }
  const i = url.indexOf(THUMB_OBJECT_MARKER)
  if (i === -1) return url // not a Supabase public object — leave as-is
  const rest = url.slice(i + THUMB_OBJECT_MARKER.length) // "<bucket>/<path>"
  if (rest.startsWith(`${THUMBNAILS_BUCKET}/`)) return url // already a thumb
  const base = url.slice(0, i)
  return `${base}${THUMB_OBJECT_MARKER}${THUMBNAILS_BUCKET}/${rest}__${AVATAR_THUMB_SIZE}.jpg?v=${THUMB_CACHE_VERSION}`
}

// Both platforms expand a long notification body on demand (iOS: long-press,
// Android: the chevron), so we send the message near-whole and let the OS decide
// how much to reveal. The ceiling is the ~4KiB Expo/APNs payload, and the body
// rides in it TWICE: once as the visible `body`, once as `data.message` (which
// the iOS extension reads to rebuild the Communication Notification). Hence a
// byte budget, not just a character count — 500 emoji would be 2000 bytes each
// time and blow the payload, which Expo rejects outright, losing the push.
const MAX_BODY_CHARS = 500
const MAX_BODY_BYTES = 1200
const BODY_ENCODER = new TextEncoder()
function truncateForPush(text: string): string {
  const chars = Array.from(text) // code points — never split a surrogate pair
  let end = Math.min(chars.length, MAX_BODY_CHARS)
  let bytes = 0
  for (let i = 0; i < end; i++) {
    bytes += BODY_ENCODER.encode(chars[i]).length
    if (bytes > MAX_BODY_BYTES) {
      end = i
      break
    }
  }
  if (end >= chars.length) return text
  return chars.slice(0, end).join('').trimEnd() + '…'
}

/**
 * Shared context for one inbound message — resolved once per webhook, not per
 * recipient. Holds everything the notification copy + the iOS rich-avatar
 * extension need (sender identity, conversation kind, the image to show).
 */
interface MessageContext {
  senderName: string;
  senderAvatarUrl: string | null;
  isGroup: boolean;
  groupName: string | null;
  groupImageUrl: string | null;
  body: string;
}

/**
 * Resolve sender, message body and conversation kind (DM vs group), plus the
 * image the push should display:
 *   • DM    → the sender's profile photo (iOS adds the Swellyo badge corner)
 *   • Group → the group's hero image      (iOS adds the Swellyo badge corner)
 */
async function buildMessageContext(
  supabase: any,
  senderId: string,
  messageId: string,
  conversationId: string
): Promise<MessageContext | null> {
  const { data: senderSurfer } = await supabase
    .from('surfers')
    .select('name, profile_image_url')
    .eq('user_id', senderId)
    .single();

  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('body, type')
    .eq('id', messageId)
    .single();

  if (msgError || !msg) {
    console.error('[Push Notification] Error loading message:', msgError);
    return null;
  }

  let body: string;
  if (msg.type === 'image') {
    body = 'Sent a photo';
  } else if (msg.type === 'audio') {
    body = 'Sent a voice message';
  } else if (msg.type === 'video') {
    body = 'Sent a video';
  } else {
    body = truncateForPush(msg.body || '');
  }

  // Conversation kind + group image (group chats link to a trip via metadata.trip_id).
  const { data: conv } = await supabase
    .from('conversations')
    .select('is_direct, title, metadata')
    .eq('id', conversationId)
    .single();

  const isGroup = conv ? conv.is_direct === false : false;
  let groupImageUrl: string | null = null;
  if (isGroup) {
    const tripId = conv?.metadata?.trip_id;
    if (tripId) {
      const { data: trip } = await supabase
        .from('group_trips')
        .select('hero_image_url')
        .eq('id', tripId)
        .single();
      groupImageUrl = trip?.hero_image_url ?? null;
    }
  }

  return {
    senderName: senderSurfer?.name || 'Someone',
    senderAvatarUrl: senderSurfer?.profile_image_url ?? null,
    isGroup,
    groupName: isGroup ? (conv?.title ?? null) : null,
    groupImageUrl,
    body,
  };
}

/**
 * Send push notification via Expo Push API
 */
async function sendPushNotification(
  supabase: any,
  recipientId: string,
  senderId: string,
  conversationId: string,
  ctx: MessageContext
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

  const { senderName, body, isGroup, groupName } = ctx;
  // The image the iOS extension fetches for the big avatar (DM = sender photo,
  // group = group hero). iOS stamps the Swellyo app icon in the corner itself.
  // Use the EXIF-corrected thumbnail so portrait avatars don't render sideways.
  const avatarUrl = toThumbUrl(isGroup ? ctx.groupImageUrl : ctx.senderAvatarUrl);

  // Fallback text (shown on devices/builds without the rich extension):
  //  • DM    → "Sender" / message
  //  • group → "Group name" / "Sender: message"
  const title = isGroup ? (groupName || 'New message') : senderName;
  const displayBody = isGroup ? `${senderName}: ${body}` : body;

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
      title,
      body: displayBody,
      sound: 'default',
      // Android: route to the app-created 'default' channel (importance MAX,
      // exists on every binary since the original push commit — channel setup
      // runs before the token is fetched). Without an explicit channelId,
      // FCM v1 routes to its own fallback channel at medium importance and the
      // notification lands in the tray WITHOUT a heads-up banner.
      channelId: 'default',
      // High priority so the message arrives promptly and reliably wakes the
      // iOS Notification Service Extension (iMessage-style delivery).
      priority: 'high',
      // mutableContent lets the iOS Notification Service Extension intercept the
      // push and rebuild it as a Communication Notification (big avatar + badge).
      mutableContent: true,
      // Android: show the same avatar/hero as the notification's large icon
      // (rounded thumbnail). expo-notifications maps richContent.image →
      // FCM notification.image → setLargeIcon. iOS ignores this; its extension
      // builds the rich avatar from `data` instead.
      ...(avatarUrl ? { richContent: { image: avatarUrl } } : {}),
      data: {
        type: 'message',
        conversationId,
        senderId,
        senderName,
        message: body,
        isGroup,
        groupName: groupName ?? '',
        avatarUrl: avatarUrl ?? '',
      },
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
    // Caller authentication: this function is triggered by a Supabase DB
    // webhook that sends Authorization: Bearer <service_role>. Accept if that
    // bearer matches the service-role key, OR if x-internal-secret matches
    // ADMIN_FUNCTION_SECRET (fallback for webhooks without the service-role
    // bearer). The public anon key is never accepted. Fails closed.
    {
      const authHeader = req.headers.get('Authorization') || '';
      const bearerOk = SUPABASE_SERVICE_ROLE_KEY.length > 0 && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
      const provided = req.headers.get('x-internal-secret') || '';
      const expected = Deno.env.get('ADMIN_FUNCTION_SECRET') || '';
      const secretOk = expected.length > 0 && provided === expected;
      if (!bearerOk && !secretOk) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }

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
      .select('user_id, preferences')
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

    // Resolve sender / message / conversation kind + image ONCE for this message.
    const ctx = await buildMessageContext(supabase, sender_id, message_id, conversation_id);
    if (!ctx) {
      return new Response(
        JSON.stringify({ error: 'Could not build message context', request_id: requestId }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = Date.now();

    // Send push notification to each recipient, skipping muted members
    for (const member of members) {
      const mutedUntilRaw = member.preferences?.muted_until;
      if (mutedUntilRaw) {
        const mutedUntilMs = Date.parse(mutedUntilRaw);
        if (!isNaN(mutedUntilMs) && mutedUntilMs > now) {
          console.log(`[Push Notification] [${requestId}] Skipping ${member.user_id} — muted until ${mutedUntilRaw}`);
          continue;
        }
      }

      try {
        await sendPushNotification(supabase, member.user_id, sender_id, conversation_id, ctx);
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
