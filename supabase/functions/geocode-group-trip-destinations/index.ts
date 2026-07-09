import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

const GOOGLE_GEOCODING_API_KEY = Deno.env.get('GOOGLE_GEOCODING_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INTERNAL_SECRET = Deno.env.get('GEOCODE_INTERNAL_SECRET') || ''

interface RequestBody {
  trip_id?: string
}

interface DestinationRow {
  trip_id: string
  place_id: string | null
  lat: number | null
  lng: number | null
}

interface EnrichedFields {
  admin_level_1: string | null
  admin_level_2: string | null
  types: string[] | null
  geo_bucket_4: string | null
  geo_bucket_5: string | null
  geo_bucket_6: string | null
  lat?: number
  lng?: number
}

// --- Geohash (copied from geocode-user-destinations) ------------------------
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

function encodeGeohash(lat: number, lng: number, precision: number): string {
  const latitude = Math.max(-90, Math.min(90, lat))
  const longitude = Math.max(-180, Math.min(180, lng))

  let latMin = -90.0
  let latMax = 90.0
  let lngMin = -180.0
  let lngMax = 180.0

  let hash = ''
  let isEvenBit = true
  let bit = 0
  let ch = 0

  while (hash.length < precision) {
    if (isEvenBit) {
      const mid = (lngMin + lngMax) / 2
      if (longitude >= mid) {
        ch |= 1 << (4 - bit)
        lngMin = mid
      } else {
        lngMax = mid
      }
    } else {
      const mid = (latMin + latMax) / 2
      if (latitude >= mid) {
        ch |= 1 << (4 - bit)
        latMin = mid
      } else {
        latMax = mid
      }
    }

    isEvenBit = !isEvenBit
    if (bit < 4) {
      bit++
    } else {
      hash += GEOHASH_BASE32[ch]
      bit = 0
      ch = 0
    }
  }

  return hash
}

function getComponent(
  components: { long_name: string; types: string[] }[],
  type: string
): string | null {
  const c = components.find((x) => x.types.includes(type))
  return c ? c.long_name : null
}

// --- Google Geocoding by place_id -------------------------------------------
interface GeocodeByPlaceIdResult {
  admin_level_1: string | null
  admin_level_2: string | null
  types: string[] | null
  lat: number | null
  lng: number | null
}

async function geocodeByPlaceId(placeId: string): Promise<GeocodeByPlaceIdResult | null> {
  if (!GOOGLE_GEOCODING_API_KEY) {
    console.error('GOOGLE_GEOCODING_API_KEY is not set')
    return null
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(
    placeId
  )}&key=${GOOGLE_GEOCODING_API_KEY}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn(`Geocode API status: ${data.status} for place_id ${placeId}`)
      return null
    }
    if (!data.results?.length) return null
    const r = data.results[0]
    const comp = r.address_components || []
    return {
      admin_level_1: getComponent(comp, 'administrative_area_level_1'),
      admin_level_2: getComponent(comp, 'administrative_area_level_2'),
      types: Array.isArray(r.types) ? r.types : null,
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
    }
  } catch (e) {
    console.warn(`Geocode failed for place_id ${placeId}:`, e)
    return null
  }
}

// --- Handler ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let trip_id: string
  try {
    const body = (await req.json()) as RequestBody
    if (!body.trip_id || typeof body.trip_id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'trip_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    trip_id = body.trip_id

    const internalSecret = req.headers.get('x-internal-secret') || ''
    const isInternal = INTERNAL_SECRET !== '' && internalSecret === INTERNAL_SECRET

    if (!isInternal) {
      // Client mode: require valid JWT and verify caller is the trip host.
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Missing or invalid Authorization header' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const token = authHeader.slice(7)
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: hostRow, error: hostErr } = await supabaseAdmin
        .from('group_trip_participants')
        .select('user_id')
        .eq('trip_id', trip_id)
        .eq('user_id', user.id)
        .eq('role', 'host')
        .maybeSingle()
      if (hostErr || !hostRow) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: only a trip host can enrich this destination' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }
  } catch (e) {
    console.error('Request parse/auth error:', e)
    return new Response(
      JSON.stringify({ error: 'Bad request' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Load the destination row.
  const { data: row, error: rowErr } = await supabaseAdmin
    .from('group_trip_destinations')
    .select('trip_id, place_id, lat, lng')
    .eq('trip_id', trip_id)
    .maybeSingle()

  if (rowErr) {
    console.error('Fetch destination row error:', rowErr)
    return new Response(
      JSON.stringify({ success: false, error: rowErr.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  if (!row) {
    return new Response(
      JSON.stringify({ success: false, error: 'No group_trip_destinations row for trip_id' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const dest = row as DestinationRow
  const update: EnrichedFields = {
    admin_level_1: null,
    admin_level_2: null,
    types: null,
    geo_bucket_4: null,
    geo_bucket_5: null,
    geo_bucket_6: null,
  }
  let lat = dest.lat
  let lng = dest.lng

  // If we have a place_id, get admin levels + types from Google.
  if (dest.place_id) {
    const geo = await geocodeByPlaceId(dest.place_id)
    if (geo) {
      update.admin_level_1 = geo.admin_level_1
      update.admin_level_2 = geo.admin_level_2
      update.types = geo.types
      // Backfill lat/lng if the row didn't have them.
      if ((lat == null || lng == null) && geo.lat != null && geo.lng != null) {
        lat = geo.lat
        lng = geo.lng
        update.lat = geo.lat
        update.lng = geo.lng
      }
    }
  }

  // Geohash from final lat/lng (whether existing or freshly geocoded).
  if (lat != null && lng != null) {
    update.geo_bucket_4 = encodeGeohash(lat, lng, 4)
    update.geo_bucket_5 = encodeGeohash(lat, lng, 5)
    update.geo_bucket_6 = encodeGeohash(lat, lng, 6)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('group_trip_destinations')
    .update(update)
    .eq('trip_id', trip_id)

  if (updateErr) {
    console.error('Update destination row error:', updateErr)
    return new Response(
      JSON.stringify({ success: false, error: updateErr.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      trip_id,
      enriched: {
        admin_level_1: update.admin_level_1,
        admin_level_2: update.admin_level_2,
        types: update.types,
        geo_bucket_4: update.geo_bucket_4,
        geo_bucket_5: update.geo_bucket_5,
        geo_bucket_6: update.geo_bucket_6,
        lat_backfilled: update.lat != null,
        lng_backfilled: update.lng != null,
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
