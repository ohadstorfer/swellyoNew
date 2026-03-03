/**
 * Geo-based matching using user_destinations and geo buckets.
 * Replaces destination path in copy-copy: geocode → scale/target → query user_destinations → tiered rank.
 */

import { MatchResult } from './types.ts'
import { determineGeoScale, type GeoScale, type GeoTarget } from './geoScaleUtils.ts'
import { getGeohashNeighbors } from './geohashUtils.ts'
import { applyQueryFilters, filterExcludedUsersInMemory } from './services/filterService.ts'
import { getPreviouslyMatchedUserIds } from './services/databaseService.ts'

const GOOGLE_GEOCODING_API_KEY = Deno.env.get('GOOGLE_GEOCODING_API_KEY')

const GEO_TIER_SCORE: Record<string, number> = {
  place_id: 100,
  bucket_6: 80,
  bucket_5: 60,
  bucket_4: 40,
  admin1: 20,
  country: 10,
}

const MATCHES_PAGE_SIZE = 3

interface UserDestinationRow {
  user_id: string
  place_id: string | null
  geo_bucket_4: string | null
  geo_bucket_5: string | null
  geo_bucket_6: string | null
  country: string | null
  admin_level_1: string | null
}

async function geocodeDestination(
  destinationCountry: string,
  area: string | null | undefined
): Promise<{ place_id?: string; types?: string[]; address_components?: any[]; geometry?: any } | null> {
  if (!GOOGLE_GEOCODING_API_KEY) {
    console.warn('[geoMatching] GOOGLE_GEOCODING_API_KEY not set')
    return null
  }
  const address = area
    ? `${encodeURIComponent(area.trim())}, ${encodeURIComponent(destinationCountry.trim())}`
    : encodeURIComponent(destinationCountry.trim())
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${GOOGLE_GEOCODING_API_KEY}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('[geoMatching] Geocode API status:', data.status)
      return null
    }
    if (!data.results?.length) return null
    return data.results[0]
  } catch (e) {
    console.warn('[geoMatching] Geocode failed:', e)
    return null
  }
}

function normalizeCountryForMatch(c: string | null | undefined): string {
  if (!c) return ''
  const s = c.trim().toLowerCase()
  if (s === 'usa' || s === 'united states') return 'United States'
  if (s === 'uk' || s === 'united kingdom') return 'United Kingdom'
  return c.trim()
}

/** Determine best tier for a user_destinations row against target. */
function tierForRow(row: UserDestinationRow, target: GeoTarget): { tier: string; score: number } | null {
  const countryMatch =
    target.country && row.country && normalizeCountryForMatch(row.country) === normalizeCountryForMatch(target.country)
  if (!countryMatch) return null

  if (target.place_id && row.place_id === target.place_id) return { tier: 'place_id', score: GEO_TIER_SCORE.place_id }
  if (target.geo_bucket_6 && row.geo_bucket_6 === target.geo_bucket_6) return { tier: 'bucket_6', score: GEO_TIER_SCORE.bucket_6 }
  if (target.geo_bucket_5 && row.geo_bucket_5 === target.geo_bucket_5) return { tier: 'bucket_5', score: GEO_TIER_SCORE.bucket_5 }
  if (target.geo_bucket_4 && row.geo_bucket_4 === target.geo_bucket_4) return { tier: 'bucket_4', score: GEO_TIER_SCORE.bucket_4 }
  if (target.admin_level_1 && row.admin_level_1 && row.admin_level_1 === target.admin_level_1)
    return { tier: 'admin1', score: GEO_TIER_SCORE.admin1 }
  return { tier: 'country', score: GEO_TIER_SCORE.country }
}

function totalDaysInDestinations(destinationsArray: any[] | null | undefined): number {
  if (!destinationsArray?.length) return 0
  let total = 0
  for (const d of destinationsArray) {
    total += d.time_in_days || 0
  }
  return total
}

/**
 * Find matching users using user_destinations and geo buckets (destination path only).
 */
export async function findMatchingUsersGeo(
  request: any,
  requestingUserId: string,
  chatId: string,
  supabaseAdmin: any
): Promise<{ results: MatchResult[]; totalCount: number }> {
  const destinationCountry = request.destination_country && String(request.destination_country).trim()
  const area = request.area || null
  const queryFilters = request.queryFilters || null

  if (!destinationCountry) {
    return { results: [], totalCount: 0 }
  }

  console.log('[geoMatching] Geocoding destination:', destinationCountry, area || '')
  const geocodeResult = await geocodeDestination(destinationCountry, area)
  if (!geocodeResult) {
    console.log('[geoMatching] No geocode result; returning empty')
    return { results: [], totalCount: 0 }
  }

  const { scale, target } = determineGeoScale(geocodeResult)
  console.log('[geoMatching] Scale:', scale, 'Target country:', target.country)

  const excludedUserIds = await getPreviouslyMatchedUserIds(chatId, supabaseAdmin)

  let rows: UserDestinationRow[] = []

  if (scale === 'country') {
    const { data, error } = await supabaseAdmin
      .from('user_destinations')
      .select('user_id, place_id, geo_bucket_4, geo_bucket_5, geo_bucket_6, country, admin_level_1')
      .eq('country', target.country)
    if (error) {
      console.error('[geoMatching] user_destinations query error:', error)
      return { results: [], totalCount: 0 }
    }
    rows = (data ?? []) as UserDestinationRow[]
  } else if (scale === 'region' && target.geo_bucket_4) {
    const { data, error } = await supabaseAdmin
      .from('user_destinations')
      .select('user_id, place_id, geo_bucket_4, geo_bucket_5, geo_bucket_6, country, admin_level_1')
      .eq('country', target.country)
      .eq('geo_bucket_4', target.geo_bucket_4)
    if (error) {
      console.error('[geoMatching] user_destinations query error:', error)
      return { results: [], totalCount: 0 }
    }
    rows = (data ?? []) as UserDestinationRow[]
  } else if (scale === 'admin1' && target.admin_level_1) {
    const { data, error } = await supabaseAdmin
      .from('user_destinations')
      .select('user_id, place_id, geo_bucket_4, geo_bucket_5, geo_bucket_6, country, admin_level_1')
      .eq('country', target.country)
      .eq('admin_level_1', target.admin_level_1)
    if (error) {
      console.error('[geoMatching] user_destinations query error:', error)
      return { results: [], totalCount: 0 }
    }
    rows = (data ?? []) as UserDestinationRow[]
  } else if (scale === 'town' && target.geo_bucket_5) {
    const bucket5Neighbors = getGeohashNeighbors(target.geo_bucket_5)
    const { data, error } = await supabaseAdmin
      .from('user_destinations')
      .select('user_id, place_id, geo_bucket_4, geo_bucket_5, geo_bucket_6, country, admin_level_1')
      .eq('country', target.country)
      .in('geo_bucket_5', bucket5Neighbors)
    if (error) {
      console.error('[geoMatching] user_destinations query error:', error)
      return { results: [], totalCount: 0 }
    }
    rows = (data ?? []) as UserDestinationRow[]
  } else if (scale === 'spot') {
    if (target.place_id) {
      const { data: byPlaceId, error: e1 } = await supabaseAdmin
        .from('user_destinations')
        .select('user_id, place_id, geo_bucket_4, geo_bucket_5, geo_bucket_6, country, admin_level_1')
        .eq('place_id', target.place_id)
      if (!e1 && byPlaceId?.length) {
        rows = byPlaceId as UserDestinationRow[]
      }
    }
    if (rows.length === 0 && target.geo_bucket_6) {
      const bucket6Neighbors = getGeohashNeighbors(target.geo_bucket_6)
      const { data, error } = await supabaseAdmin
        .from('user_destinations')
        .select('user_id, place_id, geo_bucket_4, geo_bucket_5, geo_bucket_6, country, admin_level_1')
        .eq('country', target.country)
        .in('geo_bucket_6', bucket6Neighbors)
      if (!error) rows = (data ?? []) as UserDestinationRow[]
    }
  }

  const userBestTier: Map<string, { tier: string; score: number }> = new Map()
  for (const row of rows) {
    const t = tierForRow(row, target)
    if (!t) continue
    const existing = userBestTier.get(row.user_id)
    if (!existing || t.score > existing.score) userBestTier.set(row.user_id, t)
  }

  let candidateIds = Array.from(userBestTier.keys()).filter((id) => id !== requestingUserId && !excludedUserIds.includes(id))
  console.log('[geoMatching] Candidate user_ids from user_destinations:', candidateIds.length)

  if (candidateIds.length === 0) {
    return { results: [], totalCount: 0 }
  }

  let query = supabaseAdmin
    .from('surfers')
    .select('*')
    .in('user_id', candidateIds)
    .neq('user_id', requestingUserId)
  if (queryFilters && typeof queryFilters === 'object') {
    query = applyQueryFilters(query, queryFilters)
  }
  const { data: surfers, error: surfersError } = await query
  if (surfersError) {
    console.error('[geoMatching] Surfers query error:', surfersError)
    return { results: [], totalCount: 0 }
  }
  const filteredSurfers = filterExcludedUsersInMemory(surfers ?? [], excludedUserIds)

  const withScores = filteredSurfers.map((surfer: any) => {
    const tierInfo = userBestTier.get(surfer.user_id) ?? { tier: 'country', score: GEO_TIER_SCORE.country }
    const days = totalDaysInDestinations(surfer.destinations_array)
    return {
      surfer,
      geoScore: tierInfo.score,
      daysInDestination: days,
    }
  })

  withScores.sort((a, b) => {
    if (b.geoScore !== a.geoScore) return b.geoScore - a.geoScore
    return b.daysInDestination - a.daysInDestination
  })

  const matchResults: MatchResult[] = withScores.map(({ surfer, geoScore, daysInDestination }) => ({
    user_id: surfer.user_id,
    name: surfer.name || 'User',
    profile_image_url: surfer.profile_image_url ?? null,
    match_score: geoScore + daysInDestination,
    priority_score: geoScore,
    general_score: daysInDestination,
    matched_areas: [],
    matched_towns: [],
    common_lifestyle_keywords: [],
    common_wave_keywords: [],
    surfboard_type: surfer.surfboard_type,
    surf_level: surfer.surf_level,
    travel_experience: surfer.travel_experience?.toString(),
    country_from: surfer.country_from,
    age: surfer.age,
    days_in_destination: daysInDestination,
    destinations_array: surfer.destinations_array,
    match_quality: { countryMatch: true, areaMatch: geoScore > GEO_TIER_SCORE.country, townMatch: geoScore >= GEO_TIER_SCORE.bucket_5 },
  }))

  const totalCount = matchResults.length
  const results = matchResults.slice(0, MATCHES_PAGE_SIZE)
  console.log('[geoMatching] Result:', results.length, 'matches, totalCount=', totalCount)
  return { results, totalCount }
}
