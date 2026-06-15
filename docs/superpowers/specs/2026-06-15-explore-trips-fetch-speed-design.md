# Explore Trips — Faster Initial Load (Design)

- **Date:** 2026-06-15
- **Author:** Ohad
- **Status:** Approved (brainstorm) → ready for implementation plan
- **Scope:** `Approach A` (client-only) now; `Approach B` (RPC) documented for later.

---

## Problem

The Explore tab's initial (cold) load feels slow: the user sees the loading
skeleton "for a while" before the **first card** appears. We want it to feel
fast and to handle data fetching smartly (Instagram-feed-like), **keeping the
existing horizontal swipe-deck layout** (no UX/layout change).

### Measured reality (don't optimize the wrong thing)

| Metric | Value |
| --- | --- |
| Active explore trips (`status='active'`) | **6** |
| All trips | 14 |
| Avg participants / trip | 1.9 |
| Distinct users across active trips | 5 |
| Avg description length | ~189 chars |

The payload is tiny (~15–30 KB total). Therefore the bottleneck is **NOT**
data volume, `select('*')`, a missing index, or pagination — at 6 rows those
are irrelevant. The bottleneck is **network latency from sequential
round-trips before first paint**.

### Current fetch path (the real cause)

`useExploreTrips` (`src/hooks/trips/useTripQueries.ts:38-46`) awaits **3
round-trips in series** before `isLoading` flips to false:

1. `listExploreTrips()` — `group_trips` (+ destination embed)
   (`src/services/trips/groupTripsService.ts:487-500`)
2. then `getTripCardMeta()` which itself runs **two serial queries**
   (`groupTripsService.ts:628-682`):
   - `group_trip_participants` (`.in('trip_id', ids)`)
   - `surfers` (`.in('user_id', hosts ∪ participants)`)

Only after all three resolve does the deck paint. On a cold mobile connection
(TLS + auth + 3 serial RTTs) that is easily 1–2 s even though DB time is <1 ms.

`ExploreTripCard` (`src/screens/trips/TripsScreen.tsx:359-492`) already
**degrades gracefully without `meta`**: `meta?.memberAvatars ?? []`, host
avatar falls back to an icon, `totalCount` falls back to
`trip.participant_count`. So the card can render fully from `trip` alone.

---

## Goals / Non-Goals

### Goals
- First Explore card paints near-instantly on cold load.
- Re-entry stays instant (already true via react-query cache).
- Smart, progressive data fetching; keep the horizontal deck.
- Low risk, no schema/infra changes, respects the manual-migration workflow.

### Non-Goals (YAGNI at 6 trips — documented below for scale)
- `explore_feed` RPC (Approach B).
- Composite index `(status, created_at DESC)`.
- Pagination / infinite scroll.
- **Blurhash storage** (a stored per-image hash). We get blur-up for free via
  the existing Supabase image transform — see change 4. Stored blurhash is a
  future zero-fetch upgrade, documented below.
- Any change to **My Trips** (separate code path, untouched).

---

## Design — Approach A

Four changes. The first two attack the latency directly; the last two are
cheap polish/hygiene.

### 1. Split the query: trips-first, meta-second (progressive render)

Decouple avatar/meta loading from first paint.

- `useExploreTrips` returns **trips only** (`listExploreTrips()`). When it
  resolves (**1 RTT**), the deck paints: photo, title, location, price, dates,
  spots-left. `ExploreDeckSkeleton` hides here.
- New `useExploreTripsMeta(tripIds)` query runs `getTripCardMeta()`, `enabled`
  once trips exist, under a new key `tripsKeys.exploreMeta(ids)`. It is merged
  via `meta.get(id)`; until it resolves the card shows its existing fallback
  (host icon, count from `participant_count`). Avatars/host name fade in when
  meta arrives.

**Data flow:**

```
BEFORE (blocking):  trips ──▶ participants ──▶ surfers ──▶ PAINT   (3 RTT)
AFTER  (progressive): trips ──▶ PAINT                              (1 RTT)
                          └──▶ [participants ──▶ surfers] ──▶ avatars fade in
```

### 2. Prefetch the Explore query early (warm the cache)

Fire `queryClient.prefetchQuery({ queryKey: tripsKeys.explore, queryFn:
listExploreTrips })` (and then the meta prefetch) **fire-and-forget** **when the
user enters the main app** — a `useEffect` gated on `shouldShowConversations`
(the existing "entered main app" signal in `AppContent.tsx`, see the effect at
`AppContent.tsx:1590`), with a `useRef` **once-guard** so it fires once per app
session (react-query also no-ops a prefetch while data is fresh, so this is
belt-and-suspenders).

**Why main-app entry, not session restore:** it skips users still in onboarding
(steps -1…5) who won't see Explore for a while (avoids a wasted fetch + stale
data), and fires closer to when they'll open Trips so the cache (`staleTime`
5 min / `gcTime` 30 min) is more likely still fresh. Authenticated-only (the
main app already requires auth). At 6 rows the cost is negligible and entering
Trips becomes **instant**. This is the single biggest perceived win.

### 3. Trim selected columns

Replace `select('*')` in `listExploreTrips`
(`groupTripsService.ts:490`) with the exact fields `ExploreTripCard` reads.
Verified against `formatTripPrice`, `formatTripDates`, `formatDestination`,
and `normalizeTrip` (which only spreads + picks `destination`, so no hidden
deps):

```
id, host_id, hosting_style, title, hero_image_url,
start_date, end_date, dates_set_in_stone, date_months,
cost_per_person, budget_min, budget_max,
max_participants, participant_count, created_at,
destination:group_trip_destinations(name, short_label, country, admin_level_1, lat, lng)
```

Hygiene + lighter parse; also reduces future-scale payload. Explore-only
(`listExploreTrips` is not used by My Trips).

### 4. Image polish: blur-up placeholder + neighbour prefetch

Two cheap image wins on the deck, both in `TripsScreen.tsx`:

**Blur-up placeholder (zero storage).** In `ExploreTripCard`
(`TripsScreen.tsx:384-396`), pass a tiny transform thumbnail as the
`expo-image` `placeholder`:

```tsx
<CachedImage
  source={{ uri: trip.hero_image_url }}
  placeholder={getStorageThumbUrl(trip.hero_image_url, 24) ? { uri: getStorageThumbUrl(trip.hero_image_url, 24)! } : undefined}
  placeholderContentFit="cover"
  contentFit="cover"
  cachePolicy="memory-disk"
  transition={150}
/>
```

`getStorageThumbUrl` (`src/services/media/imageService.ts`) rewrites a Supabase
public object URL to the `render/image` endpoint at ~24 px — already used in
production (NotificationCenter), so image transforms are confirmed enabled. The
24 px image (~1–2 KB, cached) shows blurry immediately and crossfades to the
full hero (Instagram blur-up). **Graceful fallback:** for non-Supabase hero
URLs `getStorageThumbUrl` returns the URL unchanged, so we pass no placeholder
and fall back to the existing 150 ms fade. Compute the thumb URL with a
`useMemo` to avoid recomputing per render.

**Neighbour prefetch.** In `TripDeck` (`TripsScreen.tsx:526-645`), as the
focused index changes, `Image.prefetch()` the hero URLs of the ±1 neighbours so
the next card's photo is warm when swiped. No render change.

---

## Error handling / edge cases

- **Trips query fails:** existing empty/error state.
- **Meta query fails:** cards render without avatars (graceful); log only.
- **Prefetch (data or images) fails:** silent, never blocks.
- **No trips:** existing empty state (only after load resolves, not during).
- **My Trips:** untouched — the split and trim are Explore-only.

---

## Testing

- **Unit:** `listExploreTrips` returns the trimmed shape; `useExploreTrips`
  exposes `trips` before `meta` resolves (mocked supabase).
- **Manual:** cold load (clear cache) → first card within ~1 RTT, avatars
  pop-in afterward; re-entry instant (prefetched/warm cache); hero shows a
  blurry placeholder that crossfades to sharp; swipe shows next photo already
  loaded.

---

## Files to touch

| Change | File | Anchor |
| --- | --- | --- |
| Split trips/meta hooks + new key | `src/hooks/trips/useTripQueries.ts` | `useExploreTrips` (38-46), `tripsKeys` |
| Trim columns | `src/services/trips/groupTripsService.ts` | `listExploreTrips` (487-500) |
| Early prefetch on main-app entry (once-guarded) | `src/components/AppContent.tsx` | `useEffect` gated on `shouldShowConversations` (near 1590) |
| Blur-up placeholder + neighbour prefetch | `src/screens/trips/TripsScreen.tsx` | `ExploreTripCard` (384-396), `TripDeck` (526-645) |

---

## Documented for later (NOT built now)

### Approach B — `explore_feed` RPC (1 round-trip)
A Postgres function returning trips + host name/avatar + member avatars +
counts in **one** round-trip (collapses 3 RTT → 1). More elegant and scales,
but adds: SQL + RLS care (member avatars the viewer shouldn't see),
`GRANT EXECUTE` to `authenticated`, and a **manually-applied migration** (per
project workflow — never `supabase db push`). At 6 trips it is not faster than
Approach A in any user-visible way. **Trigger:** revisit when Explore regularly
returns enough trips that 3 RTT of meta is a real cost, or when we want one
cache entry per feed page.

### Scale-triggered upgrades
- **Composite index** `group_trips(status, created_at DESC)` — when active
  trips exceed ~a few hundred and the filter+sort scan shows up.
- **Pagination / infinite scroll** — when active trips exceed ~30–50 (deck
  currently fetches a single batch of up to 50).
- **Stored blurhash (zero-fetch blur-up)** — change 4 gives blur-up via a tiny
  transform fetch (~1–2 KB). A stored blurhash per hero image (column +
  generate-on-upload + backfill) would make the placeholder **inline / zero
  fetch** — marginally smoother. Only worth it if the thumb fetch ever proves
  noticeable.
