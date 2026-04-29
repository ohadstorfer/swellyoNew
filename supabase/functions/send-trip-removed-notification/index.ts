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
    .select('title, destination_country, destination_area')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    console.error('[Trip Removed Notif] Error loading trip:', tripError);
    return;
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

  const tripLabel =
    trip.title ||
    [trip.destination_area, trip.destination_country].filter(Boolean).join(', ') ||
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
