# Spec — Message Reactions: postgres_changes → Broadcast

**Date:** 2026-06-04
**Author:** Ohad (via realtime audit)
**Status:** Done. DB migration applied to prod; client hardcoded to broadcast and the `EXPO_PUBLIC_REACTIONS_REALTIME` flag REMOVED after verification (see §4.4). The flag-gating described below is historical — kept for context.
**Related:** `docs/superpowers/plans/2026-06-04-messaging-broadcast-migration.md`, `docs/realtime-broadcast-pattern.md`

---

## 1. Problem

`src/hooks/useMessageReactions.ts` subscribes to realtime reactions with **no server-side filter**:

```ts
.channel(`message-reactions-${conversationId}`)
.on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, ...)  // no `filter`
```

Every client with a chat open receives **every reaction change across the entire app**, then discards almost all of it client-side via `messageIdsRef.current.has(messageId)`. The Supabase Realtime server still RLS-checks each row for each subscriber — so cost ≈ `clients_with_open_chat × reaction_write_rate_DB_wide`. This is the same fan-out the messages migration is removing, and worse, because it isn't even filtered.

The hook's own comment claims an extra filter would be "redundant" because RLS restricts visibility. That's correct about **security** and wrong about **cost** — RLS scoping does not reduce the per-row-per-client server work; it *is* the per-row-per-client server work.

`message_reactions` columns: `(message_id, user_id, reaction, reacted_at)` — **no `conversation_id`**, so a cheap `filter: conversation_id=eq.X` is not available. A trigger→Broadcast migration (the pattern already built for `messages`) is the natural fix.

## 2. Goal

Move reaction-change delivery off unfiltered `postgres_changes` and onto a **DB-trigger → private Broadcast topic**, scoped per conversation, gated behind the existing realtime flag, with no change to reaction *correctness* (still refetch-on-event).

## 3. Non-goals

- No change to the optimistic-update / aggregation logic in `useMessageReactions` (`optimisticApply`, `aggregateReactions`, `fetchReactionsForMessages`). Only the **transport** changes.
- No change to the messages migration itself (it stays mid-flight, shadow-soak pending). This must not touch the hot `subscribeToMessages` path.
- Not shipping reaction payloads over the wire — the client keeps refetching the affected message's reactions (simple, already correct, idempotent).

## 4. Design

### 4.1 Transport: separate private topic `reactions:{conversationId}`

Two options were considered:

| | A — reuse `messages:{conversationId}` channel | B — new `reactions:{conversationId}` topic *(chosen)* |
|---|---|---|
| Channels per open chat | 1 (reclaims the reaction channel) | 2 (reaction channel stays, but now private+scoped) |
| RLS | none needed (existing `messages:%` policy covers it) | one tiny new policy for `reactions:%` |
| Coupling | couples reactions into `subscribeToMessages` callbacks — touches the hot path mid-migration | self-contained in `useMessageReactions`; zero blast radius on the messages migration |
| Risk while messages migration is in flight | higher | lower |

**Chosen: B.** The dominant cost is the unfiltered DB-wide fan-out, which B eliminates completely. The extra channel per open chat is bounded (you have one/few chats open) and minor next to that. B keeps the change fully inside the hook and out of the in-flight `subscribeToMessages` path. Reclaiming the channel slot by folding reactions into the `messages` topic is a documented **future optimization** (§8), to be done after the messages migration reaches `broadcast` and stabilizes.

### 4.2 Database — trigger + RLS

New migration `supabase/migrations/20260606000000_reactions_broadcast_trigger.sql` (bump timestamp to land after the existing messaging migrations). Mirrors `broadcast_message_change` exactly for safety (SECURITY DEFINER, pinned `search_path`, fully-qualified tables, every `realtime.send` wrapped).

```sql
-- Reactions realtime: Broadcast from the database.
-- AFTER trigger on public.message_reactions resolves the parent message's
-- conversation_id and broadcasts a compact event to the PRIVATE topic
--   reactions:{conversation_id}
-- Payload is just { op, message_id } — the client refetches that message's
-- reactions on receipt (idempotent), so we never ship reaction rows.
-- INERT until a client subscribes. Fully reversible (see ROLLBACK).

create or replace function public.broadcast_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_message_id uuid := coalesce(NEW.message_id, OLD.message_id);
  v_conversation_id uuid;
begin
  select m.conversation_id into v_conversation_id
  from public.messages m
  where m.id = v_message_id;

  -- Parent message gone (e.g. cascade delete) — the message-delete broadcast
  -- already removes the message and its reactions on the client. Skip.
  if v_conversation_id is null then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('op', TG_OP, 'message_id', v_message_id),
      'reaction_changed',
      'reactions:' || v_conversation_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_reaction_change failed for message %: %', v_message_id, sqlerrm;
  end;

  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_broadcast_reaction_change on public.message_reactions;
create trigger trg_broadcast_reaction_change
after insert or update or delete on public.message_reactions
for each row execute function public.broadcast_reaction_change();

-- Authorization: who may SUBSCRIBE to reactions:{conversation_id}.
-- Evaluated ONCE per subscription. Same membership check as the messages topic.
-- (realtime.messages RLS is already enabled by the messaging migration.)
drop policy if exists "reactions: read conversation topic" on realtime.messages;
create policy "reactions: read conversation topic"
on realtime.messages for select to authenticated
using (
  realtime.topic() like 'reactions:%'
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
      and cm.user_id = auth.uid()
  )
);

-- ROLLBACK:
--   drop trigger if exists trg_broadcast_reaction_change on public.message_reactions;
--   drop function if exists public.broadcast_reaction_change();
--   drop policy if exists "reactions: read conversation topic" on realtime.messages;
```

Notes:
- `message_reactions` is tiny / very low write volume, so the extra `SELECT messages` per reaction write is negligible. Index already exists (`message_reactions.message_id` FK).
- The trigger is **inert until subscribed** — with no subscriber it only writes a row to `realtime.messages` per reaction change. Safe to ship ahead of the client, exactly like Phase 0 of the messages migration.

### 4.3 Client — `useMessageReactions.ts`

The realtime `useEffect` (currently lines ~97–119) becomes mode-aware, mirroring `getOrCreateConversationChannel`:

- `getRealtimeMode()` from `src/services/messaging/realtimeMode.ts`.
- Add a topic helper `reactionsTopic(conversationId) = ` ``reactions:${conversationId}`` to `realtimeMode.ts`.
- **`legacy`** → unchanged: current unfiltered `postgres_changes` channel.
- **`shadow`** → register **both** the legacy `postgres_changes` binding **and** the broadcast listener. Safe with no dedup needed because both paths call the same idempotent `refreshOne(messageId)` (refetch). This proves parity.
- **`broadcast`** → only the private broadcast channel:

```ts
const channel = supabase
  .channel(reactionsTopic(conversationId), { config: { private: true } })
  .on('broadcast', { event: 'reaction_changed' }, ({ payload }) => {
    const messageId = payload?.message_id as string | undefined;
    if (!messageId) return;
    if (!messageIdsRef.current.has(messageId)) return; // not in this chat's window
    refreshOne(messageId).catch(err =>
      console.warn('[useMessageReactions] refreshOne failed', err),
    );
  })
  .subscribe();
```

The `messageIdsRef` guard stays (the topic is per-conversation, but the chat may only have a window of messages loaded). `refreshOne` is unchanged.

### 4.4 Flag — dedicated `EXPO_PUBLIC_REACTIONS_REALTIME`

**Decision: a dedicated flag, NOT reuse of `EXPO_PUBLIC_MESSAGING_REALTIME`.**

Same `legacy | shadow | broadcast` shape, parsed by a new `getReactionsRealtimeMode()` in `realtimeMode.ts`. Rationale: the messages migration is mid-soak on its own timeline; a shared flag would force reactions to `broadcast` exactly when messages flips, making it impossible to soak or roll back reactions independently. Reactions use a separate channel/topic, so there is no technical reason to couple them. One extra env var buys independent rollout + rollback. (Confirmed: `.env` already runs messages at `broadcast` locally while prod default is `legacy` — exactly the timing mismatch that makes a shared flag wrong.)

Default (unset) = `legacy`, so this is a no-op until explicitly enabled. Add `EXPO_PUBLIC_REACTIONS_REALTIME` to `PRE_BUILD_CHECKLIST` env hygiene.

## 5. Files touched

| File | Change |
|---|---|
| `supabase/migrations/20260606000000_reactions_broadcast_trigger.sql` | **new** — trigger + function + RLS policy (§4.2). Slot confirmed free (latest was `20260605000001`). |
| `src/services/messaging/realtimeMode.ts` | add `reactionsTopic()` helper + `getReactionsRealtimeMode()` (§4.4) |
| `src/hooks/useMessageReactions.ts` | mode-aware realtime effect (§4.3); replaced the misleading "filter is redundant" comment |

No screen changes (`DirectMessageScreen`, `DirectGroupChat` consume the hook unchanged). No `messagingService.ts` / `subscribeToMessages` changes.

## 6. Acceptance criteria

1. **`legacy`** (default): behaviour byte-for-byte identical to today.
2. **`broadcast`**: adding/removing a reaction in chat A updates the other member's view in chat A within realtime latency, and produces **zero** realtime traffic to clients whose open chat is a different conversation (verify: a client in chat B sees no `reaction_changed` event when chat A gets a reaction).
3. **`shadow`**: both transports fire; UI shows each reaction exactly once (idempotent refetch), no flicker/double-count.
4. A non-member cannot subscribe to `reactions:{conversationId}` (RLS denies — verify the subscribe callback returns `CHANNEL_ERROR`/closed).
5. Reacting still works when realtime is down (optimistic apply + DB write unaffected; peers self-heal on next open/refresh).
6. Deleting a message with reactions does not error in the trigger (conversation lookup returns null → skip).

## 7. Rollout & verification

1. Apply the migration to prod (inert — no subscribers on `reactions:%` yet). Confirm via `mcp__supabase__get_advisors` (security) that the new SECURITY DEFINER function trips no new warning beyond the existing messaging trigger.
2. Ship client with flag still `legacy` (or current value) → no behaviour change.
3. Flip a dev/local client to `shadow`, watch parity (reactions appear once, both paths log).
4. Flip to `broadcast`, run the cross-conversation isolation check (criterion 2) with two devices/sims.
5. Extend `scripts/verify-broadcast.mjs` (already exists for messages) with a reactions case if practical, else manual two-device check.

## 8. Future optimization (not in this spec)

Once the messages migration is fully on `broadcast` and stable, fold reaction delivery into the existing `messages:{conversationId}` private channel (Option A): add `onReactionChanged` to `MessageSubscriptionCallbacks`, emit `reaction_changed` on the `messages:` topic from the trigger, drop the separate `reactions:` channel + its RLS policy. Reclaims one channel per open chat. Deferred to avoid touching the hot subscribe path mid-migration.

## 9. Resolved decisions

1. **Flag granularity** → **dedicated `EXPO_PUBLIC_REACTIONS_REALTIME`** (§4.4). Independent rollout/rollback wins over one-fewer-env-var, given the messages soak timing mismatch.
2. **Migration timestamp** → **`20260606000000`**, confirmed free (latest applied/pending was `20260605000001`).
3. **Keep `shadow`?** → **Yes.** Near-zero cost, and it specifically validates that the private-channel RLS lets members subscribe before the `postgres_changes` fallback is removed — the real risk in this change.

## 10. Remaining manual step

The migration file is created but **NOT applied to prod** — applying migrations is gated by `PRE_BUILD_CHECKLIST.md`. Apply it (inert, no subscribers yet), then roll the client flag `legacy → shadow → broadcast` per §7.
