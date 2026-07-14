# Geo-Bucket Tiered Destination Matching — Design Spec

**Date:** 2026-07-13
**Status:** Approved design, pending implementation plan

## Problem

Swelly trip matching ("send me someone who surfed in Uluwatu") filters destinations by
**country-name string comparison** on `surfers.destinations_array`. "Uluwatu" effectively
means "Indonesia": someone who surfed the Mentawais ranks identically to someone who lived
on the Bukit. Meanwhile every user destination is already geocoded into the
`user_destinations` table (lat/lng + geohash buckets at precision 4 ≈ 40 km, 5 ≈ 5 km,
6 ≈ 1 km) by the `geocode-user-destinations` Edge Function, and that data is unused by
matching.

## Goal

When the request names a specific area/spot, rank candidates by real geographic proximity
to it — while preserving today's guarantees:

- **The country wall stays.** A candidate who never surfed the requested country is
  excluded, period.
- **US states act as countries.** Requesting a US state never returns someone who only
  surfed a different state (existing behavior, unchanged).
- **Results never get emptier than today.** Geo data only *promotes* candidates within the
  survivor set; it never excludes anyone.

## Non-Goals

- No changes to the `swelly-trip-planning` Edge Function (live version is ahead of the
  repo; out of scope).
- No changes to filter extraction, other hard filters, or the V2 scoring internals.
- No new user-facing UI.

## Design

### 1. New Edge Function: `geocode-place`

Standalone function; does not touch existing functions.

- **Input:** `{ place: string, country?: string, state?: string }`. Country/state come
  from the already-extracted query filters and are appended to the geocode query for
  disambiguation (e.g. "La Libertad" → El Salvador vs Peru).
- **Behavior:** calls the Google Geocoding API (same server-side key as
  `geocode-user-destinations`), encodes geohashes with the same encoder (copy the pure
  function).
- **Output:**

  ```json
  {
    "lat": -8.829,
    "lng": 115.088,
    "geo_bucket_4": "qw4y",
    "geo_bucket_5": "qw4yg",
    "country": "Indonesia",
    "state": null,
    "is_region": false,
    "bounds": { "sw": { "lat": ..., "lng": ... }, "ne": { "lat": ..., "lng": ... } }
  }
  ```

- **`is_region`:** true when the top Google result's `types` contains
  `administrative_area_level_1/2` or `country` (an area, not a point). Point-like types
  (`locality`, `sublocality`, `natural_feature`, `point_of_interest`, etc.) → false.
- **`bounds`:** Google's `geometry.bounds` (fallback `geometry.viewport`), used for
  region-mode promotion.
- **Failure mode:** any Google error, zero results, or unparseable place → HTTP 200 with
  `null` body. Never throws to the client.
- **Auth:** requires a valid user JWT (standard verify_jwt), same as
  `geocode-user-destinations`.

### 2. Client: tiered ranking in `findMatchingUsers` (matchingService.ts)

The existing pipeline is unchanged through Step 6 (hard filters + country/US-state
destination filter). Tiering is an **additive re-ordering** applied to the survivor set:

1. If `request.area` is absent → skip everything below; behavior identical to today.
2. Call `geocode-place` with `{ place: request.area, country: request.destination_country,
   state }` (in parallel with the existing surfer query — it adds no latency to the
   critical path if fired early).
3. If the response is `null` → skip; all survivors are Tier 3 (today's behavior).
4. One query: `user_destinations` rows `.in('user_id', survivorIds)` selecting
   `user_id, lat, lng, geo_bucket_4, geo_bucket_5, country` (survivors are already a
   country-filtered set; expected size ≤ a few hundred rows).
5. Assign each survivor the **best tier across all their destinations**:

   **Point mode (`is_region: false`):**
   - **Tier 1:** any destination whose `geo_bucket_5` equals the requested `geo_bucket_5`
     or one of its 8 neighbors (~5 km — "surfed this spot").
   - **Tier 2:** any destination whose `geo_bucket_4` equals the requested `geo_bucket_4`
     or one of its 8 neighbors (~40 km — same coast/area).
   - **Tier 3:** everyone else (country/state matched only — today's result set).

   **Region mode (`is_region: true`):**
   - Geohash rings around a region *centroid* are meaningless (e.g. the La Libertad
     department centroid is ~20 km inland; a huge region's centroid can be hundreds of km
     from any coast). Skip buckets entirely.
   - **Tier 2:** any destination whose lat/lng falls inside `bounds` (plain 4-number
     comparison, no API call). Handle antimeridian-crossing bounds (sw.lng > ne.lng) with
     the standard two-interval check.
   - **Tier 3:** everyone else. (No Tier 1 in region mode.)

6. Final ordering: **tier ascending, then existing V2 score descending within tier.** The
   V2 scoring pipeline itself is untouched.

Candidates with no `user_destinations` rows (backfill gap, geocode outage at save time)
simply stay in Tier 3 — geo data never demotes below today's baseline and never excludes.

### 3. Geohash neighbors

Bucket equality alone misclassifies points that straddle a bucket edge (two spots 2 km
apart can be in different precision-5 cells). Tier checks therefore compare against the
requested bucket **plus its 8 neighbors**. Implemented as a small pure function
(`geohashNeighbors(hash: string): string[]`) in a new client util, shared by both tier
checks. Precision 6 is unused (too fine for surf spots — beach vs village splits identical
answers).

### 4. Files touched

| File | Change |
|---|---|
| `supabase/functions/geocode-place/index.ts` | new Edge Function |
| `src/services/matching/geoTiering.ts` | new: geohash neighbors, tier assignment, bounds check (pure functions) |
| `src/services/matching/matchingService.ts` | call `geocode-place`, fetch `user_destinations` for survivors, apply tier-then-score ordering |
| `src/services/matching/__tests__/geoTiering.test.ts` | unit tests |

OTA-safe: pure JS, no native changes. Trivially revertible (ordering layer only).

### 5. Edge cases

| Case | Outcome |
|---|---|
| Geocode fails / place too vague | `null` → all Tier 3 = today's behavior |
| Ambiguous name ("La Libertad" SV vs PE) | country/state from extracted filters passed as context; wrong-country resolve → no promotions, Tier 3 = today |
| Region-level place (department, state, big area) | region mode: bounds promotion to Tier 2, no false-precision Tier 1 |
| Bucket straddles a country/state border | irrelevant — the wall (Step 6) already excluded cross-border candidates before tiering |
| US state requested | wall unchanged (state = country); tiering ranks within the state |
| Nickname ("J Bay") | Google usually resolves famous surf nicknames; if not → `null` → today's behavior |
| Candidate missing from `user_destinations` | Tier 3, never excluded |
| Antimeridian-spanning region bounds (Fiji) | two-interval longitude check |

### 6. Testing

- Unit tests (Jest): geohash neighbor derivation (incl. edge cells at poles/antimeridian),
  point-mode tier assignment, region-mode bounds check (incl. antimeridian), best-tier-
  across-destinations, stable tie-breaking by V2 score.
- `tsc` clean.
- On-device verification by Ohad (no simulator/Maestro testing).
