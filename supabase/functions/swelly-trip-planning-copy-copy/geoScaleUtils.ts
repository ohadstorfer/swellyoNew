/**
 * Determines geographic scale and target from a Google Geocoding API result.
 * Used to build indexed user_destinations queries (country, admin, buckets, place_id).
 */

import { encodeGeohash } from './geohashUtils.ts'

export type GeoScale = 'country' | 'region' | 'admin1' | 'town' | 'spot'

export interface GeoTarget {
  country: string
  admin_level_1?: string
  admin_level_2?: string
  locality?: string
  place_id?: string
  lat?: number
  lng?: number
  geo_bucket_4?: string
  geo_bucket_5?: string
  geo_bucket_6?: string
}

export interface GeoScaleResult {
  scale: GeoScale
  target: GeoTarget
}

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

interface GeocodingResult {
  place_id?: string
  types?: string[]
  address_components?: AddressComponent[]
  geometry?: {
    location?: { lat: number; lng: number }
    viewport?: {
      northeast?: { lat: number; lng: number }
      southwest?: { lat: number; lng: number }
    }
  }
  formatted_address?: string
}

function getComponent(components: AddressComponent[] | undefined, type: string): string | null {
  if (!components?.length) return null
  const c = components.find((x) => x.types.includes(type))
  return c ? c.long_name : null
}

/** Approximate viewport span in degrees (roughly lat or lng span). */
function viewportSpanDegrees(result: GeocodingResult): number {
  const v = result.geometry?.viewport
  if (!v?.northeast || !v?.southwest) return 180
  const latSpan = Math.abs((v.northeast.lat ?? 0) - (v.southwest.lat ?? 0))
  const lngSpan = Math.abs((v.northeast.lng ?? 0) - (v.southwest.lng ?? 0))
  return Math.max(latSpan, lngSpan)
}

/**
 * Determine geographic scale and target from a single Google Geocoding result.
 * Uses types and viewport to choose scale; fills target with country, admin, locality, place_id, buckets.
 */
export function determineGeoScale(geocodingResult: GeocodingResult): GeoScaleResult {
  const types = geocodingResult.types ?? []
  const components = geocodingResult.address_components ?? []
  const country = getComponent(components, 'country')
  const admin1 = getComponent(components, 'administrative_area_level_1')
  const admin2 = getComponent(components, 'administrative_area_level_2')
  const locality = getComponent(components, 'locality') ?? getComponent(components, 'sublocality')
  const lat = geocodingResult.geometry?.location?.lat
  const lng = geocodingResult.geometry?.location?.lng
  const placeId = geocodingResult.place_id ?? undefined

  const target: GeoTarget = {
    country: country ?? '',
  }
  if (admin1) target.admin_level_1 = admin1
  if (admin2) target.admin_level_2 = admin2
  if (locality) target.locality = locality
  if (placeId) target.place_id = placeId
  if (lat != null && lng != null) {
    target.lat = lat
    target.lng = lng
    target.geo_bucket_4 = encodeGeohash(lat, lng, 4)
    target.geo_bucket_5 = encodeGeohash(lat, lng, 5)
    target.geo_bucket_6 = encodeGeohash(lat, lng, 6)
  }

  const span = viewportSpanDegrees(geocodingResult)

  // Country-level: types include country or very large viewport
  if (types.includes('country') || (span > 10 && country)) {
    return { scale: 'country', target }
  }

  // Spot: POI, establishment, natural_feature, or very small viewport
  if (
    types.some((t) =>
      ['point_of_interest', 'establishment', 'natural_feature', 'tourist_attraction'].includes(t)
    ) ||
    span < 0.05
  ) {
    return { scale: 'spot', target }
  }

  // Admin1: state/department, medium-large viewport
  if (types.includes('administrative_area_level_1') || (admin1 && span > 1)) {
    return { scale: 'admin1', target }
  }

  // Town: locality/sublocality, moderate viewport
  if (
    types.some((t) => ['locality', 'sublocality', 'administrative_area_level_2'].includes(t)) ||
    (locality && span < 2)
  ) {
    return { scale: 'town', target }
  }

  // Region: use bucket_4 for generalized area
  if (target.geo_bucket_4) {
    return { scale: 'region', target }
  }

  return { scale: 'country', target }
}
