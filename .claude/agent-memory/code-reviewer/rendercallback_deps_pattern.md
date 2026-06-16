---
name: rendercallback-deps-pattern
description: TripDeck renderItem useCallback misses userId in deps — found during explore-infinite review
metadata:
  type: project
---

In `TripsScreen.tsx`, the `TripDeck` `renderItem` `useCallback` at line 666 captures `userId` from the closure (passed to `ExploreTripCard`) but its deps array is `[scrollX, meta, onOpenTrip]` — `userId` is missing. If `userId` changes after first render (session restore mid-mount) the prefetch closure inside the card sees the stale value.

**Why:** `userId` was added to the card prop (Task 9) after the `renderItem` callback was already written, and the deps were not updated.

**How to apply:** When a prop is added to a component rendered inside a `useCallback`, always check that the callback's deps array includes the new prop.
