import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

/**
 * Push notification to the host when a new join request is created.
 * Triggered by Supabase DB webhook on INSERT into group_trip_join_requests.
 */
async function sendHostNotification(
  supabase: any,
  requestId: string,
  tripId: string,
  requesterId: string
): Promise<void> {
  // Get host_id and trip title
  const { data: trip, error: tripError } = await supabase
    .from('group_trips')
    .select('host_id, title, destination_country, destination_area')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    console.error('[Trip Request Notif] Error loading trip:', tripError);
    return;
  }

  const hostId = trip.host_id;

  // Don't notify the host of their own request (shouldn't happen because RLS forbids it)
  if (hostId === requesterId) {
    return;
  }

  // Get host's push token
  const { data: hostSurfer } = await supabase
    .from('surfers')
    .select('expo_push_token')
    .eq('user_id', hostId)
    .single();

  const pushToken = hostSurfer?.expo_push_token;
  if (!pushToken) {
    console.log(`[Trip Request Notif] No push token for host ${hostId}`);
    return;
  }

  // Get requester's name
  const { data: requesterSurfer } = await supabase
    .from('surfers')
    .select('name')
    .eq('user_id', requesterId)
    .single();

  const requesterName = requesterSurfer?.name || 'Someone';

  const tripLabel =
    trip.title ||
    [trip.destination_area, trip.destination_country].filter(Boolean).join(', ') ||
    'your trip';

  const title = 'New trip request';
  const body = `${requesterName} wants to join ${tripLabel}`;

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
      data: { type: 'trip_join_request', tripId, requestId },
    }),
  });

  if (!pushResponse.ok) {
    const errorData = await pushResponse.json().catch(() => ({ message: 'Unknown error' }));
    console.error(`[Trip Request Notif] Expo API error (${pushResponse.status}):`, JSON.stringify(errorData));
    return;
  }

  const result = await pushResponse.json();
  console.log(`[Trip Request Notif] Sent to ${hostId}:`, JSON.stringify(result));

  // Clear stale token if device is no longer registered
  if (result.data?.status === 'error' && result.data?.details?.error === 'DeviceNotRegistered') {
    console.log(`[Trip Request Notif] Clearing stale token for ${hostId}`);
    await supabase
      .from('surfers')
      .update({ expo_push_token: null })
      .eq('user_id', hostId);
  }
}

serve(async (req) => {
  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[Trip Request Notif] [${requestId}] ${req.method}`);

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

    // Supabase DB webhook format: { type, table, record, schema, old_record }
    let recordId: string | undefined;
    let trip_id: string | undefined;
    let requester_id: string | undefined;
    let status: string | undefined;

    if (body.record) {
      recordId = body.record.id;
      trip_id = body.record.trip_id;
      requester_id = body.record.requester_id;
      status = body.record.status;
    } else {
      recordId = body.id;
      trip_id = body.trip_id;
      requester_id = body.requester_id;
      status = body.status;
    }

    if (!recordId || !trip_id || !requester_id) {
      console.error(`[Trip Request Notif] [${requestId}] Missing required fields`);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, trip_id, requester_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Only notify on initial pending request (extra safety in case webhook fires on update)
    if (status && status !== 'pending') {
      console.log(`[Trip Request Notif] [${requestId}] Skipping non-pending status: ${status}`);
      return new Response(
        JSON.stringify({ message: 'Skipped non-pending status' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await sendHostNotification(supabase, recordId, trip_id, requester_id);

    return new Response(
      JSON.stringify({ message: 'Notification processed', request_id: requestId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[Trip Request Notif] [${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        request_id: requestId,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
