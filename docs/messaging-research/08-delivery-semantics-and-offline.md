# 08 — Delivery Semantics and Offline Handling

Message ordering, delivery guarantees, idempotency, the offline outbox, and the sent/delivered/read state machine.

---

## Message Ordering

### The problem

Distributed systems have no global clock. Two clients can send messages at the "same time" (by their local clocks) and those messages can arrive at the server in different orders. Which one appears first in the conversation?

### Three ordering strategies

**1. Server-assigned sequence numbers (per-conversation):**
The server assigns a monotonically increasing sequence number to each message at the moment it is stored. Clients display messages in sequence-number order.
- Used by: Slack (message timestamps are the ordering key), iMessage (APNs delivery order).
- Pros: Simple. Deterministic. The server is the authority.
- Cons: Clients cannot pre-assign IDs; the client must wait for server confirmation before displaying in the correct position. Requires strong consistency on the write path (can't assign sequence numbers in a distributed database without coordination).

**2. Client-generated time-ordered IDs (Snowflake):**
Clients generate IDs locally (Snowflake format: ms timestamp + worker ID + sequence). Server uses these as the ordering key.
- Used by: Discord, Twitter.
- Pros: Client can display the message immediately in the "correct" position without waiting for server round-trip.
- Cons: Requires synchronized clocks (NTP). Messages from clients with skewed clocks appear in wrong positions. In practice, ~1–2 second clock skew is tolerable.

**3. Causal ordering (vector clocks / logical clocks):**
Tracks which messages a sender had seen when they sent their message. "Alice's message 5 was sent knowing about Bob's message 3" — so Alice's message 5 causally follows Bob's message 3.
- Used by: Matrix (as DAG of events in a room).
- Pros: Handles the "Bob replied before he could have seen Alice's edit" problem correctly.
- Cons: Much more complex to implement and display. Most consumer apps don't use this; they accept occasional visual weirdness.

**For Supabase-backed Swellyo:** Use server-assigned timestamps (`created_at TIMESTAMPTZ DEFAULT now()`) as the ordering key. This is simple and deterministic. For concurrent inserts in the same millisecond, break ties by message `id` (BIGSERIAL). Clients sort by `(created_at, id)`.

---

## Delivery Guarantees

### At-most-once
Message is sent once. If it fails, it is lost. No retry.
- Where used: Supabase Realtime Broadcast, UDP-based transports, fire-and-forget notifications.
- Acceptable for: ephemeral events (typing indicators, presence).

### At-least-once
Message is retried until the sender receives acknowledgment. The recipient may receive duplicates.
- Where used: Essentially every chat app (retried until server ACK).
- Requires idempotency on the receiver side.

### Exactly-once
Message delivered exactly once — no loss, no duplication. Theoretically possible but expensive (requires two-phase commit or idempotency + dedup on every hop).
- Used for: financial transactions. Not typically used in chat (too expensive).
- Most chat apps approximate exactly-once by combining at-least-once delivery with idempotent message insertion.

---

## Idempotency via Client-Generated Message IDs

**The pattern:** The client generates a UUID for each message before sending. The server uses this as an idempotency key — if the same UUID is inserted twice, only one row is stored (enforce with a `UNIQUE` constraint on the client-generated ID column).

```sql
ALTER TABLE messages ADD COLUMN client_id UUID UNIQUE;
```

Client flow:
1. Generate `client_id = uuid()` locally.
2. Display the message in the UI immediately (optimistic update) with status "sending".
3. Send to server: `INSERT INTO messages (client_id, content, ...) ON CONFLICT (client_id) DO NOTHING`.
4. If the request fails (network error), retry with the same `client_id`.
5. On success, update the UI status to "sent".

This makes the send operation safe to retry: retrying with the same `client_id` is a no-op if the first attempt succeeded. The server responds with the server-assigned `id` and `created_at`, which the client stores to replace the optimistic row.

---

## The Offline Outbox Pattern

When the device has no network, the app should not silently swallow messages. The outbox pattern:

1. **Write to local outbox first:** When the user taps send, write the message to a local queue (AsyncStorage, SQLite, or in-memory) with status `pending`.
2. **Display immediately** in the UI (optimistic UI).
3. **When network becomes available** (use `NetInfo` from `@react-native-community/netinfo`), flush the outbox — send pending messages in order.
4. **On server ACK**, mark as `sent`. On permanent failure (4xx), mark as `failed` and show an error.

**Implementation considerations:**
- The outbox must survive app restarts: use persistent storage (SQLite/AsyncStorage), not just React state.
- Send in order: messages in the same conversation must be sent sequentially. If message 3 sends before message 2, the display order may be wrong (even with server timestamps, the user typed them in order).
- Conflict resolution on reconnect: if the user is offline for hours and sends 20 messages, the outbox should batch-send them. Each must carry the same `client_id` so retries are idempotent.

---

## WhatsApp's Store-and-Forward Model

WhatsApp's server is a relay, not a store. The lifecycle:

```
Alice sends → server stores (ephemeral) → tries to deliver to Bob
If Bob online: deliver immediately → server deletes message → sends ACK to Alice
If Bob offline: server holds message (up to 30 days) → delivers when Bob reconnects
```

**Three-tick system (the iconic UI):**
1. One grey tick: message received by the WhatsApp server. Server has it and will attempt delivery.
2. Two grey ticks: message delivered to Bob's device(s). His app received it.
3. Two blue ticks: Bob's app displayed the message to him (read receipt). Bob's device sends a read event.

These three states correspond to three ACKs that travel in the protocol:
- Client → Server ACK (server confirms receipt)
- Server → Alice's client ACK (delivery confirmed to Bob's device)
- Bob's device → Server, then Server → Alice's client (read confirmed)

**Clock skew:** WhatsApp uses server-assigned timestamps for the ordering key. Client clocks are not trusted for message ordering.

---

## Handling Very Long Offline Periods

When a device reconnects after days or weeks offline:

1. **Server-queued messages:** WhatsApp holds messages up to 30 days. If Bob is offline for 31 days, his messages are gone (he gets a notification that messages were missed). Signal holds messages until delivery with no stated expiry (but they do enforce retention for E2EE attachments at 45 days).

2. **Pagination and catch-up:** A reconnecting client should not try to load all missed messages at once. Paginate: fetch the last N messages per conversation, mark conversations with unread counts, let the user browse from there.

3. **Sequence gaps:** If your system uses sequence numbers, a reconnecting client can detect gaps (`last_seen_seq = 105`, server reports `current_seq = 203`). It then fetches messages 106–203.

4. **Realtime subscription on reconnect:** After reconnecting to Supabase Realtime, the client must fetch messages that arrived while disconnected (Realtime does not replay missed events). The correct pattern:
   - On reconnect, query Postgres for messages `WHERE created_at > last_seen_at AND conversation_id IN (...)`.
   - Then subscribe to Realtime for new messages.
   - Use a short overlap window to avoid missing messages that arrived between the query and the subscription.

---

## The Sent/Delivered/Read State Machine

```
[client: composing]
      ↓ user taps send
[client: sending] — written to outbox, shown in UI
      ↓ server INSERT succeeds
[server: stored] — message in Postgres
      ↓ Realtime broadcast to recipient
[recipient: delivered] — recipient's device received the message
      ↓ recipient opens conversation
[recipient: read] — recipient viewed the message; read cursor updated
      ↓ sync event sent back to sender
[sender sees: read]
```

**Failure states:**
- Network error on send → stays in `sending` state → outbox retries
- Recipient device offline → stays in `delivered to server` state → push notification sent
- Push token invalid → push fails silently (APNs/FCM) → message is still in Postgres, recipient sees it on next app open

---

## Sources

- [Outbox, Inbox Patterns and Delivery Guarantees — Event-Driven.io](https://event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained/)
- [Transactional Outbox Pattern — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [XEP-0184: Message Delivery Receipts](https://xmpp.org/extensions/xep-0184.html)
- [XEP-0333: Displayed Markers](https://xmpp.org/extensions/xep-0333.html)
- [Discord Engineering — How Discord Stores Trillions of Messages (Snowflake IDs)](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Building Facebook Messenger — Engineering at Meta](https://engineering.fb.com/2011/08/12/android/building-facebook-messenger/)
- [Paginating Requests in APIs — Hacker News discussion](https://news.ycombinator.com/item?id=31541070)
