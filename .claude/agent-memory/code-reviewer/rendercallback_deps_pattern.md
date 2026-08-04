---
name: rendercallback-deps-pattern
description: Recurring bug in this repo — a useCallback gains a new closure variable but its deps array is not updated (TripDeck renderItem, CreateTripFlowA validateStep)
metadata:
  type: project
---

Stale-closure bugs from un-updated `useCallback` deps keep recurring in this repo. Two confirmed instances:

- `TripsScreen.tsx` `TripDeck` `renderItem` (~line 666) captures `userId` but deps are `[scrollX, meta, onOpenTrip]`.
- `CreateTripFlowA.tsx` `validateStep` (deps ~line 1794) reads `stripeReady` (added in the Stripe-payments task) but `stripeReady` is not in the deps. `state` is in the deps and changes on every keystroke, which masks it — the bug only bites when the async value flips *after* the last state change and the user taps Next without typing anything.

**Why:** the variable is added to the callback body in a later task; nobody re-reads the deps array at the bottom of a 100-line `useCallback`. There is no `react-hooks/exhaustive-deps` enforcement failing the build.

**How to apply:** on any diff that adds a read of component state/props inside an existing `useCallback`/`useMemo`, scroll to the deps array and confirm it was updated. Pay special attention to async-set state (fetch results, subscription callbacks) — those flip without a re-render of the deps.
