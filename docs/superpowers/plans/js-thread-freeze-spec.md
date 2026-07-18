# JS-Thread Freeze — Root-Cause Spec & Fix Plan

**Date:** 2026-07-18 · **Status:** investigation complete; Phases 0–2 IMPLEMENTED (uncommitted, on `ohad`); Phase 3 open for discussion
**Symptom:** progressive lag under heavy navigation → screen unresponsive; native tab bar still highlights but tab content goes blank on switch (lazy mount needs JS). Reproduced by Ohad: open/close many trips from Explore.

## 1. What the freeze IS

A **JS-thread starvation**, not a stuck overlay. Evidence:

- Blank pages behind the responsive native tab bar (`@bottom-tabs` is a native `UITabBarController`; switching tab *content* requires a JS commit).
- Carousel swipes kept working "until some point" — native-driven scroll works while JS is dead, until the FlatList's pre-rendered window runs out.
- Progressive degradation before the stall — an accumulating workload, not a binary state.
- Precedent: commit `a03352f` (2026-06-14) fixed the identical symptom ("realtime channel pileup in card stack… pegged the JS thread, hot device, ~7s tap lag").

## 2. Root-cause model — three verified contributors

Trip cards **do** unmount when popped, and every effect/timer/listener in `TripDetailScreen` cleans up correctly (audited). What accumulates lives *outside* the screens:

### A. Query-cache growth × unthrottled invalidation scans (primary progressive-lag driver)

- Every `TripDetail` mount seeds 3–5 query-cache entries (`useTripDetail.ts:101-144`); `gcTime` is 30 min globally (`src/lib/queryClient.ts:20-30`), so nothing collected during a heavy session.
- Cache grows **faster than trips opened**: `TripsScreen` prefetches `tripsKeys.detail(id)` for every card ≥50% visible while scrolling (`TripsScreen.tsx:~605-633`) and on `onPressIn` (`~426`, `~1111`).
- On **every trip focus**, `useTripRealtime.ts:37-55` fires 5 unconditional `invalidateQueries()` calls. Verified in `@tanstack/query-core`: each call = 2 synchronous full-cache scans (`findAll` for invalidate + another for `refetchQueries({type:'active'})`) → **10 O(cache-size) JS-thread scans + a refetch fan-out per trip open**. `useTripDetail.ts:49-77` (`seedFromListCache`) adds one raw `getQueryCache().getAll()` scan per mount.
- Net: per-open cost grows with every trip ever touched in the session → O(N²) across a session. Textbook progressive lag.

### B. Realtime channel churn races (the "wedged" contributor)

Each open/close cycle = 3 private-channel subscribe/unsubscribe pairs (`trip:{id}` + `trips-list` + `trips-mine:{uid}` re-cycled on the Trips tab's blur/refocus), each with an auth round-trip. Bounded per cycle, BUT vendored `realtime-js@2.80.0` has two verified hazards under fast cycling:

1. **Same-topic orphan race** (verified in `node_modules` — `RealtimeClient._remove` filters `this.channels` by **topic**): if a new channel with the same topic is created while the old one is still leaving, the old channel's close removes **both** from the dispatch list → the new channel is silently dead client-side but still joined server-side. Trigger: fast blur→refocus of the Trips tab (`trips-list` is a constant topic) or reopening the same trip quickly. The in-house defense already exists in `subscribeToConversationListUpdatesBatch` (unique topic per rebuild) but is missing from the trip/list hooks.
2. **Leave-before-join rejoin loops** (Phoenix #3349): leaving a channel before its join resolves can schedule automatic rejoins — orphaned retry loops that survive the screen pop and accumulate per fast cycle. Matches "progressive, then permanently wedged".

Also: `removeChannel` is fire-and-forget in both trip hooks — teardown/re-subscribe can overlap.

### C. Synchronized rejoin bursts (the stall amplifier)

Verified in vendor code: on socket error, ALL channels' error handlers run synchronously and arm **identical 1s no-jitter timers** (`RECONNECT_INTERVALS = [1000, 2000, 5000, 10000]`) → all rejoin in one macrotask with O(N) bookkeeping each = O(N²) burst per backoff step. Any socket wobble during an already-loaded session concentrates the damage. `createClient` accepts `reconnectAfterMs` — the clean lever for jitter.

### Ruled out (audited clean)

Screen-local timers/listeners/RAF/video players; presence refcounting (TripDetail doesn't watch presence); NotificationCenter hub; navigation listener leaks; AsyncStorage throttle keys (grow but negligible). PostHog session replay (unmasked since `fcbc8c0`) remains an unquantified lag *contributor* — telemetry will show it, not code reading.

## 3. Already implemented (Phase 0 — uncommitted, on `ohad`)

1. `MessageActionsMenu.tsx` — unconditional close callback + `closingRef` reset (kills the stuck invisible tap-catcher; separate bug, chat-screen freezes).
2. Focus-gating for chat channels — `DirectMessageScreen`, `DirectGroupChat`, `useMessageReactions` (buried chats no longer hold live channels; refocus re-runs `loadMessages` as catch-up).
3. Production `js_thread_stall` telemetry (PostHog, rate-limited: ≤1/30s, ≤10/session) with blocked_ms, channel census, route, root-stack depth — field freezes now self-diagnose.
4. Dev-only `📡 RT-CHANNELS` change-driven channel tracker.

## 4. Fix plan

### Phase 1 — query-cache pressure (UX-neutral, OTA-able)

| # | Change | Where | Notes |
|---|--------|-------|-------|
| 1.1 | Skip the 5-key invalidate burst on **first** focus (mount) — queries are already fetching fresh; run it only on **re**-focus (returning from a covered state), and throttle per tripId (e.g. 60s), mirroring the list-level catch-up throttle | `useTripRealtime.ts:37-55` | Removes 10 full-cache scans + refetch fan-out per trip open |
| 1.2 | Per-key `gcTime` for trip-detail queries (e.g. 5 min) so heavy sessions collect old trips | `useTripQueries.ts` | Global default stays 30 min |
| 1.3 | Replace `seedFromListCache`'s `getAll()` scan with direct `getQueryData` lookups of the known list keys | `useTripDetail.ts:49-77` | O(1) instead of O(cache) |
| 1.4 | Give viewability-prefetched details a short `gcTime` (e.g. 2 min) so scroll-past trips don't pin the cache | `TripsScreen.tsx` prefetch calls | Keeps the fast-open UX |

### Phase 2 — realtime hardening (UX-neutral, OTA-able)

| # | Change | Where | Notes |
|---|--------|-------|-------|
| 2.1 | Jittered `reconnectAfterMs` at client creation (covers socket reconnect AND per-channel rejoin — `RealtimeChannel.rejoinTimer` shares `socket.reconnectAfterMs`, verified) | `src/config/supabase.ts` | De-synchronizes rejoin bursts |
| 2.2+2.3 | ~~Unique topic suffix~~ **NOT POSSIBLE for Broadcast** — the topic IS the routing key the DB trigger sends to. Replaced by `acquireTopic()` registry in `tripsRealtime.ts`: 200ms linger-and-reuse on release (fast blur→refocus = zero join/leave traffic), join-settle guard (never remove mid-`joining`), serialized re-subscribe (new acquire awaits in-flight removal of the same topic) | `tripsRealtime.ts` + both trip hooks | Kills the same-topic `_remove` race and leave-before-join loops in one mechanism |
| 2.4 | Upgraded `@supabase/supabase-js` 2.80.0 → 2.110.7 (realtime-js 2.110.7) | package.json | Verified post-upgrade: `_remove` STILL filters by topic upstream — the registry defense remains required. Needs a device sanity pass (login/session restore, chat realtime) before shipping |

**Implementation notes (Phases 1–2, done 2026-07-18):**
- 1.1: catch-up invalidate burst in `useTripRealtime` now runs only on refocus-after-blur, or on first focus when the cached detail is older than 30s (`getQueryState` is O(1)). Freshness guarantees unchanged for the mounted case; first-open staleness bounded by the same 5-min `staleTime` as everywhere else.
- 1.2: `TRIP_DETAIL_GC_MS = 5min` on all five detail hooks (`useTripDetail.ts`).
- 1.3: `seedFromListCache` my-trips branch is a direct `getQueryData(tripsKeys.my(uid))` — the `getAll()` scan is gone.
- 1.4: viewport prefetch `gcTime: 2min`; press-in prefetches `TRIP_DETAIL_GC_MS`.
- Repo has ~172 standing tsc errors (edge functions + old screens) — none introduced by this work; all touched files compile clean.

### Phase 3 — structural (discuss before doing; potentially UX-visible)

| # | Change | UX impact to discuss |
|---|--------|----------------------|
| 3.1 | Root-stack dedup/cap (e.g. re-opening a trip already on the stack pops back to it instead of pushing a new copy) | Back-button history changes: back from a re-visited trip would NOT walk through the duplicate trail. Mitigates memory + listener load from 20-30-deep stacks |
| 3.2 | Consolidate per-entity channels into type-level Broadcast hubs (one `trips` channel, client-side filter) | None user-visible, but a larger refactor; aligns with the existing Broadcast migration direction |

### Behavior changes already introduced by Phase 0 (flagging, not asking)

- A chat buried under other cards no longer suppresses its own notification banners / unread badge (it's not on screen — arguably the correct behavior, and it fixes a known unread-badge bug).
- Returning to a buried chat re-runs `loadMessages()` — cached messages render instantly, then refresh; same path that already ran on reconnect.

## 5. Verification

- **Field:** watch the `js_thread_stall` PostHog event — `blocked_ms` distribution, `realtime_channels`, `root_stack_depth` at stall time. Phase 1/2 success = event rate drops and stalls stop correlating with depth/channels.
- **Dev:** repro script = open/close 20+ trips fast from Explore; `📡 RT-CHANNELS` should stay flat and state-clean (no `leaving`/`errored` residue); no `⚠️ PERF` lines.
- Compare one repro run with session replay off to size PostHog's contribution.
