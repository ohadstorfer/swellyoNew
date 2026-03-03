# swelly-trip-planning-copy-copy (Geo-based matching)

Same as `swelly-trip-planning-copy` except the **destination** matching path uses the geocoded `user_destinations` table and geo buckets (`geo_bucket_4/5/6`) for indexed, tiered matching. The **general** path (no destination) is unchanged.

## Behaviour

- **Find-matches with destination:** Geocode the request (country + area) via Google Geocoding → determine scale (`country` | `region` | `admin1` | `town` | `spot`) and target → query `user_destinations` by country and scale-appropriate bucket/admin → rank by tier (place_id > bucket_6 > bucket_5 > bucket_4 > admin1 > country) and days in destination → apply existing `queryFilters` on surfers → return and save matches.
- **Find-matches without destination:** Unchanged; uses inlined general match (queryFilters only).
- **Chat / LLM:** Unchanged; same prompt and request parsing as copy.

## Env

- `GOOGLE_GEOCODING_API_KEY` – required for destination path (geocode + scale).
- Same as copy: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Rollout

Deploy alongside copy. Switch traffic via feature flag or config (e.g. `EXPO_PUBLIC_GEO_MATCHING_COPY=true`) to call this function instead of copy for find-matches.

## Files

- `geoScaleUtils.ts` – scale + target from Geocoding result.
- `geohashUtils.ts` – encode geohash + neighbor expansion (bucket_5/6).
- `geoMatchingService.ts` – `findMatchingUsersGeo()` (user_destinations + tiered ranking).
- `index.ts` – same as copy; destination path calls `findMatchingUsersGeo`, general path inlined.
