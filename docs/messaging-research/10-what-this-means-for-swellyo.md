# 10 — What This Means for Swellyo

Synthesis: which ideas apply now, which require a different backend, which are premature, and which are worth prototyping.

---

## Current Stack Assessment

| Layer | Current | Notes |
|-------|---------|-------|
| Transport | Supabase Realtime (Phoenix channels over WebSocket) | Fine. Equivalent to Slack/Discord's WebSocket. |
| Storage | Postgres via Supabase + Prisma | Fine. Standard and battle-tested. |
| Media | Supabase Storage | Fine for now. Gaps at video scale. |
| Push | Not robustly implemented | Gap. Critical for mobile reliability. |
| E2EE | None | Messages stored in plaintext on Supabase. |
| Multi-device | Trivial (server-side history) | Works because E2EE is not in place. |
| Offline outbox | Unknown (AsyncStorage partial) | Likely a gap. |
| Read receipts | Unknown schema | Likely a gap if not in `read_cursors` table. |
| Message IDs | Likely UUID v4 or BIGSERIAL | Need to confirm pagination uses cursor, not offset. |

---

## Directly Applicable Now (no backend change needed)

### 1. Cursor pagination for message history
Replace any `OFFSET`-based pagination with keyset pagination:
```sql
WHERE conversation_id = $1 AND id < $2 ORDER BY id DESC LIMIT 50
```
This is critical for correctness — `OFFSET` drifts as new messages arrive. Apply now.

### 2. Read cursors table
Add a `read_cursors` table (one row per user per conversation, storing `last_read_message_id`). This enables:
- Unread count badges
- Multi-device read-state sync
- Future read receipt ticks (sent/delivered/read)
Apply now. It costs one table and two queries.

### 3. Persistent offline outbox
Use `expo-sqlite` or AsyncStorage to persist pending messages across app restarts. On reconnect, flush in order. Each pending message must carry a `client_id` (UUID). The server INSERT must use `ON CONFLICT (client_id) DO NOTHING`. This eliminates message loss on flaky connections. Low effort, high reliability impact.

### 4. Push notifications
Send a push via Expo Push Service (or direct APNs/FCM) from a Supabase Edge Function when a new message is inserted (via Postgres Webhook → Edge Function). Store push tokens in a `push_tokens` table. Suppress in-app if the recipient's Realtime subscription is active. This is the biggest gap for native mobile reliability. See `06-push-notifications.md` for the implementation pattern.

### 5. `client_id` idempotency on messages
Add a `client_id UUID UNIQUE` column to the messages table. The client generates this before sending. `ON CONFLICT DO NOTHING` on the INSERT. Enables safe retries without duplicate messages.

### 6. Message ordering by `(created_at, id)`
Ensure the frontend sorts messages by `(created_at ASC, id ASC)`. Never trust client-provided timestamps as the sole ordering key.

---

## Worth Prototyping Soon (moderate complexity)

### 7. Realtime + Postgres catch-up on reconnect
Supabase Realtime does not replay missed events. When the WebSocket reconnects, the client must query Postgres for messages that arrived while disconnected, then subscribe to Realtime. The current `MessagingProvider.tsx` likely has a gap here — messages sent while the WebSocket was down may never appear without a manual refresh.

Pattern:
```typescript
const since = lastSeenMessageTimestamp;
// 1. Subscribe to Realtime
// 2. Fetch from Postgres WHERE created_at > since
// 3. Merge results, dedup by message ID
```

### 8. Typing indicators via Broadcast (not Postgres)
Typing indicators should use Supabase Realtime Broadcast, not Postgres writes. Writing a `typing` row on every keystroke is expensive. Broadcast sends ephemeral events to channel subscribers without a DB write. If this is already using Broadcast, good. If it's using Postgres inserts, change it.

### 9. Supabase Storage signed URLs with short TTL
Media URLs should be signed with a short TTL (1–24 hours) rather than public permanent links. This prevents external users from accessing media after they've left a conversation. Supabase Storage supports `createSignedUrl(path, expiresIn)`.

---

## Premature for Current Scale (do not build now)

### 10. Database sharding
Swellyo has one Postgres instance via Supabase. Sharding is not needed until you have millions of active users and billions of messages. Ensure your schema uses `conversation_id` as the primary query dimension (indexed), and sharding will be a routing-layer addition later, not a schema rewrite.

### 11. Custom CDN / edge nodes
Supabase Storage has a CDN (~150ms global). This is fine. Building edge caching (like Slack's Flannel) is appropriate when you have tens of thousands of concurrent users and startup payload is measurably slow. Not now.

### 12. Message fanout to millions
Client-side fan-out (one copy per recipient device) is the E2EE model. Without E2EE, a single broadcast handles all devices. Fan-out optimization matters at Discord/WhatsApp scale — not relevant now.

---

## Cannot Do Without Leaving Supabase (or Major Architecture Addition)

### 13. True E2EE
**Why it can't happen on current Supabase:**
- Messages are stored as plaintext in Postgres. The Supabase operator (and legally, Meta/Google via Supabase's cloud) can read them.
- Supabase RLS enforces access control, not content privacy.
- Key distribution would require a new infrastructure component (a public key registry accessible to clients before they message each other).

**What would change:**
- Add a `device_keys` table (public keys per user per device).
- Implement X3DH/Double Ratchet in a React Native library (`libsignal` has TypeScript bindings).
- Messages stored as ciphertext in Postgres. The `content` column becomes opaque bytes.
- Key management for backup/restore (either client-held local backup or an HSM-backed vault).
- Supabase RLS still enforces row-level access (only participants can read rows), but content is ciphertext.

**Verdict:** Feasible as a future milestone. Design the key registry table now (even empty) to make the migration less painful.

### 14. Sealed sender / metadata hiding
Even with content E2EE, Supabase sees who is messaging whom, at what time, and how often. Hiding this metadata (Signal's sealed-sender approach) requires replacing Supabase Realtime with a custom relay that cannot correlate sender to recipient. Not feasible on Supabase. For a social surf app, this level of privacy is probably not a user requirement.

### 15. Hundreds of millions of concurrent WebSocket connections
Supabase Realtime's Team/Enterprise plan supports 10,000 concurrent connections. Self-hosted Realtime (running your own Elixir cluster) can scale further, but this is a significant operational commitment. At the scale where this matters, Swellyo would have budget for dedicated infrastructure. Not a concern today.

### 16. Notification Service Extensions for E2EE decryption on iOS
Requires native iOS development (Swift/Obj-C extension target in Xcode). Expo Managed Workflow supports this via a config plugin. Only relevant once E2EE is in place. Prototype after E2EE, not before.

---

## Recommended Priority Order

**Immediate (reliability and correctness):**
1. Push notifications via Edge Function + push_tokens table
2. Offline outbox with persistent storage + `client_id` idempotency
3. Realtime reconnect catch-up query
4. Cursor pagination (verify and fix if using OFFSET)

**Near-term (UX quality):**
5. Read cursors table (unread counts, multi-device read sync)
6. Typing indicators via Broadcast (if not already)
7. Signed URLs for media with short TTL

**Future (when user demand or privacy requirements drive it):**
8. E2EE (Signal Protocol, 1:1 first)
9. Group E2EE (Sender Keys or MLS)
10. Push notification decryption extension (once E2EE is live)

---

## One Honest Assessment

The current architecture (Supabase Realtime + Postgres) is a solid foundation for a messaging feature at the scale Swellyo operates today and for the next 12–18 months. The gaps are not architectural flaws — they are implementation gaps: missing push notifications, missing outbox, potentially missing catch-up queries. These are weeks of work, not months of refactoring.

The architecture that could not scale — workspace-sharded MySQL (Slack), MongoDB for chat (Discord early days) — were correct choices at the time and only became problems at scale neither app could have predicted at founding. Swellyo's Postgres-on-Supabase is at least as good as those starting points, and better in the sense that it already has correct indexing conventions available.

Build the reliability basics first. Refactor for scale when the metrics tell you to.

---

## Sources

All findings synthesized from earlier research documents. Primary sources:
- [Supabase Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase Realtime Architecture](https://supabase.com/docs/guides/realtime/architecture)
- [Discord Engineering — How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Engineering at Meta — WhatsApp Multi-Device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
- [Signal Blog — A Synchronized Start for Linked Devices](https://signal.org/blog/a-synchronized-start-for-linked-devices/)
- [Slack Engineering — Scaling Datastores at Slack with Vitess](https://slack.engineering/scaling-datastores-at-slack-with-vitess/)
