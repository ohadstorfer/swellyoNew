---
name: supabase-realtime-scaling
description: Supabase Realtime postgres_changes scaling — in filter syntax, channel limits, binding limits, CHANNEL_ERROR causes, broadcast_changes migration path
metadata:
  type: reference
---

## in filter — confirmed supported

Syntax: `filter: 'conversation_id=in.(uuid1,uuid2,uuid3)'`
- Bare UUIDs, no quotes needed inside the parentheses
- Spaces after commas are tolerated (server strips them)
- Hard limit: **100 values maximum** (Supabase docs explicit)
- Uses Postgres `= ANY` under the hood
- Available in current supabase-js v2 / realtime-js (was merged ~Feb 2023; confirmed live in 2025 docs)

## Channel and binding limits (hard numbers)

- **100 channels per client connection** (Free/Pro/Team) — `too_many_channels` error if exceeded
- No documented hard limit on postgres_changes bindings *per channel*, but single-thread processing means adding bindings degrades all
- Filter string length: **not documented**, no enforced byte cap found

## 60 UUIDs in one in() filter

- 60 UUIDs = ~60 × 36 chars + overhead = ~2.2 KB filter string
- Within the 100-value hard limit — technically safe
- No documented filter string byte limit found after exhaustive search

## CHANNEL_ERROR with undefined error object

- Documented behavior: `phx_error` carries **an empty object** as payload — this is by protocol spec, not a bug
- Main known cause: "mismatch between server and client bindings" — binding IDs on server and client diverged during reconnect/rejoin
- Also caused by: RLS policy check failures (returns "You do not have permissions"), network drops, mobile power-saving, background tabs
- Rapid remove+create on same topic: known race — removeChannel() is async, subscribe() is not; if subscribe() fires before removal completes → duplicate topic → CHANNEL_ERROR
- Socket overload (180 bindings across 60 channels): single-thread bottleneck, not a specific error code, manifests as cascading CHANNEL_ERROR as the socket falls behind

## broadcast_changes() — the official scale path

- Uses a WAL replication slot against `realtime.messages` table
- Client subscribes to per-conversation topics: `topic:{conversation_id}` (private channel)
- No per-change RLS read check (unlike postgres_changes which does N reads for N subscribers)
- Requires: DB trigger calling `realtime.broadcast_changes()`, RLS policy on `realtime.messages`, Realtime Authorization setup
- Official Supabase statement: "We recommend using Broadcast for most use cases"
- More setup complexity; not compatible with Expo Go unless polyfilled

## Recommended architecture for 60+ conversation chat

Option A (short-term): Single channel, `in.(uuids)` filter, max 100 UUIDs, rebuild channel when conversations list changes — safe but rebuilding channel = ~500ms gap
Option B (long-term): `broadcast_changes()` trigger per-conversation topic — one subscription per conversation but through Broadcast (lower DB overhead, scales to 1000s of users)

**Sources:**
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://supabase.com/docs/guides/realtime/limits
- https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- https://supabase.com/blog/realtime-broadcast-from-database
- https://supabase.com/docs/guides/realtime/protocol
- https://github.com/supabase/realtime/issues/843 (too_many_channels 100 limit)
- https://github.com/supabase/realtime/issues/1414 (CHANNEL_ERROR undefined after hours)
