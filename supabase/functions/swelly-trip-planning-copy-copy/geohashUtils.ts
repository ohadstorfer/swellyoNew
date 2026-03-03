/**
 * Geohash encoding and neighbor expansion for geo-bucket matching.
 * Shared semantics with geocode-user-destinations.
 */

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

export function encodeGeohash(lat: number, lng: number, precision: number): string {
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

/** Decode geohash to center (lat, lng) and half-widths. */
export function decodeGeohash(geohash: string): { lat: number; lng: number; latDelta: number; lngDelta: number } {
  let latMin = -90.0
  let latMax = 90.0
  let lngMin = -180.0
  let lngMax = 180.0
  let isEvenBit = true
  for (const c of geohash) {
    const idx = GEOHASH_BASE32.indexOf(c)
    if (idx === -1) continue
    for (let i = 4; i >= 0; i--) {
      if (isEvenBit) {
        const mid = (lngMin + lngMax) / 2
        if (idx & (1 << i)) lngMin = mid
        else lngMax = mid
      } else {
        const mid = (latMin + latMax) / 2
        if (idx & (1 << i)) latMin = mid
        else latMax = mid
      }
      isEvenBit = !isEvenBit
    }
  }
  const lat = (latMin + latMax) / 2
  const lng = (lngMin + lngMax) / 2
  const latDelta = (latMax - latMin) / 2
  const lngDelta = (lngMax - lngMin) / 2
  return { lat, lng, latDelta, lngDelta }
}

/** Returns the 8 neighboring geohashes at the same length (plus center = 9 cells). */
export function getGeohashNeighbors(geohash: string): string[] {
  if (!geohash || geohash.length === 0) return []
  const precision = geohash.length
  const { lat, lng, latDelta, lngDelta } = decodeGeohash(geohash)
  const out = new Set<string>()
  for (const dlat of [-1, 0, 1]) {
    for (const dlng of [-1, 0, 1]) {
      const nlat = lat + dlat * latDelta * 2
      const nlng = lng + dlng * lngDelta * 2
      if (nlat >= -90 && nlat <= 90 && nlng >= -180 && nlng <= 180) {
        out.add(encodeGeohash(nlat, nlng, precision))
      }
    }
  }
  return Array.from(out)
}
