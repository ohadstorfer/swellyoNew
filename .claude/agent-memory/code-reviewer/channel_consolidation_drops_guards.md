---
name: channel-consolidation-drops-guards
description: When multiple realtime subscriptions are merged into one shared hub/channel, defensive guards from the original handlers are easy to drop — check for them explicitly
metadata:
  type: project
---

Pattern seen 2026-07-04 reviewing the in-app-banner-overlay feature: `notificationsRealtimeHub.ts`
replaced two `notificationsService.subscribe()` call sites (badge + panel) with one shared
`postgres_changes` channel + in-memory listener fan-out. The original `subscribe()` handler guarded
every payload with `if (row?.id) handlers.onInsert?.(row)` before calling out; the new hub's INSERT/UPDATE
handlers call `listeners.forEach((l) => l.onInsert?.(row))` with no such guard — dropped silently during
the extraction. Real-world risk is low (a `postgres_changes` INSERT payload without an `id` is very
unlikely) but it's exactly the kind of small correctness detail that's easy to lose when consolidating
N call sites into 1, since nobody is diffing the new code against each of the N old ones line-by-line.

**Why:** caught by re-deriving the old `notificationsService.subscribe()` implementation and diffing its
body against the new hub rather than trusting the "handler bodies stay identical" framing in the spec —
the *outer* subscribe wrapper is what actually changed, not the inner handler bodies, and that's where the
guard lived.

**How to apply:** whenever a review involves consolidating multiple subscriptions/effects into one shared
module (hub, provider, singleton), find the ORIGINAL per-call-site code being replaced and diff it against
the new shared implementation line-by-line — don't just check that call sites were updated. Look
specifically for: null/shape guards on payloads, error handling around the callback, and any
per-call-site state (e.g. reconnect/backoff) that might get flattened into shared state incorrectly.
Related: [[notification-foreground-gate-pattern]].
