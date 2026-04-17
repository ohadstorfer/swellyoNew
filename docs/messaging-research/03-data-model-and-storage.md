# 03 — Data Model and Storage

How messages, conversations, read receipts, and reactions are structured and stored at scale.

---

## Discord: MongoDB → Cassandra → ScyllaDB

Discord's storage journey is the best-documented migration in the messaging space, with primary sources from their own engineering blog.

### Phase 1: MongoDB (2015–2017)
At launch, Discord stored messages in a single MongoDB collection. By November 2015, the dataset had 100 million messages, data and indexes had exceeded available RAM, and query latency had become unpredictable. The fix was to move to a purpose-built write-optimized store.

### Phase 2: Cassandra (2017–2022)
Discord migrated to Cassandra (12 nodes in 2017) with this schema:

```
Primary key: ((channel_id, bucket), message_id)
```

- `channel_id`: partition boundary by conversation
- `bucket`: a 10-day time window (derived from `message_id`'s Snowflake timestamp), used to bound partition size so that a single busy channel doesn't create an unbounded partition
- `message_id`: Snowflake ID (64-bit, time-ordered, from Discord's custom epoch January 1, 2015)

Snowflake IDs are time-ordered within a bucket, so pagination is a simple range scan: `WHERE channel_id = ? AND bucket = ? AND message_id < ? LIMIT 50`. No offset, no `ORDER BY` cost.

**The hot partition problem:** Cassandra partitions messages by `(channel_id, bucket)`. Large servers with millions of active users all hitting the same channel-bucket partition cause "hot partitions" — single Cassandra nodes receiving disproportionate requests. Concurrent reads must merge memtables and multiple SSTables on-disk, causing cascading latency and compaction backlog. By 2022 with 177 nodes, Discord's team described Cassandra as "a high-toil system requiring constant maintenance."

### Phase 3: ScyllaDB (2022–present)
ScyllaDB is Cassandra-compatible (same CQL, same data model) but written in C++ using the Seastar async framework — no JVM, no garbage collector. The same schema, no migration of query patterns.

**What changed:**
- Rust data-service layer added between app and DB. This layer performs *request coalescing*: if 1,000 clients request the same message partition simultaneously, only one query reaches the database; others wait for and receive the same response.
- Consistent hash routing by `channel_id` ensures the same Rust service instance handles all requests for a given channel, maximizing cache hit rate.
- Storage: local SSD for speed, RAID-mirrored to persistent disk for durability.
- 177 Cassandra nodes → 72 ScyllaDB nodes
- p99 read latency: 40–125ms (Cassandra) → 15ms (ScyllaDB)
- p99 write latency: 5–70ms (Cassandra) → steady 5ms (ScyllaDB)

---

## WhatsApp: Transient Store-and-Forward

WhatsApp historically deleted messages from their servers immediately after delivery. The model is:

1. Client sends message to server.
2. Server stores message in ephemeral queue (Mnesia in-memory DB, Erlang).
3. Server pushes message to recipient.
4. On delivery ACK, server deletes the message.

If the recipient is offline, the server retains the message until delivery or a retention window expires (historically 30 days). There is no persistent message history on WhatsApp's servers per se — history is on device only.

**Consequence:** No cross-device history sync until 2021 (multi-device launch). History migration between devices required a local device-to-device transfer or cloud backup. This is the opposite of Slack/Discord's server-side history model.

**Recent evolution:** With multi-device support (2021), a limited amount of recent chat history is synced to newly linked devices via an encrypted archive bundle, but the core model remains client-side storage.

---

## Slack: MySQL + Vitess

Slack uses MySQL with Vitess (the open-source MySQL sharding proxy originally from YouTube/Google).

### Original schema
Workspace-sharded: all data for a workspace (messages, channels, DMs, users) lived on one MySQL shard. Shard key: `workspace_id`. This worked until enterprise customers exceeded single-shard hardware capacity.

### Vitess migration (2017–2020)
Vitess adds a routing layer that maps queries to the correct shard(s) transparently to the application. Slack moved to channel-ID sharding for the messages table — distributing load by conversation rather than workspace. Large enterprise workspaces that previously saturated a single shard now spread across the fleet.

**Scale:** 2.3M QPS at peak (2M reads, 300K writes), 2ms median / 11ms p99 latency. Three-year migration covering 99% of MySQL traffic by 2020.

**Pagination:** Slack uses cursor-based pagination with message timestamps/IDs. Offset-based pagination (`LIMIT x OFFSET y`) is not safe for real-time chat — new messages arriving between page fetches cause the offset to drift.

---

## Data Modeling Patterns Applicable to Postgres

### Conversations and Messages

```sql
-- Minimal viable schema for a chat app
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  type        TEXT -- 'dm', 'group', 'channel'
);

CREATE TABLE conversation_participants (
  conversation_id  UUID REFERENCES conversations(id),
  user_id          UUID REFERENCES users(id),
  joined_at        TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id               BIGINT GENERATED ALWAYS AS IDENTITY, -- or Snowflake
  conversation_id  UUID NOT NULL,
  sender_id        UUID NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  content          TEXT,
  deleted_at       TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, id)  -- composite PK for partition-like access
);

CREATE INDEX ON messages (conversation_id, id DESC); -- most recent first
```

### Sharding key: conversation_id vs. user_id

**Shard by `conversation_id`:** All messages for a conversation are co-located. Efficient for conversation history queries. Used by Discord, and how Slack's Vitess migration ended up (channel-ID sharding). Hot conversations (one massive channel) can still overwhelm a node.

**Shard by `user_id`:** All data a user needs is on one shard. Efficient for "all messages involving this user" queries. Inbox-style queries are fast. Cross-user queries (e.g., group messages) require scatter-gather. Used by some email systems.

For Postgres at Swellyo's scale, sharding is not needed today. The correct answer for now is: partition indexes by `(conversation_id, id DESC)`, use cursor pagination, and index `user_id` for inbox-style queries.

### Read Receipts

Three patterns used in the wild:

1. **Last-read cursor per user per conversation** (simplest, used by many apps):
   ```sql
   CREATE TABLE read_cursors (
     user_id          UUID,
     conversation_id  UUID,
     last_read_id     BIGINT,
     PRIMARY KEY (user_id, conversation_id)
   );
   ```
   "Unread count" = `COUNT(*) WHERE id > last_read_id`. Simple, one row per user per conversation, cheap to write. Does not track per-message read state.

2. **Per-message per-user receipt** (WhatsApp ticks, signal "seen by"):
   ```sql
   CREATE TABLE message_receipts (
     message_id   BIGINT,
     user_id      UUID,
     status       TEXT, -- 'delivered', 'read'
     at           TIMESTAMPTZ,
     PRIMARY KEY (message_id, user_id)
   );
   ```
   Expensive at scale — one row per message per recipient. For a group of 50 people, every message generates 49 receipt rows.

3. **Aggregated per-message read count** (Discord "x people seen this"):
   Store a counter column on the message row. Cheaper to read, but you lose per-user granularity.

### Reactions

```sql
CREATE TABLE reactions (
  message_id    BIGINT,
  user_id       UUID,
  emoji         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
```

Aggregate with `GROUP BY message_id, emoji`. At high volume, denormalize reaction counts onto the message row and update via trigger or application-level increment.

### Snowflake IDs vs. UUID vs. BIGSERIAL

| | Monotonic? | Distributed? | Time-sortable? | Size |
|--|--|--|--|--|
| UUID v4 | No | Yes | No | 128 bit |
| UUID v7 | Yes (ms) | Yes | Yes | 128 bit |
| BIGSERIAL | Yes | No (single seq) | Yes | 64 bit |
| Snowflake | Yes (ms) | Yes (worker bits) | Yes | 64 bit |

Snowflake IDs (used by Discord and Twitter) encode timestamp in high bits, making them inherently time-ordered and cursor-friendly. UUIDv7 (RFC 9562) is the modern standard-compliant equivalent. Postgres `gen_random_uuid()` generates v4 — random, not sortable. For cursor pagination, use `BIGSERIAL` or UUIDv7.

### Pagination

Never use `OFFSET` for chat message pagination. Use keyset/cursor pagination:

```sql
-- Load older messages before a known message
SELECT * FROM messages
WHERE conversation_id = $1 AND id < $2
ORDER BY id DESC
LIMIT 50;
```

This is an index scan, not a table scan. `OFFSET` degrades to O(n) as pages grow.

---

## Sources

- [Discord Engineering — How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [ScyllaDB — How Discord Migrated Trillions of Messages from Cassandra to ScyllaDB](https://www.scylladb.com/tech-talk/how-discord-migrated-trillions-of-messages-from-cassandra-to-scylladb/)
- [Slack Engineering — Scaling Datastores at Slack with Vitess](https://slack.engineering/scaling-datastores-at-slack-with-vitess/)
- [Slack Engineering — Unified Grid: Re-architected for Largest Customers](https://slack.engineering/unified-grid-how-we-re-architected-slack-for-our-largest-customers/)
- [High Scalability — WhatsApp Architecture](http://highscalability.com/blog/2014/2/26/the-whatsapp-architecture-facebook-bought-for-19-billion.html)
- [InfoQ — Discord Migrates Trillions of Messages from Cassandra to ScyllaDB](https://www.infoq.com/news/2023/06/discord-cassandra-scylladb/)
