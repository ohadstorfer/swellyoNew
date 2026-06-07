import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

/**
 * Push notification fan-out to every host/admin of a surftrip when a new
 * pending join request is created. Triggered by a Supabase DB webhook on
 * INSERT into surftrip_join_requests.
 */
async function notifySurftripAdmins(
  supabase: any,
  requestId: string,
  groupId: string,
  requesterId: string
): Promise<void> {
  const { data: group, error: groupError } = await supabase
    .from('surftrip_groups')
    .select('id, name, conversation_id')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('[Surftrip Request Notif] Error loading group:', groupError);
    return;
  }

  const { data: admins, error: adminsError } = await supabase
    .from('surftrip_group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .in('role', ['host', 'admin']);

  if (adminsError) {
    console.error('[Surftrip Request Notif] Error loading admins:', adminsError);
    return;
  }

  let adminIds = (admins || [])
    .map((r: any) => r.user_id)
    .filter((uid: string) => uid !== requesterId);

  if (adminIds.length === 0) {
    console.log('[Surftrip Request Notif] No admins to notify for', groupId);
    return;
  }

  // Mute filter — drop admins who muted the surftrip conversation.
  if (group.conversation_id && adminIds.length > 0) {
    const { data: mutedRows } = await supabase
      .from('conversation_members')
      .select('user_id, preferences')
      .eq('conversation_id', group.conversation_id)
      .in('user_id', adminIds);
    const now = Date.now();
    const mutedSet = new Set(
      (mutedRows || [])
        .filter((r: any) => {
          const raw = r.preferences?.muted_until;
          if (!raw) return false;
          const ms = Date.parse(raw);
          return !isNaN(ms) && ms > now;
        })
        .map((r: any) => r.user_id),
    );
    if (mutedSet.size > 0) {
      console.log(
        `[Surftrip Request Notif] Skipping ${mutedSet.size} muted admin(s):`,
        [...mutedSet].join(', '),
      );
      adminIds = adminIds.filter((uid: string) => !mutedSet.has(uid));
    }
    if (adminIds.length === 0) {
      console.log('[Surftrip Request Notif] All admins muted — nothing to send');
      return;
    }
  }

  const { data: surfers } = await supabase
    .from('surfers')
    .select('user_id, expo_push_token, name')
    .in('user_id', [...adminIds, requesterId]);

  const requesterName =
    (surfers || []).find((s: any) => s.user_id === requesterId)?.name || 'Someone';

  const tripLabel = group.name || 'your surftrip';
  const title = 'New surftrip request';
  const body = `${requesterName} wants to join ${tripLabel}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (EXPO_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  for (const adminId of adminIds) {
    const surfer = (surfers || []).find((s: any) => s.user_id === adminId);
    const pushToken = surfer?.expo_push_token;
    if (!pushToken) {
      console.log(`[Surftrip Request Notif] No push token for admin ${adminId}`);
      continue;
    }

    try {
      const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: pushToken,
          title,
          body,
          sound: 'default',
          data: {
            type: 'surftrip_join_request',
            surftripId: groupId,
            requestId,
          },
        }),
      });

      if (!pushResponse.ok) {
        const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }));
        console.error(
          `[Surftrip Request Notif] Expo API error for ${adminId} (${pushResponse.status}):`,
          JSON.stringify(errorData)
        );
        continue;
      }

      const result = await pushResponse.json();
      console.log(`[Surftrip Request Notif] Sent to ${adminId}:`, JSON.stringify(result));

      if (
        result.data?.status === 'error' &&
        result.data?.details?.error === 'DeviceNotRegistered'
      ) {
        console.log(`[Surftrip Request Notif] Clearing stale token for ${adminId}`);
        await supabase
          .from('surfers')
          .update({ expo_push_token: null })
          .eq('user_id', adminId);
      }
    } catch (err) {
      console.error(`[Surftrip Request Notif] Push send failed for ${adminId}:`, err);
    }
  }
}

serve(async (req) => {
  const traceId = crypto.randomUUID().substring(0, 8);
  console.log(`[Surftrip Request Notif] [${traceId}] ${req.method}`);

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
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));

    let recordId: string | undefined;
    let group_id: string | undefined;
    let requester_id: string | undefined;
    let status: string | undefined;

    if (body.record) {
      recordId = body.record.id;
      group_id = body.record.group_id;
      requester_id = body.record.requester_id;
      status = body.record.status;
    } else {
      recordId = body.id;
      group_id = body.group_id;
      requester_id = body.requester_id;
      status = body.status;
    }

    if (!recordId || !group_id || !requester_id) {
      console.error(`[Surftrip Request Notif] [${traceId}] Missing required fields`);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, group_id, requester_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (status && status !== 'pending') {
      console.log(`[Surftrip Request Notif] [${traceId}] Skipping non-pending status: ${status}`);
      return new Response(
        JSON.stringify({ message: 'Skipped non-pending status' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await notifySurftripAdmins(supabase, recordId, group_id, requester_id);

    return new Response(
      JSON.stringify({ message: 'Notification processed', request_id: traceId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[Surftrip Request Notif] [${traceId}] Error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        request_id: traceId,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
