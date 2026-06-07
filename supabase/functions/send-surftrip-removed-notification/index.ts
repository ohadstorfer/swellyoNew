import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

/**
 * Push notification to a member who was removed from a surftrip by a host or admin.
 * Invoked from surftripsService.removeMember after the DELETE succeeds.
 */
async function sendRemovedNotification(
  supabase: any,
  groupId: string,
  removedUserId: string
): Promise<void> {
  const { data: group, error: groupError } = await supabase
    .from('surftrip_groups')
    .select('name, conversation_id')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('[Surftrip Removed Notif] Error loading group:', groupError);
    return;
  }

  // Mute check — if the removed user muted the surftrip conversation, skip the push.
  if (group.conversation_id) {
    const { data: member } = await supabase
      .from('conversation_members')
      .select('preferences')
      .eq('conversation_id', group.conversation_id)
      .eq('user_id', removedUserId)
      .maybeSingle();
    const mutedUntilRaw = member?.preferences?.muted_until;
    if (mutedUntilRaw) {
      const mutedUntilMs = Date.parse(mutedUntilRaw);
      if (!isNaN(mutedUntilMs) && mutedUntilMs > Date.now()) {
        console.log(`[Surftrip Removed Notif] Skipping ${removedUserId} — muted until ${mutedUntilRaw}`);
        return;
      }
    }
  }

  const { data: surfer } = await supabase
    .from('surfers')
    .select('expo_push_token')
    .eq('user_id', removedUserId)
    .single();

  const pushToken = surfer?.expo_push_token;
  if (!pushToken) {
    console.log(`[Surftrip Removed Notif] No push token for user ${removedUserId}`);
    return;
  }

  const groupLabel = group.name || 'a surftrip';

  const title = 'You were removed from a surftrip';
  const body = `You were removed from ${groupLabel}.`;

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
      body,
      sound: 'default',
      data: { type: 'surftrip_removed', surftripId: groupId },
    }),
  });

  if (!pushResponse.ok) {
    const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }));
    console.error(`[Surftrip Removed Notif] Expo API error (${pushResponse.status}):`, JSON.stringify(errorData));
    return;
  }

  const result = await pushResponse.json();
  console.log(`[Surftrip Removed Notif] Sent to ${removedUserId}:`, JSON.stringify(result));

  if (result.data?.status === 'error' && result.data?.details?.error === 'DeviceNotRegistered') {
    console.log(`[Surftrip Removed Notif] Clearing stale token for ${removedUserId}`);
    await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .eq('user_id', removedUserId);
  }
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);
  console.log(`[Surftrip Removed Notif] [${reqId}] ${req.method}`);

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
        persistSession: false,
      },
    });

    const body = await req.json().catch(() => ({}));
    const groupId = body.group_id || body.groupId || body.surftrip_id || body.surftripId;
    const removedUserId = body.removed_user_id || body.removedUserId;

    if (!groupId || !removedUserId) {
      console.error(`[Surftrip Removed Notif] [${reqId}] Missing required fields`);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: group_id, removed_user_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Caller authorization: this function is invoked from the client by the
    // host/admin doing the removal. Verify the caller's JWT and that they are
    // actually a host or admin of this group (mirrors the RLS DELETE policy on
    // surftrip_group_members). Self-leave uses leaveGroup() and never hits here.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const { data: membership } = await supabase
      .from('surftrip_group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .in('role', ['host', 'admin'])
      .maybeSingle();
    if (!membership) {
      console.warn(`[Surftrip Removed Notif] [${reqId}] Forbidden: ${user.id} is not host/admin of ${groupId}`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await sendRemovedNotification(supabase, groupId, removedUserId);

    return new Response(
      JSON.stringify({ message: 'Notification processed', request_id: reqId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[Surftrip Removed Notif] [${reqId}] Error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        request_id: reqId,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
