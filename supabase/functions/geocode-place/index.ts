import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_GEOCODING_API_KEY = Deno.env.get('GOOGLE_GEOCODING_API_KEY')

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

function encodeGeohash(lat: number, lng: number, precision: number): string {
  let latitude = Math.max(-90, Math.min(90, lat))
  let longitude = Math.max(-180, Math.min(180, lng))

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

// Google result types that mean "an area, not a point". Geohash rings around an
// area's centroid are meaningless, so the client switches to bounds-based promotion.
const REGION_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'country',
])

function getComponent(
  components: { long_name: string; types: string[] }[],
  type: string
): string | null {
  const c = components.find((x) => x.types.includes(type))
  return c ? c.long_name : null
}

function nullResponse(): Response {
  return new Response('null', {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!GOOGLE_GEOCODING_API_KEY) {
    console.error('GOOGLE_GEOCODING_API_KEY is not set')
    return nullResponse()
  }

  let place = ''
  let country = ''
  let state = ''
  try {
    const body = await req.json()
    place = typeof body?.place === 'string' ? body.place.trim() : ''
    country = typeof body?.country === 'string' ? body.country.trim() : ''
    state = typeof body?.state === 'string' ? body.state.trim() : ''
  } catch {
    return nullResponse()
  }
  if (!place || place.length < 2) return nullResponse()

  // Plain address concatenation, not a components filter: `country` may actually be
  // a US state name (states act as countries in matching), which a components
  // country-filter would reject outright.
  const addressParts = [place]
  if (state) addressParts.push(state)
  if (country) addressParts.push(country)
  const address = encodeURIComponent(addressParts.join(', '))
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${GOOGLE_GEOCODING_API_KEY}`

  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.length) {
      if (data.status !== 'ZERO_RESULTS') {
        console.warn(`Geocode status ${data.status} for "${place}"`)
      }
      return nullResponse()
    }

    const r = data.results[0]
    const lat = r.geometry?.location?.lat
    const lng = r.geometry?.location?.lng
    if (typeof lat !== 'number' || typeof lng !== 'number') return nullResponse()

    const types: string[] = Array.isArray(r.types) ? r.types : []
    const is_region = types.some((t) => REGION_TYPES.has(t))

    const rawBounds = r.geometry?.bounds ?? r.geometry?.viewport ?? null
    const bounds =
      rawBounds?.southwest && rawBounds?.northeast
        ? {
            sw: { lat: rawBounds.southwest.lat, lng: rawBounds.southwest.lng },
            ne: { lat: rawBounds.northeast.lat, lng: rawBounds.northeast.lng },
          }
        : null

    const comp = r.address_components || []
    const result = {
      lat,
      lng,
      geo_bucket_4: encodeGeohash(lat, lng, 4),
      geo_bucket_5: encodeGeohash(lat, lng, 5),
      country: getComponent(comp, 'country'),
      state: getComponent(comp, 'administrative_area_level_1'),
      is_region,
      bounds,
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.warn(`Geocode failed for "${place}":`, e)
    return nullResponse()
  }
})
