# Matching at Scale — `match_surfers` Postgres Function

**Date:** 2026-06-05
**Author:** Ohad (+ Claude)
**Status:** Draft — awaiting review

## Problem

Production matching runs server-side in the `swelly-trip-planning-copy` edge function
(`/find-matches`, inlined in `index.ts`). It fetches **every** surfer row (10 columns, no
`LIMIT`, excluding only self + demo) into Deno memory, then filters, scores, and ranks in
JavaScript. Cost grows linearly with the `surfers` table (531 rows today). The product has
outgrown the implicit "~1000 users" ceiling and must return correct matches across the whole
database **without pulling every row** into the function.

> Note: the client `src/services/matching/matchingService.ts` (`findMatchingUsers`) is a
> **legacy/dead** path on production. The scale-report flagged it, but production does not use
> it. The authoritative behavior to preserve is the **edge function**, per repo `index.ts`
> (treated as current per Ohad's call).

## Parity contract

The user-visible result must stay **identical** to today:

- **Who qualifies** (filters + destination match) — exact.
- **Ordering** — exact, because real scoring is just deterministic day-sums (see below).
- **Page size** — top 3 (`MATCHES_PAGE_SIZE`), plus `totalCount` of all qualifiers.
- **Ties** — already non-deterministic today (JS sort falls back to DB return order, which has
  no `ORDER BY`). Not a parity obligation.

## Current behavior — exact map (the spec to reproduce)

### Shared fetch (`buildSurferQueryInline`)
- `from('surfers')` selecting: `user_id, name, profile_image_url, country_from,
  surfboard_type, surf_level, surf_level_category, age, travel_experience, destinations_array`
- `.neq('user_id', requestingUserId)`
- `.or('is_demo_user.is.null,is_demo_user.eq.false')`
- excluded (previously-matched) ids removed (SQL `.neq` per id if ≤10, always re-filtered in memory)
- **No `LIMIT`. No `pending_deletion` filter** (differs from legacy client — preserve as-is;
  flag separately if pending-deletion users showing is undesirable).

### Path selection
`hasDestination = destination_country is non-empty`. Otherwise "general".

### General path (no destination)
1. Require ≥1 meaningful query filter (`hasMeaningfulQueryFiltersInline`) else **throw**.
2. `passesCriteriaInline` (see filters below).
3. `match_score = totalDaysInDestinationsInline` = Σ `time_in_days` over **all** destinations.
4. Sort by that desc. `match_quality = { matchCount: 1, countryMatch: false, areaMatch: false, townMatch: false }`.
5. `slice(0, 3)`. `totalCount = candidates.length`.

### Destination path
1. Per surfer, iterate `destinations_array`; for each dest where
   `countryMatchesRequestInline(destination_country, dest.country, dest.state)` is true, add
   `time_in_days`; flag `hasAreaMatch` if `hasRequestedAreaInArrayInline(dest, area)`.
2. Keep surfer only if accumulated `days > 0`.
3. `passesCriteriaInline`.
4. Sort: **area-match first** (only when `area` requested), then `days` desc.
5. `match_score = days in destination`; `matched_areas = [area]` when area matched;
   `match_quality = { matchCount: 1, countryMatch: true, areaMatch, townMatch: false }`.
6. `slice(0, 3)`. `totalCount = afterCriteria.length`.

### `passesCriteriaInline` (hard filters — both paths)
- **country_from** (`countryFromMatchInline`): pass if no filter; else surfer.country_from
  (lowercased, trimmed) matches **any** requested via: exact eq; `usa`/`united states`
  alias (substring either way); `uk`/`united kingdom` alias (incl. `\buk\b` regex);
  else **bidirectional substring** (`user.includes(req) || req.includes(user)`). Null country fails.
- **surfboard_type**: normalize both (`normalizeBoardTypeInline`: midlength→mid_length, etc.);
  surfer's normalized board must be in requested set. Null/empty fails.
- **surf_level_category**: requested categories → numeric via `{beginner:1,…,pro:4}`.
  - single category: pass if surfer category equals it, **or** (surfer has no category) surfer
    `surf_level` equals that level.
  - multiple: allowed numeric levels = all `>= min(requested)`; pass if surfer category in
    requested **or** surfer `surf_level` in allowed.
- **age_min** / **age_max**: surfer.age must be a number and `>= age_min` / `<= age_max`. Null fails.

### Fuzzy helpers to port faithfully
- `getCountryFromUserDestInline`: `{country}` → country; `{destination_name}` / string →
  first comma-part.
- `countryMatchesRequestInline`: splits requested on commas; per token: exact;
  `usa`/`united states` ↔ contains; `uk`/`united kingdom` ↔ contains/`\buk\b`;
  `united states - <state>` → state eq/contains against dest.state when US user; else
  `\b<token>\b` word-boundary regex against dest country.
- `hasRequestedAreaInArrayInline`: case-insensitive eq/contains either way against `area[]`
  (new format) or comma-tail of `destination_name`/string (legacy).

## Design

### `match_surfers` Postgres function

`SECURITY DEFINER` (reads all surfers regardless of RLS, like the edge function's service role),
`STABLE`. Signature (final names TBD in implementation):

```
match_surfers(
  p_requesting_user_id uuid,
  p_excluded_ids       uuid[]   default '{}',
  p_destination_country text    default null,
  p_area               text     default null,
  p_country_from       text[]   default null,
  p_surfboard_type     text[]   default null,
  p_surf_level_category text[]  default null,
  p_age_min            int      default null,
  p_age_max            int      default null,
  p_limit              int      default 3
) returns table (
  user_id uuid, name text, profile_image_url text, country_from text,
  surfboard_type text, surf_level int, travel_experience text, age int,
  destinations_array jsonb, match_score int, days_in_destination int,
  matched_areas text[], country_match boolean, area_match boolean,
  total_count bigint            -- window count of all qualifiers, same on every row
)
```

Internals:
- Base CTE: surfers where `user_id <> p_requesting_user_id`, demo excluded,
  `user_id <> ALL(p_excluded_ids)`.
- Hard filters as `WHERE` clauses faithfully mirroring `passesCriteriaInline`
  (country_from / board / level-category / age). The fuzzy country_from and the
  level-category mapping become SQL expressions / a small `immutable` SQL helper each.
- Destination path: `EXISTS`/lateral over `jsonb_array_elements(destinations_array)` applying
  the `countryMatchesRequestInline` logic; `days = Σ time_in_days` of matching elements (require
  `> 0`); `area_match` via `hasRequestedAreaInArrayInline`.
- General path (when `p_destination_country` is null): `match_score = days_in_destination =
  Σ time_in_days` over all destinations; `country_match=false, area_match=false`.
- `ORDER BY` mirrors the path (destination: `area_match desc` when area set, then days desc;
  general: total days desc), `LIMIT p_limit`.
- `total_count = count(*) OVER ()` computed **before** limit.

Returns only the page (≤3 rows) + total — no row egress proportional to table size.

### Integration

**Local testing (this iteration):**
- New client method `findMatchingUsersRpc(request, requestingUserId, excludedIds)` in a small
  new module (not the legacy `matchingService.ts`): calls `supabase.rpc('match_surfers', …)`,
  maps rows to `MatchedUser` (same shape as `mapServerMatchToMatchedUser`), returns
  `{ matches, totalCount }`.
- Wire **`src/screens/TripPlanningChatScreen.tsx`** (non-copy) to use it in place of
  `svc.findMatchingUsersServer`. Track excluded ids in component state for "show more".
- The general-path guard (require ≥1 filter) stays in the caller.
- No `matching_users` writes during local testing — pagination uses in-memory excluded ids.

**Production cutover (later, separate task — NOT in this iteration):**
- Edge function `find-matches` replaces fetch + JS loop with one
  `supabaseAdmin.rpc('match_surfers', …)`, keeping `getPreviouslyMatchedUserIds`,
  `saveMatchesInline`, and message persistence.
- Deploy only after pulling the **live** edge source and diffing (repo may lag live).

### Scale follow-up (documented, not blocking parity)
Without an index, the function still does one in-DB scan per request (fine to ~tens of
thousands; ~100k starts to matter on destination-only queries). Fast-follow: a trigger-maintained,
GIN-indexed `destination_countries text[]` on `surfers` (normalized country tokens derived from
`destinations_array`, mirroring `getCountryFromUserDestInline` + USA folding) used as an indexed
pre-filter. Pure speed; zero effect on which surfers match or their order.

## Validation
- Ohad runs the app locally on the non-copy screen and compares results against the production
  (copy) screen for the same prompts: same people, same order, same count.
- Spot-check edge cases: USA (`country:"USA"` + `state`), UK alias, multi-country
  `destination_country`, multi-category `surf_level_category`, age-only filter, no-destination
  general match, "show more" pagination.

## Risks / edge cases
- **Fuzzy SQL port** (country_from + destination country) is the main risk; it's filters
  (booleans), not arithmetic, so divergences are easy to spot by diffing the qualifier set.
- **`pending_deletion`** is not excluded today; the function preserves that. Flag separately.
- **Legacy destination formats** (`destination_name` string) are rare per Ohad ("just a
  fallback; GPT returns clean country text") — ported anyway, validated in testing.
- **`travel_experience`** is selected/returned but unused in scoring — preserve passthrough.

## Out of scope
- Production edge-function cutover and deploy.
- The GIN-index optimization (separate fast-follow).
- Removing the dead legacy client `findMatchingUsers` (and reverting its stray `.limit(1000)`).
