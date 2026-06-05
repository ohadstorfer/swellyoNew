# Messaging Realtime: Before → After (handoff for realtime audit)

This documents how messaging realtime was migrated from Supabase `postgres_changes` to
DB-trigger **Broadcast**, so the same pattern can be audited/applied to other realtime
features in the app. Self-contained — no prior context needed.

## How it used to work (the `postgres_changes` pattern)

Messages were delivered by subscribing clients directly to Postgres row changes:

- **Per open chat:** a `messages:{conversationId}` channel with `postgres_changes`
  bindings (INSERT/UPDATE/DELETE) filtered `conversation_id=eq.{id}`.
- **Per user (conversation list):** a **batched** `postgres_changes` subscription on
  `messages` with `conversation_id=in.(...90 ids...)`, rebuilt when the id set changed.
- **New-conversation discovery:** `postgres_changes` on `conversation_members` filtered
  `user_id=eq.{me}`.

**Why it doesn't scale:** with `postgres_changes`, Supabase Realtime re-evaluates every
subscriber's filter **and RLS** for **every row change DB-wide**. Cost ≈
`connected_users × write_rate`. Channels per user grew with conversation count
(`ceil(N/90) + extras`).

## How it works now (DB-trigger Broadcast)

A Postgres `AFTER` trigger on `messages` calls `realtime.send(...)` to push each change to
**private Broadcast topics**:

- `messages:{conversationId}` — full row, for whoever has that chat open.
- `user-inbox:{userId}` — one compact event per member, for list/unread/new-conversation.

A second trigger on `conversation_members` broadcasts `member_added` to
`user-inbox:{userId}` (replaces the new-conversation `postgres_changes`).

Clients subscribe to those topics with `.on('broadcast', ...)` on **private channels**
(`{ config: { private: true } }`). Authorization is an RLS policy on `realtime.messages`
checked **once per subscription** (via `realtime.topic()` + `auth.uid()`), not
per-row-per-client. Channels per user drop to ~2 + open chats.

Relevant files:
- `supabase/migrations/20260605000000_messaging_broadcast_trigger.sql` — message trigger + RLS.
- `supabase/migrations/20260605000001_broadcast_new_conversation_member.sql` — new-conversation trigger.
- `src/services/messaging/realtimeMode.ts` — flag + topic-name helpers.
- `src/services/messaging/messagingService.ts` — broadcast bindings, `subscribeToUserInbox`, `inboxEventToIntent`.
- `src/context/MessagingProvider.tsx` — inbox wiring, mode gating.

## Key mechanisms / invariants

- **Token:** private channels need the realtime JWT; supabase-js ≥2.8 auto-syncs it
  (no manual `setAuth` needed).
- **Correctness backstop:** Broadcast is best-effort. Reliability comes from existing
  reconnect/foreground sync + `client_id` upsert dedup + a processed-message-id set.
  A dropped broadcast self-heals on next sync.
- **Don't reconcile via time-watermarks off a broadcast event.** A bug we hit: the inbox
  handler called `getConversationsUpdatedSince(lastSync)` (`updated_at > lastSync`) which
  raced the locally-tracked watermark and returned 0. Fix: the event carries the exact
  `conversation_id` → fetch **that** record by id, no watermark.
- **Trigger safety:** `SECURITY DEFINER`, pinned `search_path`, schema-qualified tables,
  each `realtime.send` wrapped in `exception when others` so a broadcast failure can never
  block the underlying insert.
- **Rollout:** gated behind a flag (`legacy | shadow | broadcast`); triggers are inert
  until a client subscribes, so they ship safely ahead of client code.

## What to look for elsewhere in the app (audit targets)

Search for `.channel(`, `postgres_changes`, `.subscribe(`, `.track(`. Flag any feature that:

1. Uses `postgres_changes` on a **high-write or multi-subscriber** table (DM-like fan-out)
   → candidate for trigger-Broadcast.
2. Opens **one channel per user/entity** that grows with usage (per-conversation, per-item)
   → candidate for a per-user topic + DB fan-out.
3. Uses **Presence** on a single global channel (O(N²)) → e.g. `presence:users`.
4. Reconciles realtime events via a **time/updated_at watermark** → replace with the id
   carried in the event.
5. Subscribes to a **private** topic but relies on manual token handling → verify
   supabase-js auto-sync covers it.

Lower priority (leave on `postgres_changes` unless hot): low-volume, per-user-filtered
subscriptions like notifications or join-decisions — cheap, not the fan-out problem.
