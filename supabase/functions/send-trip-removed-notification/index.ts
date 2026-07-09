import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * Notify a participant who was removed from a trip by the host.
 * Invoked from groupTripsService.removeParticipant after the DELETE succeeds.
 *
 * Writes a member_removed feed row (5.3); the AFTER INSERT enqueue trigger turns
 * it into a queued push (P0) and the queue dispatcher is the sole sender — it
 * handles mute, missing-token, and DeviceNotRegistered itself. The direct Expo
 * send that used to live here was removed at cutover (2026-06-09).
 */
async function sendRemovedNotification(
  supabase: any,
  tripId: string,
  removedUserId: string
): Promise<void> {
  const { data: trip, error: tripError } = await supabase
    .from('group_trips')
    .select('title')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    console.error('[Trip Removed Notif] Error loading trip:', tripError);
    return;
  }

  const { error: feedError } = await supabase.from('notifications').insert({
    recipient_id: removedUserId,
    trip_id: tripId,
    type: 'member_removed',
    audience: 'user',
    entity_type: 'group_trip',
    entity_id: tripId,
    data: { trip_title: (trip as any).title ?? null },
  });
  if (feedError) {
    console.error('[Trip Removed Notif] member_removed feed insert failed:', feedError);
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
    const { data: hostRow } = await supabase
      .from('group_trip_participants')
      .select('user_id')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .eq('role', 'host')
      .maybeSingle();
    if (!hostRow) {
      console.warn(`[Trip Removed Notif] [${reqId}] Forbidden: ${user.id} is not a host of ${tripId}`);
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
