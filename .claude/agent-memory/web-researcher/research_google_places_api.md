---
name: Google Places API — Response Fields, Stability, Storage, Session Tokens
description: What fields come back from Places API (New), which are stable, what to store in DB, session token billing, and Legacy vs New API comparison for 2026
type: reference
---

## Places API (New) — Key Fields

**Essentials SKU (cheapest tier) — returned by default at low cost:**
- `id` (formerly `place_id`) — unique place identifier
- `location` — lat/lng (geometry.location in legacy)
- `formattedAddress` — full human-readable address string
- `addressComponents` — array of components (street, city, state, country, postal_code) each with `long_name`, `short_name`, `types[]`
- `types` — place type array (e.g., `["natural_feature", "establishment"]`)
- `plusCode` — Open Location Code (for areas without precise addresses)
- `shortFormattedAddress`

**Pro SKU (higher cost):**
- `displayName` — human-readable name (e.g., "Ocean Beach"); was `name` in legacy
- `primaryType` — single dominant type (new in v1)
- `businessStatus`, `openingHours`, `googleMapsUri`

## place_id Stability

- Google docs: place_id "can change" — recommended refresh interval is 12 months
- Can have multiple place_ids for the same physical place
- Refresh is free: call Place Details with fields=id only
- CID (Google's internal ID) is more permanent, but not accessible via standard Places API
- Best practice: store place_id + timestamp of storage; re-validate if > 12 months old

## What to Store in DB

**Minimum viable:**
- `place_id` (TEXT, index it)
- `name` / `displayName` (TEXT)
- `formatted_address` (TEXT)
- `lat` + `lng` (FLOAT8 or use PostGIS point)
- `place_id_saved_at` (TIMESTAMPTZ) — for refresh tracking

**Comprehensive (for search/filter):**
- All of above + `country` (from addressComponents), `locality` (city), `types[]` (TEXT[])
- For surf context: `country_code` SHORT_NAME from addressComponents[type=country]

## Session Tokens + Billing

- Use a UUID v4 session token per autocomplete session
- Pass same token to every keypress request AND to the final Place Details call
- After user selects (Place Details completes), generate NEW token
- Reusing a token across multiple sessions = each request billed individually
- Autocomplete sessions (New) are currently free when terminated by a Place Details call
- Beyond 12 autocomplete requests in one session → billed at Autocomplete Session Usage rate

## Legacy vs New API

- Places API (New) is mandatory for new projects as of late 2025 — Legacy cannot be enabled for new GCP projects
- New API: field masking (pay only for fields you request), standardized response format
- Legacy API: fixed response packages, higher billing, still works for existing projects but being phased out
- Use Places API (New) exclusively for any new 2026 project

## Sources
- https://developers.google.com/maps/documentation/places/web-service/place-id
- https://developers.google.com/maps/documentation/places/web-service/data-fields
- https://developers.google.com/maps/documentation/places/web-service/session-pricing
- https://developers.google.com/maps/documentation/places/web-service/place-details
