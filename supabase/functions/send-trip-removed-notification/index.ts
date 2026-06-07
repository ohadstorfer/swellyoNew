import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

/**
 * Push notification to a participant who was removed from a trip by the host.
 * Invoked from groupTripsService.removeParticipant after the DELETE succeeds.
 */
async function sendRemovedNotification(
  supabase: any,
  tripId: string,
  removedUserId: string
): Promise<void> {
  const { data: trip, error: tripError } = await supabase
    .from('group_trips')
    .select('title, group_trip_destinations(short_label, name, country)')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    console.error('[Trip Removed Notif] Error loading trip:', tripError);
    return;
  }

  // Mute check — if the removed user muted the linked group-trip conversation, skip the push.
  const { data: tripConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('metadata->>trip_id', tripId)
    .maybeSingle();
  if (tripConv?.id) {
    const { data: member } = await supabase
      .from('conversation_members')
      .select('preferences')
      .eq('conversation_id', tripConv.id)
      .eq('user_id', removedUserId)
      .maybeSingle();
    const mutedUntilRaw = member?.preferences?.muted_until;
    if (mutedUntilRaw) {
      const mutedUntilMs = Date.parse(mutedUntilRaw);
      if (!isNaN(mutedUntilMs) && mutedUntilMs > Date.now()) {
        console.log(`[Trip Removed Notif] Skipping ${removedUserId} — muted until ${mutedUntilRaw}`);
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
    console.log(`[Trip Removed Notif] No push token for user ${removedUserId}`);
    return;
  }

  const dest = Array.isArray((trip as any).group_trip_destinations)
    ? (trip as any).group_trip_destinations[0]
    : (trip as any).group_trip_destinations;
  const tripLabel =
    trip.title ||
    dest?.short_label ||
    dest?.name ||
    dest?.country ||
    'a trip';

  const title = 'You were removed from a trip';
  const body = `The host removed you from ${tripLabel}.`;

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
      data: { type: 'trip_removed', tripId },
    }),
  });

  if (!pushResponse.ok) {
    const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }));
    console.error(`[Trip Removed Notif] Expo API error (${pushResponse.status}):`, JSON.stringify(errorData));
    return;
  }

  const result = await pushResponse.json();
  console.log(`[Trip Removed Notif] Sent to ${removedUserId}:`, JSON.stringify(result));

  if (result.data?.status === 'error' && result.data?.details?.error === 'DeviceNotRegistered') {
    console.log(`[Trip Removed Notif] Clearing stale token for ${removedUserId}`);
    await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .eq('user_id', removedUserId);
  }
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);
  console.log(`[Trip Removed Notif] [${reqId}] ${req.method}`);

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
    const tripId = body.trip_id || body.tripId;
    const removedUserId = body.removed_user_id || body.removedUserId;

    if (!tripId || !removedUserId) {
      console.error(`[Trip Removed Notif] [${reqId}] Missing required fields`);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: trip_id, removed_user_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Caller authorization: invoked from the client by the trip host doing the
    // removal. Verify the caller's JWT and that they are the host of this trip
    // (group_trips has no admin role). Self-leave uses leaveTrip() and never
    // hits here.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const { data: trip } = await supabase
      .from('group_trips')
      .select('host_id')
      .eq('id', tripId)
      .maybeSingle();
    if (!trip || trip.host_id !== user.id) {
      console.warn(`[Trip Removed Notif] [${reqId}] Forbidden: ${user.id} is not host of ${tripId}`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await sendRemovedNotification(supabase, tripId, removedUserId);

    return new Response(
      JSON.stringify({ message: 'Notification processed', request_id: reqId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[Trip Removed Notif] [${reqId}] Error:`, error);
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
