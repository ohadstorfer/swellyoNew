import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

// Rewrite a Supabase public-object URL to its EXIF-corrected static thumbnail
// (the `image-thumbnails` bucket). The raw upload keeps its EXIF Orientation
// tag, which iOS's INImage(imageData:) in the Notification Service Extension
// ignores — so a portrait phone photo renders rotated 90° in the push. The
// 320px thumbnail (generate-thumbnail bakes orientation upright) renders
// correctly. Non-Supabase URLs (e.g. Google avatars) and URLs already pointing
// at the thumbnails bucket pass through unchanged.
// Mirrors src/services/media/thumbnails.ts → toThumbUrl(url, 320).
const THUMB_OBJECT_MARKER = '/storage/v1/object/public/'
const THUMBNAILS_BUCKET = 'image-thumbnails'
const THUMB_CACHE_VERSION = 2
const AVATAR_THUMB_SIZE = 320
function toThumbUrl(url: string | null): string | null {
  if (!url) return null
  const i = url.indexOf(THUMB_OBJECT_MARKER)
  if (i === -1) return url // not a Supabase public object — leave as-is
  const rest = url.slice(i + THUMB_OBJECT_MARKER.length) // "<bucket>/<path>"
  if (rest.startsWith(`${THUMBNAILS_BUCKET}/`)) return url // already a thumb
  const base = url.slice(0, i)
  return `${base}${THUMB_OBJECT_MARKER}${THUMBNAILS_BUCKET}/${rest}__${AVATAR_THUMB_SIZE}.jpg?v=${THUMB_CACHE_VERSION}`
}

/**
 * Push the reaction notification to the message owner.
 * recipientId  = the user whose message was reacted to
 * reactorId    = the user who placed the reaction
 * emoji        = e.g. "🤙🏼"
 * messageId    = the reacted-to message
 * conversationId for the deep-link
 */
async function sendReactionPush(
  supabase: any,
  recipientId: string,
  reactorId: string,
  emoji: string,
  messageId: string,
  conversationId: string,
): Promise<void> {
  if (recipientId === reactorId) {
    console.log('[Reaction Push] Skipping self-reaction');
    return;
  }

  // Block check (mirrors send-push-notification behavior).
  const { data: blockExists } = await supabase
    .from('user_blocks')
    .select('id')
    .or(
      `and(blocker_id.eq.${recipientId},blocked_id.eq.${reactorId}),` +
        `and(blocker_id.eq.${reactorId},blocked_id.eq.${recipientId})`,
    )
    .limit(1);
  if (blockExists && blockExists.length > 0) {
    console.log(`[Reaction Push] Skipping - block between ${recipientId} and ${reactorId}`);
    return;
  }

  // Mute check — if the message author has muted this conversation, skip the push.
  const { data: recipientMember } = await supabase
    .from('conversation_members')
    .select('preferences')
    .eq('conversation_id', conversationId)
    .eq('user_id', recipientId)
    .maybeSingle();
  const mutedUntilRaw = recipientMember?.preferences?.muted_until;
  if (mutedUntilRaw) {
    const mutedUntilMs = Date.parse(mutedUntilRaw);
    if (!isNaN(mutedUntilMs) && mutedUntilMs > Date.now()) {
      console.log(`[Reaction Push] Skipping ${recipientId} — muted until ${mutedUntilRaw}`);
      return;
    }
  }

  const { data: recipientSurfer } = await supabase
    .from('surfers')
    .select('expo_push_token')
    .eq('user_id', recipientId)
    .single();

  const pushToken = recipientSurfer?.expo_push_token;
  if (!pushToken) {
    console.log(`[Reaction Push] Skipping - no push token for ${recipientId}`);
    return;
  }

  const { data: reactorSurfer } = await supabase
    .from('surfers')
    .select('name, profile_image_url')
    .eq('user_id', reactorId)
    .single();
  const reactorName = reactorSurfer?.name || 'Someone';
  const reactorAvatarUrl: string | null = reactorSurfer?.profile_image_url ?? null;

  // Resolve conversation kind + the image the push should show — mirrors
  // send-push-notification's buildMessageContext: DM → reactor's photo,
  // group → group hero image. (iOS stamps the Swellyo badge corner itself.)
  const { data: conv } = await supabase
    .from('conversations')
    .select('is_direct, title, metadata')
    .eq('id', conversationId)
    .single();
  const isGroup = conv ? conv.is_direct === false : false;
  const groupName: string | null = isGroup ? (conv?.title ?? null) : null;
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
  // Use the EXIF-corrected thumbnail so portrait avatars don't render sideways.
  const avatarUrl = toThumbUrl(isGroup ? groupImageUrl : reactorAvatarUrl);

  // Snippet of the reacted-to message so the recipient knows which one.
  const { data: msg } = await supabase
    .from('messages')
    .select('body, type, deleted')
    .eq('id', messageId)
    .single();

  if (!msg || msg.deleted) {
    console.log('[Reaction Push] Skipping - message missing or deleted');
    return;
  }

  let snippet: string;
  if (msg.type === 'image') snippet = 'your photo';
  else if (msg.type === 'video') snippet = 'your video';
  else if (msg.type === 'audio') snippet = 'your voice message';
  else {
    const text = (msg.body || '').trim();
    snippet = text.length === 0
      ? 'your message'
      : `"${text.length > 60 ? text.substring(0, 57) + '...' : text}"`;
  }

  const title = reactorName;
  const body = `Reacted ${emoji} to ${snippet}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (EXPO_ACCESS_TOKEN) headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`;

  const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: pushToken,
      title,
      body,
      sound: 'default',
      // High priority so it reliably wakes the iOS Notification Service Extension.
      priority: 'high',
      // mutableContent lets the iOS extension intercept and rebuild the push as a
      // Communication Notification (big avatar). Without it iOS shows the app icon.
      mutableContent: true,
      // Android: same avatar/hero as the notification's large icon. iOS ignores
      // this and builds the rich avatar from `data` instead.
      ...(avatarUrl ? { richContent: { image: avatarUrl } } : {}),
      data: {
        kind: 'reaction',
        conversationId,
        senderId: reactorId,
        senderName: reactorName,
        isGroup,
        groupName: groupName ?? '',
        avatarUrl: avatarUrl ?? '',
        messageId,
        emoji,
      },
    }),
  });

  if (!pushResponse.ok) {
    const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }));
    console.error(
      `[Reaction Push] Expo API error (${pushResponse.status}):`,
      JSON.stringify(errorData),
    );
    return;
  }

  const result = await pushResponse.json();
  console.log(`[Reaction Push] Sent to ${recipientId}:`, JSON.stringify(result));

  if (result.data?.status === 'error' && result.data?.details?.error === 'DeviceNotRegistered') {
    console.log(`[Reaction Push] Clearing stale token for ${recipientId}`);
    await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .eq('user_id', recipientId);
  }
}

serve(async (req) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Reaction Push] [${requestId}] Method: ${req.method}`);

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
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    console.log(`[Reaction Push] [${requestId}] Body:`, JSON.stringify(body));

    // Supabase Database Webhook (record) OR direct call.
    let messageId: string | undefined;
    let reactorId: string | undefined;
    let emoji: string | undefined;
    if (body.record) {
      messageId = body.record.message_id;
      reactorId = body.record.user_id;
      emoji = body.record.reaction;
    } else {
      messageId = body.message_id;
      reactorId = body.user_id ?? body.reactor_id;
      emoji = body.reaction ?? body.emoji;
    }

    if (!messageId || !reactorId || !emoji) {
      console.error(`[Reaction Push] [${requestId}] Missing fields`, { messageId, reactorId, emoji });
      return new Response(
        JSON.stringify({ error: 'Missing required fields: message_id, user_id, reaction' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Resolve the reacted-to message → owner + conversation.
    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .select('sender_id, conversation_id, deleted, is_system')
      .eq('id', messageId)
      .single();

    if (msgErr || !msg) {
      console.error(`[Reaction Push] [${requestId}] Message lookup failed`, msgErr);
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (msg.deleted || msg.is_system) {
      console.log(`[Reaction Push] [${requestId}] Skipping deleted/system message`);
      return new Response(JSON.stringify({ message: 'Skipped deleted/system message' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await sendReactionPush(
      supabase,
      msg.sender_id,
      reactorId,
      emoji,
      messageId,
      msg.conversation_id,
    );

    return new Response(
      JSON.stringify({ message: 'Reaction notification processed', request_id: requestId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error(`[Reaction Push] [${requestId}] Unexpected error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        request_id: requestId,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
