/**
 * Pure geo utilities for tiered destination matching.
 *
 * Tier semantics (point mode):
 *   1 — surfed within ~5 km of the requested spot (geohash-5 cell or neighbor)
 *   2 — surfed within ~40 km (geohash-4 cell or neighbor)
 *   3 — country/state match only (today's behavior; absent from the tier map)
 *
 * Region mode (requested place is an administrative area): geohash rings around
 * a region centroid are meaningless, so promotion is by bounding box → Tier 2 only.
 *
 * Geo data only promotes — a user with no rows here is Tier 3, never excluded.
 */

export type GeoTier = 1 | 2 | 3;

export interface GeoBounds {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
}

export interface GeocodedPlace {
  lat: number;
  lng: number;
  geo_bucket_4: string;
  geo_bucket_5: string;
  country: string | null;
  state: string | null;
  is_region: boolean;
  bounds: GeoBounds | null;
}

export interface UserDestinationGeoRow {
  user_id: string;
  lat: number | null;
  lng: number | null;
  geo_bucket_4: string | null;
  geo_bucket_5: string | null;
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

// Standard geohash adjacency tables (Veness). Index [dir][parity] where
// parity = hash.length % 2.
const NEIGHBOR: Record<string, [string, string]> = {
  n: ['p0r21436x8zb9dcf5h7kjnmqesgutwvy', 'bc01fg45238967deuvhjyznpkmstqrwx'],
  s: ['14365h7k9dcfesgujnmqp0r2twvyx8zb', '238967debc01fg45kmstqrwxuvhjyznp'],
  e: ['bc01fg45238967deuvhjyznpkmstqrwx', 'p0r21436x8zb9dcf5h7kjnmqesgutwvy'],
  w: ['238967debc01fg45kmstqrwxuvhjyznp', '14365h7k9dcfesgujnmqp0r2twvyx8zb'],
};
const BORDER: Record<string, [string, string]> = {
  n: ['prxz', 'bcfguvyz'],
  s: ['028b', '0145hjnp'],
  e: ['bcfguvyz', 'prxz'],
  w: ['0145hjnp', '028b'],
};

type Direction = 'n' | 's' | 'e' | 'w';

function adjacent(hash: string, dir: Direction): string {
  const lastCh = hash.slice(-1);
  let parent = hash.slice(0, -1);
  const parity = hash.length % 2;
  if (BORDER[dir][parity].includes(lastCh) && parent !== '') {
    parent = adjacent(parent, dir);
  }
  return parent + BASE32[NEIGHBOR[dir][parity].indexOf(lastCh)];
}

/** The 8 cells surrounding `hash`, same precision. */
export function geohashNeighbors(hash: string): string[] {
  const n = adjacent(hash, 'n');
  const s = adjacent(hash, 's');
  return [
    n,
    s,
    adjacent(hash, 'e'),
    adjacent(hash, 'w'),
    adjacent(n, 'e'),
    adjacent(n, 'w'),
    adjacent(s, 'e'),
    adjacent(s, 'w'),
  ];
}

/** Point-in-box, handling boxes that span the antimeridian (sw.lng > ne.lng). */
export function boundsContain(bounds: GeoBounds, lat: number, lng: number): boolean {
  if (lat < bounds.sw.lat || lat > bounds.ne.lat) return false;
  if (bounds.sw.lng <= bounds.ne.lng) {
    return lng >= bounds.sw.lng && lng <= bounds.ne.lng;
  }
  return lng >= bounds.sw.lng || lng <= bounds.ne.lng;
}

/**
 * Best tier per user across all their destinations. Users with no promoting
 * destination are simply absent from the map (callers treat absent as Tier 3).
 */
export function assignGeoTiers(
  place: GeocodedPlace,
  rows: UserDestinationGeoRow[]
): Map<string, GeoTier> {
  const tiers = new Map<string, GeoTier>();

  const bucket5Set = place.is_region
    ? null
    : new Set([place.geo_bucket_5, ...geohashNeighbors(place.geo_bucket_5)]);
  const bucket4Set = place.is_region
    ? null
    : new Set([place.geo_bucket_4, ...geohashNeighbors(place.geo_bucket_4)]);

  for (const row of rows) {
    let tier: GeoTier | null = null;

    if (place.is_region) {
      if (
        place.bounds &&
        typeof row.lat === 'number' &&
        typeof row.lng === 'number' &&
        boundsContain(place.bounds, row.lat, row.lng)
      ) {
        tier = 2;
      }
    } else {
      if (row.geo_bucket_5 && bucket5Set!.has(row.geo_bucket_5)) {
        tier = 1;
      } else if (row.geo_bucket_4 && bucket4Set!.has(row.geo_bucket_4)) {
        tier = 2;
      }
    }

    if (tier !== null) {
      const prev = tiers.get(row.user_id);
      if (prev === undefined || tier < prev) tiers.set(row.user_id, tier);
    }
  }

  return tiers;
}
