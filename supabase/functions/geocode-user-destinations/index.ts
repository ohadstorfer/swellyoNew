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

interface DestinationRow {
  country: string
  state?: string
  area: string[]
  time_in_days?: number
  time_in_text?: string
}

interface RequestBody {
  destinations_array?: DestinationRow[]
  user_id?: string
}

interface GeocodedRow {
  user_id: string
  place_id: string
  lat: number
  lng: number
  country: string | null
  admin_level_1: string | null
  admin_level_2: string | null
  locality: string | null
  types: string[] | null
  display_name: string | null
  formatted_address: string | null
}

const STOPWORDS = new Set(['area', 'in general', 'the', 'and', '&'])
const GEOCODE_DELAY_MS = 120

function extractPlaceNames(areaStrings: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of areaStrings) {
    const parts = s.split(/[,]|\s+and\s+/i).map((p) => p.trim()).filter(Boolean)
    for (let part of parts) {
      part = part.replace(/\s+area\s*$/i, '').replace(/^\s*area\s+/i, '')
      const lower = part.toLowerCase()
      if (STOPWORDS.has(lower) || part.length < 2) continue
      const key = lower
      if (!seen.has(key)) {
        seen.add(key)
        out.push(part)
      }
    }
  }
  return out
}

function getComponent(
  components: { long_name: string; types: string[] }[],
  type: string
): string | null {
  const c = components.find((x) => x.types.includes(type))
  return c ? c.long_name : null
}

async function geocodePlace(
  placeName: string,
  country: string,
  state?: string
): Promise<GeocodedRow | null> {
  if (!GOOGLE_GEOCODING_API_KEY) {
    console.error('GOOGLE_GEOCODING_API_KEY is not set')
    return null
  }
  const address = encodeURIComponent(placeName.trim())
  let components = `country:${encodeURIComponent(country)}`
  if (country === 'USA' && state) {
    components += `|administrative_area:${encodeURIComponent(state)}`
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&components=${components}&key=${GOOGLE_GEOCODING_API_KEY}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn(`Geocode API status: ${data.status} for "${placeName}", ${country}`)
      return null
    }
    if (!data.results?.length) return null
    const r = data.results[0]
    const comp = r.address_components || []
    const countryVal = getComponent(comp, 'country')
    const admin1 = getComponent(comp, 'administrative_area_level_1')
    const admin2 = getComponent(comp, 'administrative_area_level_2')
    const locality = getComponent(comp, 'locality')
    return {
      user_id: '', // filled by caller
      place_id: r.place_id,
      lat: r.geometry?.location?.lat ?? 0,
      lng: r.geometry?.location?.lng ?? 0,
      country: countryVal,
      admin_level_1: admin1,
      admin_level_2: admin2,
      locality: locality,
      types: Array.isArray(r.types) ? r.types : null,
      display_name: placeName,
      formatted_address: r.formatted_address ?? null,
    }
  } catch (e) {
    console.warn(`Geocode failed for "${placeName}", ${country}:`, e)
    return null
  }
}

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

  let user_id: string
  let destinations_array: DestinationRow[]

  try {
    const body = (await req.json()) as RequestBody
    const internalSecret = req.headers.get('x-internal-secret') || ''

    if (body.user_id && !body.destinations_array && internalSecret === INTERNAL_SECRET && INTERNAL_SECRET) {
      const { data: surfer, error } = await supabaseAdmin
        .from('surfers')
        .select('destinations_array')
        .eq('user_id', body.user_id)
        .single()
      if (error || !surfer?.destinations_array) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No surfers row or destinations_array for user',
            user_id: body.user_id,
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      user_id = body.user_id
      destinations_array = surfer.destinations_array as DestinationRow[]
    } else {
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
      user_id = user.id
      if (!body.destinations_array || !Array.isArray(body.destinations_array)) {
        return new Response(
          JSON.stringify({ error: 'destinations_array is required and must be an array' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      destinations_array = body.destinations_array
    }
  } catch (e) {
    console.error('Request parse/auth error:', e)
    return new Response(
      JSON.stringify({ error: 'Bad request' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const placeNamesByCountry: { placeName: string; country: string; state?: string }[] = []
  for (const dest of destinations_array) {
    const country = dest.country || ''
    if (!country) continue
    const areas = dest.area || []
    const names = extractPlaceNames(areas)
    for (const name of names) {
      placeNamesByCountry.push({
        placeName: name,
        country,
        state: dest.state,
      })
    }
  }

  const rows: GeocodedRow[] = []
  for (let i = 0; i < placeNamesByCountry.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS))
    const { placeName, country, state } = placeNamesByCountry[i]
    const row = await geocodePlace(placeName, country, state)
    if (row) {
      row.user_id = user_id
      rows.push(row)
    }
  }

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        user_id,
        inserted: 0,
        skipped: 0,
        message: 'No geocoded results to insert',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: existing } = await supabaseAdmin
    .from('user_destinations')
    .select('place_id')
    .eq('user_id', user_id)
    .in('place_id', rows.map((r) => r.place_id))

  const existingPlaceIds = new Set((existing || []).map((r: { place_id: string }) => r.place_id))
  const toInsert = rows.filter((r) => !existingPlaceIds.has(r.place_id))

  if (toInsert.length > 0) {
    const insertPayload = toInsert.map((r) => ({
      user_id: r.user_id,
      place_id: r.place_id,
      lat: r.lat,
      lng: r.lng,
      country: r.country,
      admin_level_1: r.admin_level_1,
      admin_level_2: r.admin_level_2,
      locality: r.locality,
      types: r.types,
      display_name: r.display_name,
      formatted_address: r.formatted_address,
    }))
    const { error: insertError } = await supabaseAdmin
      .from('user_destinations')
      .upsert(insertPayload, { onConflict: 'user_id,place_id', ignoreDuplicates: true })
    if (insertError) {
      console.error('Insert user_destinations error:', insertError)
      return new Response(
        JSON.stringify({ success: false, error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      user_id,
      inserted: toInsert.length,
      skipped: rows.length - toInsert.length,
      total_geocoded: rows.length,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
