# Messaging Realtime: `postgres_changes` → Broadcast Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase `postgres_changes` realtime subscriptions in messaging with **database-triggered Broadcast**, so realtime cost stops scaling with `connected_users × DB_write_rate`.

**Architecture:** A Postgres `AFTER` trigger on `messages` calls `realtime.send()` to broadcast each change to two kinds of private topics: `messages:{conversationId}` (full row, for whoever has that chat open) and `user-inbox:{userId}` (compact event, for each member's conversation-list/unread badges). Clients subscribe to those topics via Broadcast instead of binding `postgres_changes`. Realtime Authorization (RLS on `realtime.messages`) gates who may subscribe — evaluated **once per subscription**, not once per message per client. The existing reconnect-sync + `client_id` dedup layer is the correctness backstop, so Broadcast only needs to be best-effort.

**Tech Stack:** React Native 0.81 / Expo 54, `@supabase/supabase-js` Realtime, Postgres triggers, Supabase Realtime Authorization (private channels + RLS on `realtime.messages`).

---

## Why this is safe to do incrementally

The realtime layer is **not** the source of truth for message delivery. Three existing mechanisms already guarantee no message loss independent of realtime:

1. **Send is durable + idempotent** — `sendMessage` upserts with `onConflict: 'sender_id,client_id'` (`messagingService.ts:812`), backed by a persistent AsyncStorage outbox flushed on reconnect/foreground/network-recovery (`messageOutbox.ts`, wired at `MessagingProvider.tsx:1585–1641`).
2. **Receive is deduped** — provider-level `lastProcessedMessageIds` (capped 1000, `MessagingProvider.tsx:828–839`) + reducer dedup `existingConv?.last_message?.id === message.id` (`MessagingProvider.tsx:52–55`).
3. **Gaps self-heal** — `handleReconnect` (`MessagingProvider.tsx:1019–1055`) runs `getConversationsUpdatedSince` on every SUBSCRIBED/foreground/network-recovery event and reconciles.

**Consequence:** if a Broadcast event is ever dropped, the next sync repairs state. This is why we can run Broadcast and `postgres_changes` side-by-side (shadow), then flip authority via a flag, with instant rollback — and never risk a lost message.

---

## Current state (what we're replacing) — exact references

| Path | Method | File:line | Topic(s) | Channels/user |
|---|---|---|---|---|
| Open chat | `subscribeToMessages` | `messagingService.ts:1585–1913` | `messages:{conversationId}` (already also carries `typing` + `read_receipt` **broadcast**) | 1 per open chat |
| Conversation list | `subscribeToConversationListUpdatesBatch` | `messagingService.ts:2085–2156` | `list:messages:batch:{seq}`, 3 `postgres_changes` bindings, chunked at 90 | `ceil(N/90)` |
| New conversation discovery | `subscribeToNewConversations` | `messagingService.ts:2523–2555` | `new_conversations:{userId}` | 1 |
| Singleton list channel | `subscribeToConversations` | `messagingService.ts` (caller `MessagingProvider.tsx:1308`) | `conversations_list` | 1 |

**Per-user channel count today:** `ceil(N/90) + 2 + (open chats) + reactions + presence`. After migration: `1 (user-inbox) + (open chats) + reactions + presence`.

**Already-Broadcast (do NOT touch):** `typing` and `read_receipt` events ride `messages:{conversationId}` via `channel.send(...)` (`messagingService.ts:1812–1871`, `1919–1975`). We reuse this same channel and add DB-broadcast message events to it.

**Non-realtime reads/writes to `messages`** (REST — all unchanged): `getMessages`, `getMessagesUpdatedSince`, `sendMessage`, `create*Message`/`update*Metadata`, `postSystemMessage`, `postCommitmentRequest`, `deleteMessage`, `editMessage`, `markAsRead`, `getUnreadCount`, `getConversationsUpdatedSince`. (Full table in research notes.)

---

## Target design

### Topics (both **private** → require Realtime Authorization)
- `messages:{conversationId}` — full message row + op. Subscribers: anyone with that chat open. Reuses the existing channel; keeps `typing`/`read_receipt`.
- `user-inbox:{userId}` — compact `{ conversation_id, message_id, op }`. Subscribers: that one user. Replaces the batch list subscription **and** `new_conversations`.

### Trigger fan-out (in the DB, small N = members per conversation)
On every `messages` INSERT/UPDATE/DELETE:
1. one `realtime.send(...)` to `messages:{conversation_id}` (full row),
2. one `realtime.send(...)` per member to `user-inbox:{member_id}` (compact).

### Feature flag (single env enum, instant rollback)
`EXPO_PUBLIC_MESSAGING_REALTIME` ∈ `legacy` (default) | `shadow` | `broadcast`.
- `legacy` — only `postgres_changes` (today's behavior).
- `shadow` — subscribe to Broadcast **in addition**; `postgres_changes` stays authoritative; log parity metrics. Zero user-visible change.
- `broadcast` — Broadcast authoritative; `postgres_changes` subscriptions not created.

---

## File Structure

**Create:**
- `supabase/migrations/20260605000000_messaging_broadcast_trigger.sql` — trigger fn + trigger + Realtime Authorization RLS policies.
- `src/services/messaging/realtimeMode.ts` — reads the env flag, exposes `getRealtimeMode()` + topic-name helpers (`conversationTopic`, `userInboxTopic`).
- `src/services/messaging/__tests__/realtimeMode.test.ts` — unit tests for flag parsing + topic helpers.
- `scripts/verify-broadcast.mjs` — standalone Node script that subscribes to a topic and prints received broadcasts (manual DB-trigger verification).
- `src/services/messaging/__tests__/inboxEvent.test.ts` — unit tests for the pure inbox-event → action mapping.

**Modify:**
- `src/services/messaging/messagingService.ts` — add Broadcast bindings to `getOrCreateConversationChannel`/`subscribeToMessages`; add `subscribeToUserInbox`; gate `postgres_changes` bindings behind mode.
- `src/context/MessagingProvider.tsx` — swap the batch+new-convos effects for `subscribeToUserInbox` when mode ≠ `legacy`; add shadow parity logging.
- `.env` / EAS env (documented, not committed) — add `EXPO_PUBLIC_MESSAGING_REALTIME`.

**Explicitly out of scope (do not change):** send path, outbox, reconnect sync, reducer dedup, reactions channel, presence service, notifications. Typing/read-receipt broadcast stays as-is.

---

## ⚠️ Gotchas baked into the tasks
- **SECURITY DEFINER search_path** — the trigger fn is `SECURITY DEFINER`; per the signup-trigger incident it **must** pin `set search_path = public, realtime` and schema-qualify every table (`public.conversation_members`). Unqualified tables here would break message inserts app-wide. (See memory: signup-trigger-search-path.)
- **Realtime Authorization must be enabled** on the project and `realtime.send` must exist (Phase 0 prerequisite check).
- **DELETE payloads are better, not worse** — the trigger sees the full `OLD` row, so `user-inbox`/`messages` DELETE events always carry `conversation_id` (the current `postgres_changes` DELETE guard at `messagingService.ts:2136` exists precisely because replica-identity DELETE payloads were partial).
- **Trigger failure must never block a send** — wrap each `realtime.send` loop body so a broadcast error cannot abort the `messages` INSERT transaction.
- **Ohad tests in Expo Go** — Realtime works in Expo Go, but verify there; no native module added here, so this is low-risk.

---

## Phase 0 — Prerequisites & DB trigger (no client change)

Broadcasts fire into topics with no subscribers yet → negligible cost, zero user impact. Fully reversible (drop trigger).

### Task 1: Confirm Realtime Authorization + `realtime.send` are available

**Files:** none (investigation).

- [ ] **Step 1: Check the realtime API exists**

Run (Supabase SQL editor or MCP):
```sql
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='realtime' and proname in ('send','broadcast_changes');
select 1 from pg_tables where schemaname='realtime' and tablename='messages';
```
Expected: `send` (and ideally `broadcast_changes`) present; `realtime.messages` table present. If absent, STOP — upgrade Realtime / enable Realtime Authorization before continuing.

- [ ] **Step 2: Confirm in the dashboard** that Realtime is enabled for the project and "Realtime Authorization" (private channels) is on. Record the result in the PR description.

### Task 2: Write the broadcast trigger function + trigger

**Files:**
- Create: `supabase/migrations/20260605000000_messaging_broadcast_trigger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Broadcast every messages change to per-conversation and per-member topics.
-- Replaces postgres_changes fan-out (which re-evaluates filter+RLS per client per row).
-- SECURITY DEFINER: pinned search_path + fully-qualified tables (see signup-trigger incident).

create or replace function public.broadcast_message_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_conversation_id uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  v_event text := case TG_OP
                    when 'INSERT' then 'new_message'
                    when 'UPDATE' then 'update_message'
                    else 'delete_message' end;
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_member record;
begin
  -- 1) Full row to the open-chat topic
  begin
    perform realtime.send(
      jsonb_build_object('op', TG_OP, 'message', v_row),
      v_event,
      'messages:' || v_conversation_id::text,
      true   -- private
    );
  exception when others then
    raise warning 'broadcast_message_change conversation topic failed: %', sqlerrm;
  end;

  -- 2) Compact event to every member's inbox topic
  for v_member in
    select cm.user_id
    from public.conversation_members cm
    where cm.conversation_id = v_conversation_id
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'conversation_id', v_conversation_id,
          'message_id', coalesce(NEW.id, OLD.id),
          'op', TG_OP
        ),
        'inbox_change',
        'user-inbox:' || v_member.user_id::text,
        true   -- private
      );
    exception when others then
      raise warning 'broadcast_message_change inbox topic failed for %: %', v_member.user_id, sqlerrm;
    end;
  end loop;

  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_broadcast_message_change on public.messages;
create trigger trg_broadcast_message_change
after insert or update or delete on public.messages
for each row execute function public.broadcast_message_change();
```

- [ ] **Step 2: Write the Realtime Authorization RLS policies (subscribe gating)**

Append to the same migration:
```sql
-- Authorize SUBSCRIBING to private topics. Evaluated once per subscription.
alter table realtime.messages enable row level security;

drop policy if exists "messaging: read conversation topic" on realtime.messages;
create policy "messaging: read conversation topic"
on realtime.messages for select to authenticated
using (
  (
    realtime.topic() like 'messages:%'
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
        and cm.user_id = auth.uid()
    )
  )
  or realtime.topic() = 'user-inbox:' || auth.uid()::text
);
```

- [ ] **Step 3: Apply the migration**

Apply via the same path you used for `idx_surfers_expo_push_token` (Supabase migration apply). Expected: success, no errors.

- [ ] **Step 4: Verify the trigger broadcasts** with the standalone script (Task 3) before any client work.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260605000000_messaging_broadcast_trigger.sql
git commit -m "feat(messaging): broadcast messages changes from DB trigger (no client change yet)"
```

### Task 3: Standalone verification script (proves the trigger works end-to-end)

**Files:**
- Create: `scripts/verify-broadcast.mjs`

- [ ] **Step 1: Write the script**

```js
// Usage: node scripts/verify-broadcast.mjs <conversationId> <jwt>
// Subscribes to messages:{conversationId} as a real authed user, prints broadcasts.
import { createClient } from '@supabase/supabase-js';

const [, , conversationId, jwt] = process.argv;
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${jwt}` } },
});
supabase.realtime.setAuth(jwt); // required for private channels

const ch = supabase
  .channel(`messages:${conversationId}`, { config: { private: true } })
  .on('broadcast', { event: 'new_message' }, (p) => console.log('NEW', JSON.stringify(p.payload)))
  .on('broadcast', { event: 'update_message' }, (p) => console.log('UPD', JSON.stringify(p.payload)))
  .on('broadcast', { event: 'delete_message' }, (p) => console.log('DEL', JSON.stringify(p.payload)))
  .subscribe((status) => console.log('status:', status));

process.on('SIGINT', () => { supabase.removeChannel(ch); process.exit(0); });
```

- [ ] **Step 2: Run it, then send a message in that conversation from the app.**

Run: `node scripts/verify-broadcast.mjs <realConversationId> <validUserJwt>`
Expected: `status: SUBSCRIBED`, then a `NEW {...}` line within ~1s of sending. If `status: CHANNEL_ERROR` → the RLS policy denied the subscribe (recheck Task 2 Step 2 / that the JWT user is a member).

- [ ] **Step 3: Negative test** — run with a `conversationId` the JWT user is NOT a member of. Expected: `CHANNEL_ERROR` / no events (RLS correctly blocks).

- [ ] **Step 4: Commit**
```bash
git add scripts/verify-broadcast.mjs
git commit -m "chore(messaging): add broadcast verification script"
```

---

## Phase 1 — Client plumbing + shadow mode (no behavior change)

### Task 4: Realtime mode flag + topic helpers (unit-tested)

**Files:**
- Create: `src/services/messaging/realtimeMode.ts`
- Test: `src/services/messaging/__tests__/realtimeMode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { getRealtimeMode, conversationTopic, userInboxTopic } from '../realtimeMode';

describe('realtimeMode', () => {
  const orig = process.env.EXPO_PUBLIC_MESSAGING_REALTIME;
  afterEach(() => { process.env.EXPO_PUBLIC_MESSAGING_REALTIME = orig; });

  it('defaults to legacy when unset', () => {
    delete process.env.EXPO_PUBLIC_MESSAGING_REALTIME;
    expect(getRealtimeMode()).toBe('legacy');
  });
  it('parses shadow and broadcast', () => {
    process.env.EXPO_PUBLIC_MESSAGING_REALTIME = 'shadow';
    expect(getRealtimeMode()).toBe('shadow');
    process.env.EXPO_PUBLIC_MESSAGING_REALTIME = 'broadcast';
    expect(getRealtimeMode()).toBe('broadcast');
  });
  it('falls back to legacy on garbage', () => {
    process.env.EXPO_PUBLIC_MESSAGING_REALTIME = 'nope';
    expect(getRealtimeMode()).toBe('legacy');
  });
  it('builds topic strings', () => {
    expect(conversationTopic('abc')).toBe('messages:abc');
    expect(userInboxTopic('u1')).toBe('user-inbox:u1');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/services/messaging/__tests__/realtimeMode.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type RealtimeMode = 'legacy' | 'shadow' | 'broadcast';

export function getRealtimeMode(): RealtimeMode {
  const v = process.env.EXPO_PUBLIC_MESSAGING_REALTIME;
  return v === 'shadow' || v === 'broadcast' ? v : 'legacy';
}
export const conversationTopic = (conversationId: string) => `messages:${conversationId}`;
export const userInboxTopic = (userId: string) => `user-inbox:${userId}`;
```

- [ ] **Step 4: Run tests, verify pass.** Run: `npx jest src/services/messaging/__tests__/realtimeMode.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/messaging/realtimeMode.ts src/services/messaging/__tests__/realtimeMode.test.ts
git commit -m "feat(messaging): realtime mode flag + topic helpers"
```

### Task 5: Enable private auth on the Realtime client

**Files:**
- Modify: wherever the Supabase client is created (search `createClient(` — likely `src/services/supabase*.ts` or `src/lib/supabase.ts`).

- [ ] **Step 1: Locate client creation.** Run: `grep -rn "createClient(" src/ | grep -i supabase`

- [ ] **Step 2: Ensure the realtime auth token is set after sign-in.** Private channels require the JWT on the realtime socket. Add (once, where the session is known / on `onAuthStateChange`):
```ts
// after a session is available:
supabase.realtime.setAuth(session.access_token);
```
This is **additive and harmless in `legacy` mode** (no private channels are opened yet).

- [ ] **Step 3: Verify the app still boots and existing messaging works** (mode still `legacy`). Two accounts, send a message both ways — unchanged.

- [ ] **Step 4: Commit**
```bash
git commit -am "feat(messaging): set realtime auth token for private channels"
```

### Task 6: Add Broadcast bindings to the per-conversation channel (shadow)

**Files:**
- Modify: `src/services/messaging/messagingService.ts` (`getOrCreateConversationChannel` ~`:265`, `subscribeToMessages` `:1585–1913`)

- [ ] **Step 1: Make the conversation channel private when mode ≠ legacy.**
In `getOrCreateConversationChannel`, build the channel with `{ config: { private: getRealtimeMode() !== 'legacy' } }`. (Typing/read-receipt broadcast keeps working on a private channel.)

- [ ] **Step 2: Register Broadcast message handlers alongside the existing `postgres_changes` bindings.**
Inside `subscribeToMessages`, after the existing bindings, add:
```ts
const mode = getRealtimeMode();
if (mode !== 'legacy') {
  channel
    .on('broadcast', { event: 'new_message' }, ({ payload }) =>
      this.handleBroadcastMessage(conversationId, payload, 'INSERT', callbacks, mode))
    .on('broadcast', { event: 'update_message' }, ({ payload }) =>
      this.handleBroadcastMessage(conversationId, payload, 'UPDATE', callbacks, mode))
    .on('broadcast', { event: 'delete_message' }, ({ payload }) =>
      this.handleBroadcastMessage(conversationId, payload, 'DELETE', callbacks, mode));
}
```

- [ ] **Step 3: Implement `handleBroadcastMessage`** — reuse the SAME enrichment/callback logic the `postgres_changes` handlers use (`onNewMessage`/`onMessageUpdated`/`onMessageDeleted`). In `shadow` mode it still calls callbacks, but the provider's `lastProcessedMessageIds` dedup (Task 8) ensures the duplicate (one from pg_changes, one from broadcast) collapses to a single dispatch — so shadow is observably identical to legacy. Payload shape: `payload.message` is the full row, `payload.op` the operation.

- [ ] **Step 4: Gate the `postgres_changes` message bindings** so they are skipped when `mode === 'broadcast'` (kept for `legacy` and `shadow`). Wrap the three `.on('postgres_changes', … messages …)` registrations in `if (mode !== 'broadcast') { … }`.

- [ ] **Step 5: Verify in `shadow`.** Set `EXPO_PUBLIC_MESSAGING_REALTIME=shadow`, two accounts, open the same chat on both. Send messages. Expected: each message appears **exactly once** (dedup working), typing still works. Watch logs for the parity counter (Task 8).

- [ ] **Step 6: Commit**
```bash
git commit -am "feat(messaging): broadcast bindings on conversation channel (shadow-capable)"
```

### Task 7: `subscribeToUserInbox` — replaces batch list + new-convos

**Files:**
- Modify: `src/services/messaging/messagingService.ts` (new method near `subscribeToNewConversations` `:2523`)
- Create: `src/services/messaging/__tests__/inboxEvent.test.ts`

- [ ] **Step 1: Write the failing test for the pure event→intent mapper.**

```ts
import { inboxEventToIntent } from '../messagingService';

describe('inboxEventToIntent', () => {
  it('maps new_message op to a refresh-conversation intent', () => {
    expect(inboxEventToIntent({ conversation_id: 'c1', message_id: 'm1', op: 'INSERT' }))
      .toEqual({ kind: 'touch', conversationId: 'c1', messageId: 'm1' });
  });
  it('maps DELETE op to a touch intent too (list may need last-message recompute)', () => {
    expect(inboxEventToIntent({ conversation_id: 'c1', message_id: 'm9', op: 'DELETE' }))
      .toEqual({ kind: 'touch', conversationId: 'c1', messageId: 'm9' });
  });
  it('returns null on malformed payload', () => {
    expect(inboxEventToIntent({} as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `npx jest src/services/messaging/__tests__/inboxEvent.test.ts` → FAIL.

- [ ] **Step 3: Implement the pure mapper + the subscription.**

```ts
export type InboxEvent = { conversation_id: string; message_id: string; op: 'INSERT'|'UPDATE'|'DELETE' };
export type InboxIntent = { kind: 'touch'; conversationId: string; messageId: string };

export function inboxEventToIntent(e: InboxEvent): InboxIntent | null {
  if (!e || !e.conversation_id || !e.message_id) return null;
  return { kind: 'touch', conversationId: e.conversation_id, messageId: e.message_id };
}
```
```ts
// method on the service:
subscribeToUserInbox(userId: string, onInbox: (intent: InboxIntent) => void): () => void {
  const channel = supabase.channel(userInboxTopic(userId), { config: { private: true } })
    .on('broadcast', { event: 'inbox_change' }, ({ payload }) => {
      const intent = inboxEventToIntent(payload as InboxEvent);
      if (intent) onInbox(intent);
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
```

- [ ] **Step 4: Run tests, verify pass.** → PASS.

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(messaging): subscribeToUserInbox + inbox event mapper"
```

### Task 8: Wire provider for shadow + parity metric

**Files:**
- Modify: `src/context/MessagingProvider.tsx` (batch effect `:1201–1246`, new-convos `:1265–1268`, dedup `:828–839`)

- [ ] **Step 1: Add a parity counter.** When mode === `shadow`, track per message id which source delivered it first (`pg` vs `bc`) using the existing `lastProcessedMessageIds` choke point. Log a rolling summary every ~30s: `{ both, pgOnly, bcOnly, bcFirstPct }`. `bcOnly === 0` and `both` ≈ total is the cutover gate.

- [ ] **Step 2: Add the inbox subscription** (mode ≠ legacy), translating `InboxIntent.touch` into the SAME provider reaction the batch `onNewMessage` currently triggers (mark conversation updated → `getConversationsUpdatedSince` / enrich), reusing existing handlers — do not invent new state flow.

- [ ] **Step 3: Gate the legacy list effects** so the batch subscription (`:1201–1246`) and `subscribeToNewConversations` (`:1265–1268`) are **only** created when `mode === 'legacy'` or `mode === 'shadow'`; in `broadcast` mode only the inbox subscription runs.

- [ ] **Step 4: Verify `shadow` parity.** Run two accounts on `shadow` for a real session: open chats, background/foreground, send/edit/delete, add a brand-new conversation. Expected: UI identical to legacy; parity log shows `bcOnly: 0` and `both` climbing. Let it soak (ideally a few days / multiple users) before Phase 2.

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(messaging): provider shadow wiring + broadcast/pg parity metric"
```

---

## Phase 2 — Cutover (flag flip, instant rollback)

### Task 9: Flip to `broadcast` and validate

**Files:** env only (`EXPO_PUBLIC_MESSAGING_REALTIME=broadcast`).

- [ ] **Step 1: Pre-flight gate.** Confirm from Phase-1 soak: `bcOnly === 0` across the sample, broadcast latency ≈ pg latency, no `CHANNEL_ERROR` spikes. If not, stay in shadow and fix first.
- [ ] **Step 2: Set `broadcast` for an internal build** (Ohad + test accounts). Verify: messages, edits, deletes, typing, read receipts, NEW conversation appears live, unread badges update, reconnect after airplane-mode still reconciles. Confirm channel count dropped (no `list:messages:batch:*`, no `new_conversations:*`).
- [ ] **Step 3: Roll out gradually** (staged EAS env / % of users if available). Watch Sentry + the in-app logs for `CHANNEL_ERROR` and missed-message reports.
- [ ] **Step 4: Rollback path documented:** set `EXPO_PUBLIC_MESSAGING_REALTIME=shadow` (or `legacy`) and ship — code for both paths still present, no DB change needed (trigger is harmless in any mode).
- [ ] **Step 5: Commit** any env/doc changes.

---

## Phase 3 — Cleanup (only after `broadcast` is stable in prod)

### Task 10: Remove dead `postgres_changes` paths

**Files:** `src/services/messaging/messagingService.ts`, `src/context/MessagingProvider.tsx`

- [ ] **Step 1:** Delete `subscribeToConversationListUpdatesBatch` (`:2085–2156`), `teardownListBatchChannels` (`:2158–2167`), the dead `subscribeToConversationListUpdates` (`:1991`), and `subscribeToNewConversations` (`:2523–2555`) once nothing references them.
- [ ] **Step 2:** Remove the three `postgres_changes` message bindings in `subscribeToMessages` and the `mode !== 'broadcast'` guards (broadcast is now the only path). Keep typing/read-receipt.
- [ ] **Step 3:** Drop the now-unconditional UPDATE re-fetch (`:1700`) **only after** confirming the trigger payload always carries full `image_metadata`/`video_metadata` (the metadata `update*Metadata` write itself fires a broadcast with the complete row). Verify image/video messages still render after upload, then remove.
- [ ] **Step 4:** Remove the parity-metric scaffolding and the `legacy`/`shadow` branches; collapse the flag to a kill-switch or delete it per preference.
- [ ] **Step 5: Run the test suite.** `npx jest src/services/messaging` → PASS. Commit.

---

## Self-Review (done against the research map)

- **Coverage:** open-chat path → Tasks 2/6; list+unread path → Tasks 2/7/8; new-conversation discovery → folded into `user-inbox` (Task 7/8); typing/read-receipt → untouched (verified Tasks 6/9); send/outbox/reconnect/dedup → untouched backstop (stated up front).
- **Reversibility:** trigger is inert without subscribers (Phase 0); flag gives instant rollback with both code paths live (Phase 2); cleanup deferred to Phase 3.
- **Type consistency:** `RealtimeMode`, `InboxEvent`, `InboxIntent`, `conversationTopic`/`userInboxTopic`, `inboxEventToIntent`, `subscribeToUserInbox`, `handleBroadcastMessage` used consistently across Tasks 4–10.
- **Known limitation flagged:** Broadcast is best-effort; correctness depends on the existing reconnect-sync backstop staying intact — Task list forbids touching it.
- **Honest testing note:** realtime delivery itself can't be Jest-unit-tested; pure logic (flag, topic helpers, event mapper) is unit-tested (Tasks 4,7), DB trigger is verified by a real-subscription script (Task 3), and end-to-end is a defined two-account manual protocol (Tasks 6,8,9) plus a multi-day shadow soak with a parity metric before any user sees a change.
