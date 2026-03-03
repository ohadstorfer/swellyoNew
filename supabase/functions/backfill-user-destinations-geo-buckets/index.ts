/**
 * One-off backfill: set geo_bucket_4/5/6 on user_destinations rows that have lat/lng but null buckets.
 * Invoke once after deploying geo buckets migration. Uses same geohash as geocode-user-destinations.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

function encodeGeohash(lat: number, lng: number, precision: number): string {
  let latitude = Math.max(-90, Math.min(90, lat))
  let longitude = Math.max(-180, Math.min(180, lng))
  let latMin = -90.0, latMax = 90.0, lngMin = -180.0, lngMax = 180.0
  let hash = '', isEvenBit = true, bit = 0, ch = 0
  while (hash.length < precision) {
    if (isEvenBit) {
      const mid = (lngMin + lngMax) / 2
      if (longitude >= mid) { ch |= 1 << (4 - bit); lngMin = mid } else lngMax = mid
    } else {
      const mid = (latMin + latMax) / 2
      if (latitude >= mid) { ch |= 1 << (4 - bit); latMin = mid } else latMax = mid
    }
    isEvenBit = !isEvenBit
    if (bit < 4) bit++
    else { hash += GEOHASH_BASE32[ch]; bit = 0; ch = 0 }
  }
  return hash
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: rows, error: selectError } = await supabase
    .from('user_destinations')
    .select('id, lat, lng')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .or('geo_bucket_4.is.null,geo_bucket_5.is.null,geo_bucket_6.is.null')
  if (selectError) {
    return new Response(JSON.stringify({ error: selectError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  if (!rows?.length) {
    return new Response(JSON.stringify({ updated: 0, message: 'No rows to backfill' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  let updated = 0
  const BATCH = 50
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const updates = batch.map((r: { id: string; lat: number; lng: number }) => ({
      id: r.id,
      geo_bucket_4: encodeGeohash(r.lat, r.lng, 4),
      geo_bucket_5: encodeGeohash(r.lat, r.lng, 5),
      geo_bucket_6: encodeGeohash(r.lat, r.lng, 6),
    }))
    for (const u of updates) {
      const { error } = await supabase.from('user_destinations').update({
        geo_bucket_4: u.geo_bucket_4,
        geo_bucket_5: u.geo_bucket_5,
        geo_bucket_6: u.geo_bucket_6,
      }).eq('id', u.id)
      if (!error) updated++
    }
  }
  return new Response(JSON.stringify({ updated, total: rows.length }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
