---
name: read-receipts-patterns
description: How WhatsApp/Telegram/Slack/Signal/Sendbird handle read receipts — watermark pattern, batching, decoupled push vs DB write, unread count computation, and Supabase-specific synthesis
metadata:
  type: reference
---

# Read Receipts — Industry Patterns Research

## The Universal Answer: Watermark, Not Per-Message

Every major chat system (WhatsApp, Telegram, Slack, Signal, Sendbird, Google Chat, XMPP XEP-0333) stores a single "read up to position X" watermark per user per conversation — NOT a per-message read bit. The XMPP XEP-0333 spec (Displayed Markers) explicitly mandates this: "If multiple messages are displayed at once an entity SHOULD only send a `<displayed/>` marker for the most recent received message." And: "Displayed Markers carry a semantic of all messages up to this point."

This is the key insight: the mark-as-read operation is inherently coalescing — it's always "read everything up to the last message I saw", not "read message A, read message B...".

## Mechanism 1 — The Watermark

What gets stored:
- **Telegram**: `read_inbox_max_id` (integer message ID, per dialog). Server maintains `updateChatReadInbox` with `last_read_inbox_message_id` + `unread_count`. O(1) unread count: `last_event_id - device_read_event_id`.
- **Slack**: `last_read` timestamp per channel per user (stored in Memcache for fast access; `users.counts` API returns all channel unread states in one shot).
- **Sendbird**: Timestamp of when `markAsRead()` was called on the channel. "A message being read is calculated using the message creation time and when markAsRead() was called. Individual messages do not retain information on when they were read."
- **Signal**: `last_read_message_id` per conversation.
- **Google Chat**: `lastReadTime` timestamp on a `SpaceReadState` resource. To mark as read: PATCH `lastReadTime` to any value greater than the latest message's `create_time`.
- **Swellyo current**: `last_read_at` timestamp + `last_read_message_id` on `conversation_members`. Already correct schema.

## Mechanism 2 — Decoupled Push vs. DB Write (Fire-and-Forget Receipt)

The industry-standard pattern, confirmed by multiple sources:

1. **Instant path**: Broadcast the read receipt event over WebSocket/Realtime immediately. The sender sees "Seen" in under 100ms.
2. **Durable path**: Write the watermark to the database asynchronously, potentially throttled/debounced.

Facebook Messenger (Iris) confirmed this explicitly: the queue has "separate pointers indicating the last update sent to your Messenger app and the traditional storage tier." Read state can be delivered to the app before the DB write completes.

Under extreme load, Facebook explicitly **deprioritizes read receipts**: "Iris would rather deliver a message and drop the read receipt, rather than drop the message and deliver the read receipt." (IEEE Spectrum, 2018). Read receipts are treated as lower-priority than actual message delivery.

Telegram similarly uses Redis counters flushed to Postgres every 10 seconds for group read counts, not synchronous DB writes.

## Mechanism 3 — When to Call markAsRead (Trigger Timing)

The industry consensus:
- **On conversation open / screen focus**: All major apps trigger mark-as-read when the user views the conversation, not on each incoming message.
- **On app blur/background**: A "final flush" mark-as-read call when the user leaves the chat is the standard secondary trigger.
- **NOT per-incoming-message**: No major app fires a new DB write for every message received while the chat is open. WhatsApp sends one receipt for the open event, not one per bubble rendered.
- Sendbird explicitly warns: "Do not call markAsRead() when scrolling up in the message view. This is a common mistake and will lead to rate limits."

## Mechanism 4 — Unread Count Computation

Three approaches found in the wild:

**A. Watermark subtraction (O(1))**: `unread_count = last_message_id - last_read_message_id`. Telegram does this. Requires sequential integer IDs.

**B. Single COUNT query (O(n) but one query)**: `SELECT COUNT(*) FROM messages WHERE conversation_id = X AND created_at > last_read_at AND sender_id != me`. This is what Swellyo currently does (correctly). Cached in memory/Memcache after fetch.

**C. Maintained counter + Redis**: For groups with thousands of members, a Redis counter is incremented per read event and flushed to Postgres periodically (Telegram groups). Not needed for 1-on-1 DMs.

For 1-on-1 chat at Swellyo's scale, approach B (one COUNT query, cached in the provider's conversation state) is correct. The count only needs refreshing when: (a) a new message arrives, (b) the user marks as read. Not on every incoming message while the chat is open.

## Mechanism 5 — Throttling/Batching Patterns

- **Sendbird**: SDK-level request throttling built in. Rate limits enforced server-side.
- **Telegram (groups)**: Redis aggregator, 10-second flush to Postgres.
- **Forum/large-scale pattern (PostgresPro list)**: "Update every 1000 views" or async via `pg_send_query`. `synchronous_commit=off` for non-critical read state.
- **XMPP XEP-0333**: Coalesce multiple simultaneous display events into one marker for the newest message.
- **Stream Chat**: SDK "takes care of request throttling, duplicate request prevention, and synchronization rules between message receipt states."

The common pattern: **client-side debounce of the DB write** (500ms-2s), combined with an **immediate Broadcast event** for the real-time display. The DB write is the slow/expensive part; the Broadcast is cheap and fast.

## What Swellyo Currently Does (The Problem)

From the code:

1. On every incoming message while the chat is open: `markAsRead(convId)` is called directly in the message subscription callback (DirectMessageScreen.tsx line ~666).
2. `markAsRead` in messagingService.ts does: UPDATE conversation_members (1 write) + broadcast read_receipt (1 Realtime send).
3. After that, MessagingProvider's `markAsRead` does: `getUnreadCount(conversationId)` = another SELECT COUNT query.
4. The unread count query at line 2899 in messagingService.ts is: SELECT id with count:exact WHERE created_at > last_read_at — a full index scan per call.

So per incoming message while chat is open: 1 UPDATE + 1 SELECT COUNT + 1 Broadcast = 3 DB ops. If the sender is also listening (onReadReceiptUpdate via postgres_changes on conversation_members), that triggers a fourth query path.

## The Fix (Industry-Validated Approach)

Step 1 — **Immediate Broadcast only** (no DB write) when a new message arrives while the chat is open. The sender already gets the "Seen" indicator via the existing `read_receipt` Broadcast event.

Step 2 — **Debounced/coalesced DB write**: Keep a ref to the latest message ID seen. Write `last_read_at` + `last_read_message_id` to DB at most once per 2-3 seconds, or on screen blur/unmount — whichever comes first.

Step 3 — **Skip the COUNT re-query** when marking as read inside an open chat. The unread count for a conversation the user is actively viewing is 0 by definition. Just dispatch `SET_UNREAD_COUNT 0` directly.

Step 4 — The durable DB write (step 2) is still needed because:
- Other devices (multi-device read sync)
- App restart (restore last read position)
- Push notification badge count (server needs the ground truth)

## Swellyo-Specific Synthesis

- The existing architecture (watermark in `last_read_at`, Broadcast for instant receipt, postgres_changes for durable sync) is correct. The problem is only in call frequency.
- The fix is: gate the `markAsRead` call so it only fires on **conversation open** and **screen blur/unmount**, not on each received message.
- For the "seen" indicator the sender sees: the Broadcast already fires on open (correct). No need to re-broadcast on each incoming message.
- The `getUnreadCount` post-mark is an anti-pattern when the user is actively in the chat. Replace with a direct dispatch of 0.
- The postgres_changes listener on `conversation_members` for `onReadReceiptUpdate` is the correct durable sync path for the sender — no change needed there.

## Sources

- [XEP-0333 Displayed Markers](https://xmpp.org/extensions/xep-0333.html) — spec mandating watermark + coalescing
- [Sendbird markAsRead docs](https://sendbird.com/developer/tutorials/read-receipts-sendbird-chat) — channel-level watermark, rate limit warning
- [Google Chat updateSpaceReadState](https://developers.google.com/workspace/chat/api/reference/rest/v1/users.spaces/updateSpaceReadState) — lastReadTime watermark
- [Facebook Messenger Iris / IEEE Spectrum](https://spectrum.ieee.org/how-facebooks-software-engineers-prepare-messenger-for-new-years-eve) — "drop read receipt, not the message" + load shedding
- [Facebook Engineering blog — Building Mobile-First Infrastructure for Messenger](https://engineering.fb.com/2014/10/09/production-engineering/building-mobile-first-infrastructure-for-messenger/) — Iris queue, separate storage + app pointers
- [Telegram MTProto read_inbox_max_id](https://core.telegram.org/constructor/dialog) — integer watermark per dialog
- [Notes on Telegram IM architecture](https://sitano.github.io/2018/11/26/tg-arch-notes/) — O(1) unread via watermark subtraction
- [PostgresPro forum — read/unread topic status](https://postgrespro.com/list/thread-id/2051649) — async write patterns, memcache+watermark
- [Stream Chat throttling](https://getstream.io/chat/docs/react/unread_messages/) — SDK handles throttle + dedup
