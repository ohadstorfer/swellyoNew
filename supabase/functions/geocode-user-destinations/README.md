# geocode-user-destinations

Populates the `user_destinations` table by geocoding place names from a user's `destinations_array` (onboarding destinations) via the Google Geocoding API.

## Environment / Secrets

- **GOOGLE_GEOCODING_API_KEY** (required): Google Maps Geocoding API key. Set in Supabase Edge Function secrets.
- **GEOCODE_INTERNAL_SECRET** (optional): If set, allows backfill calls with `POST body: { user_id }` and header `x-internal-secret: <value>`. The function then loads `destinations_array` from `surfers` for that user. Used by `update-destinations-from-onboarding` for backfill.

## Request modes

1. **Client (onboarding completion)**  
   - `Authorization: Bearer <user_jwt>`  
   - Body: `{ "destinations_array": [ { "country": "...", "area": ["Place A", "Place B"], ... }, ... ] }`  
   - Resolves `user_id` from the JWT and geocodes each place, then upserts into `user_destinations` (dedup by `user_id` + `place_id`).

2. **Backfill (internal)**  
   - `x-internal-secret` header must match `GEOCODE_INTERNAL_SECRET`.  
   - Body: `{ "user_id": "<uuid>" }`  
   - Loads `destinations_array` from `surfers` for that user and runs the same geocode + upsert flow.

## Behavior

- Extracts place names from each destination’s `area` strings (splits on comma and “ and ”, strips stopwords like “area”, “in general”).
- Geocodes each (place name + country, and state for USA) with the Google Geocoding API.
- Normalizes the response to `place_id`, `lat`, `lng`, `country`, `admin_level_1`, `admin_level_2`, `locality`, `types`, `display_name`, and `formatted_address`. `display_name` is the place name used in the geocode request; `formatted_address` is from the Geocoding API result.
- Inserts only rows that don’t already exist for that user and `place_id` (no duplicates).
- Uses a short delay between API calls to respect rate limits.
