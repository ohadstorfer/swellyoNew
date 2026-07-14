# Geo-Bucket Tiered Destination Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank Swelly trip-matching candidates by geographic proximity to the requested spot using the geohash buckets already stored in `user_destinations`, instead of country-name-only comparison.

**Architecture:** A new standalone Edge Function `geocode-place` geocodes the requested place string into lat/lng + geohash buckets + region bounds. The client (`matchingService.ts`) keeps its existing hard-filter pipeline untouched and applies an additive tier ordering (Tier 1 ≈ 5 km, Tier 2 ≈ 40 km or region bounds, Tier 3 = today's country/state match) on the survivor set before the final top-3 sort. Pure tiering logic lives in a new `geoTiering.ts` with unit tests.

**Tech Stack:** React Native + TypeScript client, Supabase Edge Function (Deno), Google Geocoding API, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-07-13-geo-bucket-destination-matching-design.md`

## Global Constraints

- **Do NOT commit.** Ohad reviews and commits manually. Skip all commit steps; leave changes staged-nothing.
- Geo data only **promotes** within the survivor set — it must never exclude a candidate or change the hard filters (country / US-state wall in Step 6 of `findMatchingUsers`).
- Any geo failure (geocode null, missing `user_destinations` rows, query error) must degrade to today's exact behavior (everyone Tier 3).
- Client changes are pure JS (OTA-safe). No native modules.
- Edge Function must never throw to the client: failures return HTTP 200 with body `null`.
- The `swelly-trip-planning` Edge Function must NOT be modified.

---

### Task 1: `geoTiering.ts` — pure geo functions with tests

**Files:**
- Create: `src/services/matching/geoTiering.ts`
- Test: `src/services/matching/__tests__/geoTiering.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces (used by Task 3):
  - `type GeoTier = 1 | 2 | 3`
  - `interface GeocodedPlace { lat: number; lng: number; geo_bucket_4: string; geo_bucket_5: string; country: string | null; state: string | null; is_region: boolean; bounds: GeoBounds | null }`
  - `interface GeoBounds { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } }`
  - `interface UserDestinationGeoRow { user_id: string; lat: number | null; lng: number | null; geo_bucket_4: string | null; geo_bucket_5: string | null }`
  - `geohashNeighbors(hash: string): string[]` — the 8 neighbor cells
  - `boundsContain(bounds: GeoBounds, lat: number, lng: number): boolean`
  - `assignGeoTiers(place: GeocodedPlace, rows: UserDestinationGeoRow[]): Map<string, GeoTier>` — best tier per `user_id`; users absent from the map are Tier 3.

- [ ] **Step 1: Write the failing tests**

Create `src/services/matching/__tests__/geoTiering.test.ts`:

```ts
import {
  geohashNeighbors,
  boundsContain,
  assignGeoTiers,
  GeocodedPlace,
  UserDestinationGeoRow,
} from '../geoTiering';

// Uluwatu ≈ (-8.8291, 115.0849) → bucket5 "qw60x", bucket4 "qw60"
const ULUWATU: GeocodedPlace = {
  lat: -8.8291,
  lng: 115.0849,
  geo_bucket_4: 'qw60',
  geo_bucket_5: 'qw60x',
  country: 'Indonesia',
  state: null,
  is_region: false,
  bounds: null,
};

describe('geohashNeighbors', () => {
  it('returns the 8 known neighbors of a mid-latitude cell', () => {
    // Reference values from the standard Veness geohash adjacency algorithm
    const n = geohashNeighbors('gbsuv');
    expect(n).toHaveLength(8);
    expect(new Set(n)).toEqual(
      new Set(['gbsvj', 'gbsvh', 'gbsuu', 'gbsvn', 'gbsuy', 'gbsuw', 'gbsut', 'gbsus'])
    );
  });

  it('crosses the antimeridian without throwing and stays 8 unique cells', () => {
    // 'xbp' east edge wraps to '8' side (lng +180 → -180)
    const n = geohashNeighbors('xbp');
    expect(n).toHaveLength(8);
    expect(new Set(n).size).toBe(8);
  });

  it('does not throw near the poles', () => {
    expect(() => geohashNeighbors('zzzzz')).not.toThrow();
    expect(geohashNeighbors('zzzzz')).toHaveLength(8);
  });

  it('returns 4-char neighbors for a 4-char hash', () => {
    for (const h of geohashNeighbors('qw60')) expect(h).toHaveLength(4);
  });
});

describe('boundsContain', () => {
  const bounds = { sw: { lat: 13.15, lng: -89.75 }, ne: { lat: 13.85, lng: -88.95 } };
  it('contains a point inside', () => {
    expect(boundsContain(bounds, 13.49, -89.38)).toBe(true); // Punta Roca
  });
  it('excludes a point outside', () => {
    expect(boundsContain(bounds, 13.19, -88.44)).toBe(false); // Las Flores (east)
  });
  it('handles antimeridian-spanning bounds (sw.lng > ne.lng)', () => {
    const fiji = { sw: { lat: -21, lng: 176 }, ne: { lat: -12, lng: -178 } };
    expect(boundsContain(fiji, -17.7, 177.1)).toBe(true);  // west of the line
    expect(boundsContain(fiji, -16.8, -179.3)).toBe(true); // east of the line
    expect(boundsContain(fiji, -17.7, 170.0)).toBe(false);
  });
});

describe('assignGeoTiers — point mode', () => {
  const rows: UserDestinationGeoRow[] = [
    // same bucket5 as Uluwatu → Tier 1
    { user_id: 'u1', lat: -8.83, lng: 115.09, geo_bucket_4: 'qw60', geo_bucket_5: 'qw60x' },
    // same bucket4, different bucket5 (Canggu ≈ -8.66, 115.13 → qw642 / qw64... actually
    // use a synthetic row: bucket4 matches, bucket5 far) → Tier 2
    { user_id: 'u2', lat: -8.65, lng: 115.13, geo_bucket_4: 'qw60', geo_bucket_5: 'qw60b' },
    // Mentawais — different bucket4 entirely → Tier 3 (absent from map)
    { user_id: 'u3', lat: -1.98, lng: 99.53, geo_bucket_4: 'mgkq', geo_bucket_5: 'mgkq3' },
    // null buckets (unbackfilled row) → ignored, u4 absent from map
    { user_id: 'u4', lat: null, lng: null, geo_bucket_4: null, geo_bucket_5: null },
  ];

  it('assigns tier 1 for same/neighbor bucket5, tier 2 for same/neighbor bucket4', () => {
    const tiers = assignGeoTiers(ULUWATU, rows);
    expect(tiers.get('u1')).toBe(1);
    expect(tiers.get('u2')).toBe(2);
    expect(tiers.has('u3')).toBe(false);
    expect(tiers.has('u4')).toBe(false);
  });

  it('promotes via neighbor bucket5 (edge-straddling)', () => {
    // a row whose bucket5 is a neighbor of qw60x, not equal
    const neighbor5 = geohashNeighbors('qw60x')[0];
    const tiers = assignGeoTiers(ULUWATU, [
      { user_id: 'u5', lat: -8.82, lng: 115.08, geo_bucket_4: 'qw60', geo_bucket_5: neighbor5 },
    ]);
    expect(tiers.get('u5')).toBe(1);
  });

  it('keeps the best tier across multiple destinations of one user', () => {
    const tiers = assignGeoTiers(ULUWATU, [
      { user_id: 'u6', lat: -1.98, lng: 99.53, geo_bucket_4: 'mgkq', geo_bucket_5: 'mgkq3' },
      { user_id: 'u6', lat: -8.83, lng: 115.09, geo_bucket_4: 'qw60', geo_bucket_5: 'qw60x' },
    ]);
    expect(tiers.get('u6')).toBe(1);
  });
});

describe('assignGeoTiers — region mode', () => {
  const LA_LIBERTAD_DEPT: GeocodedPlace = {
    lat: 13.6,
    lng: -89.3,
    geo_bucket_4: 'd41w',
    geo_bucket_5: 'd41wx',
    country: 'El Salvador',
    state: null,
    is_region: true,
    bounds: { sw: { lat: 13.15, lng: -89.75 }, ne: { lat: 13.85, lng: -88.95 } },
  };

  it('promotes destinations inside bounds to tier 2, never tier 1', () => {
    const tiers = assignGeoTiers(LA_LIBERTAD_DEPT, [
      { user_id: 'u1', lat: 13.49, lng: -89.38, geo_bucket_4: 'd41w', geo_bucket_5: 'd41wx' },
      { user_id: 'u2', lat: 13.19, lng: -88.44, geo_bucket_4: 'd41y', geo_bucket_5: 'd41y0' },
    ]);
    expect(tiers.get('u1')).toBe(2);
    expect(tiers.has('u2')).toBe(false);
  });

  it('region mode with null bounds promotes nobody', () => {
    const noBounds = { ...LA_LIBERTAD_DEPT, bounds: null };
    const tiers = assignGeoTiers(noBounds, [
      { user_id: 'u1', lat: 13.49, lng: -89.38, geo_bucket_4: 'd41w', geo_bucket_5: 'd41wx' },
    ]);
    expect(tiers.size).toBe(0);
  });

  it('region mode ignores rows with null lat/lng', () => {
    const tiers = assignGeoTiers(LA_LIBERTAD_DEPT, [
      { user_id: 'u1', lat: null, lng: null, geo_bucket_4: 'd41w', geo_bucket_5: 'd41wx' },
    ]);
    expect(tiers.size).toBe(0);
  });
});
```

Note on the `gbsuv` expected neighbors: they come from the standard Veness adjacency
tables. If the implementation is correct but these literals were transcribed wrong, verify
by decoding: each neighbor decoded must be adjacent (±1 cell) to `gbsuv`'s cell. Fix the
test literals, not the algorithm, if they disagree with a reference implementation
(https://www.movable-type.co.uk/scripts/geohash.html).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/services/matching/__tests__/geoTiering.test.ts`
Expected: FAIL — `Cannot find module '../geoTiering'`

- [ ] **Step 3: Implement `geoTiering.ts`**

Create `src/services/matching/geoTiering.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/services/matching/__tests__/geoTiering.test.ts`
Expected: PASS (all suites). If the `gbsuv` literal test fails but all others pass,
verify against the reference implementation per the note in Step 1 and correct the
test literals.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (pre-existing errors unrelated to these files are acceptable —
compare against `git stash`-clean baseline if unsure).

---

### Task 2: `geocode-place` Edge Function

**Files:**
- Create: `supabase/functions/geocode-place/index.ts`

**Interfaces:**
- Consumes: Google Geocoding API (`GOOGLE_GEOCODING_API_KEY` secret — already set in the
  Supabase project, used by `geocode-user-destinations`).
- Produces (consumed by Task 3 via `supabase.functions.invoke('geocode-place')`):
  - Request body: `{ place: string, country?: string, state?: string }`
  - Response body: `GeocodedPlace` JSON (same shape as the client interface in Task 1)
    or `null` on any failure. Always HTTP 200 for handled outcomes.

- [ ] **Step 1: Write the Edge Function**

Create `supabase/functions/geocode-place/index.ts`:

```ts
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
```

- [ ] **Step 2: Sanity-check the file compiles as Deno (best effort)**

Run: `deno check supabase/functions/geocode-place/index.ts 2>/dev/null || echo "deno not installed — skip, reviewed by eye"`
Expected: `Checked ...` or the skip message. (Deno may not be installed locally; the
function is small and mirrors `geocode-user-destinations`, so eyeball review suffices.)

- [ ] **Step 3: Do NOT deploy yet**

Deployment happens after Ohad's review (see Task 4). Note for the deploy step:
per project convention, deploy via CLI (`supabase functions deploy geocode-place
--use-api` after `supabase login --token ...`). This function **keeps default JWT
verification** (do not pass `--no-verify-jwt`) — the client always calls it as an
authenticated user. Ensure a `supabase/config.toml` entry exists if the CLI requires
one to set `verify_jwt = true` explicitly.

---

### Task 3: Wire tiering into `findMatchingUsers`

**Files:**
- Modify: `src/services/matching/matchingService.ts` (imports at top; geocode kick-off
  near the start of `findMatchingUsers` ~line 902; tier fetch + sort at "Step 14"
  ~line 1370)

**Interfaces:**
- Consumes: `assignGeoTiers`, `GeocodedPlace`, `GeoTier`, `UserDestinationGeoRow` from
  `./geoTiering` (Task 1); `geocode-place` Edge Function (Task 2).
- Produces: no interface changes — `findMatchingUsers` signature and `MatchedUser`
  return shape are untouched. Only the ordering of the top-3 selection changes.

- [ ] **Step 1: Add import**

At the top of `src/services/matching/matchingService.ts`, alongside the existing
imports:

```ts
import { assignGeoTiers, GeocodedPlace, GeoTier, UserDestinationGeoRow } from './geoTiering';
```

- [ ] **Step 2: Kick off the geocode early (parallel with the surfer query)**

In `findMatchingUsers`, immediately after the `destinationCountryLower` block (the
`if (request.destination_country) { ... } else { ... }` around line 906-918), insert:

```ts
    // Geo tiering: geocode the requested area in parallel with the surfer query.
    // Any failure resolves to null → everyone stays Tier 3 (today's behavior).
    const geocodedPlacePromise: Promise<GeocodedPlace | null> =
      request.area && request.destination_country
        ? supabase.functions
            .invoke('geocode-place', {
              body: { place: request.area, country: request.destination_country },
            })
            .then(({ data, error }) => (error ? null : (data as GeocodedPlace | null)))
            .catch(() => null)
        : Promise.resolve(null);
```

- [ ] **Step 3: Fetch survivor geo rows and compute tiers before the final sort**

Find "Step 14" (currently):

```ts
    // Step 14: Sort and return top 3
    console.log('Step 14: Sorting and selecting top 3 matches...');
    console.log(`Total users with points: ${userPoints.size}`);
    
    const sortedUsers = Array.from(userPoints.values())
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
```

Replace with:

```ts
    // Step 13.5: Geo tiering — promote survivors who surfed near the requested spot.
    // Tiers only reorder the survivor set; they never add or remove anyone.
    let geoTiers = new Map<string, GeoTier>();
    const geocodedPlace = await geocodedPlacePromise;
    if (geocodedPlace && userPoints.size > 0) {
      try {
        const survivorIds = Array.from(userPoints.keys());
        const { data: geoRows, error: geoError } = await supabase
          .from('user_destinations')
          .select('user_id, lat, lng, geo_bucket_4, geo_bucket_5')
          .in('user_id', survivorIds);
        if (!geoError && geoRows) {
          geoTiers = assignGeoTiers(geocodedPlace, geoRows as UserDestinationGeoRow[]);
          console.log(
            `Geo tiers for "${request.area}": ` +
              `tier1=${[...geoTiers.values()].filter((t) => t === 1).length}, ` +
              `tier2=${[...geoTiers.values()].filter((t) => t === 2).length}, ` +
              `tier3=${survivorIds.length - geoTiers.size}`
          );
        }
      } catch (e) {
        console.warn('Geo tiering skipped (fetch failed):', e);
      }
    }
    const geoTierOf = (userId: string): GeoTier => geoTiers.get(userId) ?? 3;

    // Step 14: Sort (tier first, V2 score within tier) and return top 3
    console.log('Step 14: Sorting and selecting top 3 matches...');
    console.log(`Total users with points: ${userPoints.size}`);
    
    const sortedUsers = Array.from(userPoints.values())
      .sort(
        (a, b) =>
          geoTierOf(a.surfer.user_id) - geoTierOf(b.surfer.user_id) ||
          b.points - a.points
      )
      .slice(0, 3);
```

Also extend the existing "Top 3 matches" log object (a few lines below) with the tier,
changing:

```ts
    console.log('Top 3 matches:', sortedUsers.map(u => ({
      name: u.surfer.name,
      points: u.points,
      days: u.daysInDestination,
      country_from: u.surfer.country_from
    })));
```

to:

```ts
    console.log('Top 3 matches:', sortedUsers.map(u => ({
      name: u.surfer.name,
      points: u.points,
      geoTier: geoTierOf(u.surfer.user_id),
      days: u.daysInDestination,
      country_from: u.surfer.country_from
    })));
```

- [ ] **Step 4: Type-check and run the full matching test suite**

Run: `npx tsc --noEmit && npx jest src/services/matching`
Expected: tsc clean (vs baseline), all geoTiering tests pass, no other matching tests
break.

- [ ] **Step 5: Verify RLS lets a user read other users' `user_destinations` rows**

The tier fetch reads *other* users' rows client-side. Check the table's RLS policies
(read-only query via MCP `execute_sql` or ask Ohad):

```sql
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.user_destinations'::regclass;
```

Expected: a SELECT policy permitting authenticated reads (e.g. `true` or
`auth.role() = 'authenticated'`). **If SELECT is restricted to owner
(`auth.uid() = user_id`), STOP and flag it** — the fix is a new SELECT policy for
authenticated users exposing only geo columns (or a SECURITY DEFINER RPC), which Ohad
must apply manually per project convention (no `supabase db push`; note that new RPCs
need explicit GRANT because EXECUTE was revoked project-wide).

---

### Task 4: Handoff checklist (manual, for Ohad)

**Files:** none — verification and deployment notes.

- [ ] **Step 1: Confirm test + type-check evidence**

Run: `npx jest src/services/matching && npx tsc --noEmit`
Expected: all green. Paste output in the handoff summary.

- [ ] **Step 2: Write the handoff summary**

Summarize for Ohad:
- Deploy `supabase/functions/geocode-place` via CLI (default JWT verification — no
  `--no-verify-jwt`).
- RLS finding from Task 3 Step 5 (OK, or policy SQL to apply manually).
- On-device test script: in Swelly trip chat ask for (a) "someone who surfed in
  Uluwatu" — expect Bukit/Bali surfers ranked above other-Indonesia; (b) a region
  ("La Libertad, El Salvador"); (c) a nonsense place — expect today's behavior; and
  (d) confirm a US-state query still never returns a different state.
- No commits were made; changed files: `src/services/matching/geoTiering.ts`,
  `src/services/matching/__tests__/geoTiering.test.ts`,
  `src/services/matching/matchingService.ts`,
  `supabase/functions/geocode-place/index.ts`.
