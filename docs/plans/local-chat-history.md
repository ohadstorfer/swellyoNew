# Plan: Local-first Chat History (SQLite)

> Implementation plan for moving Swellyo's messaging from memory-only +
> AsyncStorage snippets to a true local-first model: every conversation
> and message the user has seen is persisted in a local SQLite database
> on the device, survives cold starts without TTL eviction, and is the
> source of truth for the UI.
>
> Target experience: "WhatsApp-style" — open the app offline, see all your
> chats and history instantly; sync delta from the server when online.

---

## 1. Context

### What we have today
- **In-memory state** in `MessagingProvider` (conversations array + reducer).
- **Per-conv AsyncStorage cache** (`chatHistoryCache.ts`): last 100 msgs/conv, 24-hour TTL, 5 MB total cap, LRU eviction.
- **Conversation list cache** (`conversationListCache.ts`): one JSON blob in AsyncStorage, version-based invalidation.
- **Send outbox** (`messageOutbox.ts`): AsyncStorage-backed queue keyed by `clientId`, flushed on foreground / NetInfo online / conv open.
- **Realtime**: unfiltered `conversations_list` channel + filtered per-conv list subs (`list:messages:{id}`) + DM-screen filtered sub (`messages:{id}`). Reducer dedupes.

### What doesn't scale
- AsyncStorage is key/value, unqueryable. Can't do "messages where body LIKE ?" or "unread per conv in one shot".
- 5 MB cap + 24-h TTL mean old convs disappear on cold start after a day.
- Conversation list is a single serialized blob — any update rewrites the whole thing.
- Outbox, history cache, list cache are three separate storage concerns that don't transact together.
- No offline search. No offline resend of media in flight. No durable "unread across devices" story.

### What we want
- **Durable**: messages persist across cold starts indefinitely (subject to a retention policy the user can tune later).
- **Fast**: open app → first paint of conv list and last opened chat is local (<50 ms from disk).
- **Queryable**: local SQL for search, filtering, aggregates.
- **Consistent**: a single transactional store for messages + conversations + outbox, no torn writes on crash.
- **Incremental**: ship in phases without breaking current users.

---

## 2. Goals & Non-goals

### Goals
- Every conversation and message the user has ever received is stored locally.
- UI reads from local DB; server is treated as a sync peer, not the primary source during normal use.
- Offline: user can open app, read all history, compose messages (queued in outbox), search locally.
- Sync engine keeps local DB up-to-date with server via delta queries + Realtime.
- Transactional writes: a single `INSERT INTO messages + DELETE FROM outbox` per confirmed send.
- Migration from current AsyncStorage caches is automatic and lossless.

### Non-goals (for v1)
- E2EE / encryption at rest. (Note: SQLite can be encrypted later via SQLCipher; out of scope now.)
- Full-text search UI. (Schema will support it via FTS5; UI can be added later.)
- Cross-device local state (e.g., if user installs on a new phone, they sync from server — no device-to-device transfer).
- Image / video binary caching (media is still URL-referenced; the existing on-demand download stays).
- Bulk export / import of local history.

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────┐
│  React tree (ConversationsScreen, DM screen)    │
│             ↕ useMessaging() / hooks            │
├─────────────────────────────────────────────────┤
│  MessagingProvider                              │
│   - state hydrated from SQLite                  │
│   - live-updates via DB change events           │
├─────────────────────────────────────────────────┤
│  messagingService (public API unchanged)        │
│   - read path → local SQLite queries            │
│   - write path → local SQLite write + server    │
├────────────┬────────────┬───────────────────────┤
│ SQLite DB  │  Outbox    │  Sync engine          │
│ (primary)  │  (table)   │  - delta pull         │
│            │            │  - realtime ingest    │
├────────────┴────────────┴───────────────────────┤
│  Realtime (existing channels) + Supabase REST   │
└─────────────────────────────────────────────────┘
```

**Principle:** the UI never awaits a network round-trip for a read. Every query goes to SQLite. The server is a secondary peer that pushes deltas via Realtime and accepts writes asynchronously.

---

## 4. Library choices

| Concern | Choice | Reason |
|---|---|---|
| Storage engine | **`expo-sqlite` (v14+)** | Official, first-party Expo. Async API. Transactions. Works on iOS, Android, web (wasm). Already in Expo ecosystem — no custom native module. |
| Query layer | **Raw SQL + thin helper** (phase 1). Optional: **Drizzle ORM** later | Raw SQL keeps the first-phase footprint small. Drizzle gives typed queries + migrations but adds a dep and learning curve — add it in a later phase if schema complexity demands it. |
| Migrations | **Hand-written migration files** numbered by version, tracked via a `schema_meta(version INTEGER)` row | Simple, no extra lib. A `migrate()` function runs on app start: read current version, apply all pending migrations in a single transaction. |
| Reactive reads | **Event emitter + manual refresh** (phase 1). Later: **`useLiveQuery`** hook over DB change subscriptions | Phase 1: after a write, emit an event; provider re-runs its aggregate query. Keeps scope small. Phase 2 can upgrade to Drizzle's live queries or roll our own. |

Do not pull in `watermelondb`, `realm`, `op-sqlite`, or `typeorm` unless a specific capability is missing. Keep deps minimal.

---

## 5. Schema

Version 1 schema. File: `src/db/migrations/001_initial.sql`.

```sql
-- Schema version marker
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '1');

-- One row per user of the app; all other tables are user-scoped via this.
-- We rewrite the entire local DB on logout, so we don't actually need
-- user_id columns on every row — but keeping this lets us detect
-- "wrong user loaded wrong DB file" corruption.
CREATE TABLE IF NOT EXISTS app_user (
  id            TEXT PRIMARY KEY,
  last_sign_in  INTEGER NOT NULL
);

-- Mirrors public.conversations (Supabase)
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  is_direct     INTEGER NOT NULL,     -- 0/1
  metadata      TEXT,                  -- JSON
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  -- Denormalized last-message snapshot so list queries don't join.
  last_message_id        TEXT,
  last_message_body      TEXT,
  last_message_type      TEXT,
  last_message_sender_id TEXT,
  last_message_created_at TEXT,
  last_message_deleted   INTEGER,      -- 0/1
  unread_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Mirrors public.conversation_members
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id        TEXT NOT NULL,
  user_id                TEXT NOT NULL,
  role                   TEXT NOT NULL,
  adv_role               TEXT,
  joined_at              TEXT NOT NULL,
  last_read_message_id   TEXT,
  last_read_at           TEXT,
  preferences            TEXT,           -- JSON
  -- Denormalized user-profile fields so we don't need a join per render
  name                   TEXT,
  profile_image_url      TEXT,
  email                  TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user_id ON conversation_members(user_id);

-- Mirrors public.messages (server-authoritative rows only; optimistic rows
-- live in the outbox table until confirmed)
CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL,
  sender_id         TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'text',
  body              TEXT,
  rendered_body     TEXT,               -- JSON
  attachments       TEXT,               -- JSON
  image_metadata    TEXT,               -- JSON
  video_metadata    TEXT,               -- JSON
  client_id         TEXT,                -- idempotency key, matches outbox
  is_system         INTEGER NOT NULL DEFAULT 0,
  edited            INTEGER NOT NULL DEFAULT 0,
  deleted           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- Denormalized sender profile for list render
  sender_name       TEXT,
  sender_avatar     TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);

-- Optimistic outgoing messages (replaces AsyncStorage outbox)
CREATE TABLE IF NOT EXISTS outbox (
  client_id         TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL,
  sender_id         TEXT NOT NULL,
  body              TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'text',
  image_metadata    TEXT,               -- JSON
  video_metadata    TEXT,               -- JSON
  created_at        TEXT NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  last_attempt_at   TEXT,
  state             TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'sending' | 'failed'
);
CREATE INDEX IF NOT EXISTS idx_outbox_conv ON outbox(conversation_id);

-- Sync watermark per conversation — what's the newest message.created_at
-- we've already ingested from the server? Next delta-pull asks for > this.
CREATE TABLE IF NOT EXISTS sync_cursors (
  conversation_id          TEXT PRIMARY KEY,
  last_message_created_at  TEXT NOT NULL,
  last_pulled_at           TEXT NOT NULL
);

-- Global sync watermark for the conversation list itself
-- (covers: "are there new conversations I don't know about yet?")
CREATE TABLE IF NOT EXISTS global_sync (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Why denormalize?

Last-message and sender-profile fields are duplicated on parent tables so the list query is a single `SELECT * FROM conversations ORDER BY last_message_created_at DESC LIMIT 50`. No joins, no post-processing. Render time is dominated by the SQL round-trip + React reconcile — measured goal: **<30 ms from tap to first paint of cached data**.

### FTS (future)
A companion `messages_fts` virtual table using FTS5 can be added in a later migration for local search. Out of scope for v1.

---

## 6. Module layout

New directory: `src/db/`.

```
src/db/
  index.ts                 -- public API: open(), runMigrations(), transaction()
  schema.ts                -- type definitions matching the tables
  migrations/
    001_initial.sql
    002_xxx.sql            -- future
  migrate.ts               -- apply migrations idempotently
  repos/
    conversationRepo.ts    -- CRUD for conversations + members
    messageRepo.ts         -- CRUD for messages
    outboxRepo.ts          -- CRUD for outbox
    syncCursorRepo.ts      -- cursors
  events.ts                -- DB change event emitter
```

`messagingService.ts` stays the sole public API consumed by screens/providers. Internally it uses the repos.

---

## 7. Sync engine

Three ingest paths, all converging on `messageRepo.upsert`:

1. **Cold-start delta pull**. On app boot (after migrations, before rendering the list):
   - `SELECT MAX(created_at) FROM messages WHERE conversation_id = ?` → the watermark.
   - `GET /messages?conversation_id=...&created_at=gt.<wm>&order=created_at.asc&limit=500` (new edge function or existing `getMessagesUpdatedSince`).
   - Upsert each row in a single transaction.
   - Update `sync_cursors.last_message_created_at`.
   - Do the same per conversation the user is a member of, in parallel with a concurrency cap of 4.

2. **Realtime inserts/updates**. Existing `list:messages:{id}` + DM-screen `messages:{id}` channels feed into a single handler that does `messageRepo.upsert(row)`. Emits a `messages:changed` event the provider listens to.

3. **Outbox confirm**. When `messagingService.sendMessage` gets a server row back, it runs a transaction:
   ```sql
   BEGIN;
     INSERT OR REPLACE INTO messages(...) VALUES (...);
     DELETE FROM outbox WHERE client_id = ?;
     UPDATE conversations SET last_message_* = ..., updated_at = ... WHERE id = ?;
   COMMIT;
   ```
   Emits events. Provider refreshes.

### Conflict policy
Server rows are authoritative. Outbox rows have `client_id`; on upsert of a message with a matching `client_id`, the outbox entry is deleted regardless of whether the local user has seen it confirm yet. This is idempotent with the current `messages_sender_client_id_key` unique constraint.

### Deletes
Soft delete: UPDATE sets `deleted=1, body=NULL`. Fires through the UPDATE path. The denormalized `last_message_deleted` column gets updated on the parent row too.

Hard delete (rare — only `clearConversationMessages`): DELETE from messages, set the parent `last_message_*` to the previous message (or NULL if none).

### Reconnect catch-up
Already solved for the DM screen via `lastRealtimeEventAtRef`. Keep that, but also extend it to the provider: on channel re-SUBSCRIBED, run the cold-start delta pull for every conversation in state.

---

## 8. Outbox (SQLite)

The existing `src/services/messaging/messageOutbox.ts` moves to `src/db/repos/outboxRepo.ts`. Same public API:

```ts
outboxRepo.enqueue(entry);
outboxRepo.markSent(clientId);        // = delete
outboxRepo.markFailed(clientId, err);
outboxRepo.getByConversation(convId);
outboxRepo.flushAll(sendFn);
```

Flush triggers stay as-is (AppState foreground, NetInfo online, DM-screen open, MessagingProvider mount).

Why move: the outbox and the messages it's trying to send need to transact together. An AsyncStorage outbox + SQLite messages would mean a crash between "INSERT messages" and "DELETE outbox" leaves a zombie outbox entry that retries forever. With both in SQLite, one `BEGIN ... COMMIT` solves it.

---

## 9. Read path

Provider's `conversations` state is hydrated from SQLite on mount:

```ts
const rows = await conversationRepo.listWithUnread();
dispatch({ type: 'REPLACE_ALL', payload: { conversations: rows } });
```

After any write (incoming message, outbox send, mark as read, etc.), an event fires from `db/events.ts`. The provider listens and either:
- **Phase 1 (simple):** re-runs `listWithUnread()`. Cost: one SQLite query per change. Fine for <100 convs.
- **Phase 2 (delta):** event payload includes what changed; provider merges into state without re-querying.

DM screen similarly:
```ts
const rows = await messageRepo.listByConversation(convId, { limit: 50, before: oldestLoadedAt });
setMessages(rows);
```

Pagination backward is a SQL `ORDER BY created_at DESC LIMIT 50 OFFSET ?` — replaces the current chunked AsyncStorage reads.

---

## 10. Migration from current caches

On first run after the upgrade that ships SQLite:

1. Open DB, run migrations to v1.
2. Read `conversationListCache` from AsyncStorage. If present, insert each conv + its members into SQLite inside a transaction.
3. For each conv, read `chatHistoryCache` AsyncStorage entries. Insert every message.
4. Read `messageOutbox` AsyncStorage entries. Insert into `outbox` table.
5. Delete the AsyncStorage keys (`@swellyo_conversation_list`, `@swellyo_chat_history:*`, `@swellyo_outbox`).
6. Write `global_sync.migrated_from_asyncstorage = '2026-XX-XX'` so we don't re-run.

If any step fails: log it, but keep going — the server sync will backfill what's missing on next pull. The upgrade is not supposed to lose any message visibility.

---

## 11. Phased rollout

Each phase is independently shippable and reversible. Before merging a phase, the previous phase continues to work unchanged.

### Phase 0 — Plumbing (1–2 days)
- Add `expo-sqlite` dep.
- Create `src/db/` structure + `index.ts` with `open()` and `runMigrations()`.
- Write `001_initial.sql` and loader.
- Add a dev-only debug screen or CLI that runs `SELECT * FROM schema_meta` to prove it's alive.
- **No user-visible change.**

### Phase 1 — Dual-write, primary still in-memory (3–4 days)
- Every write path in `messagingService` mirrors into SQLite (via repos) alongside its current behavior.
- Provider still reads from in-memory reducer.
- Realtime handler dual-writes.
- Outbox still AsyncStorage; ignore for now.
- **User-visible change: none.** Purely adds SQLite as a shadow.

### Phase 2 — Hydrate on cold start from SQLite (2–3 days)
- Provider `loadConversations` on mount queries SQLite first, then falls back to server if empty.
- DM-screen initial load queries SQLite, then does delta sync from server.
- AsyncStorage caches become redundant — keep them temporarily as a safety net.
- **User-visible change:** faster cold-start because we hit SQLite instead of parsing giant JSON blobs from AsyncStorage. Possibly imperceptible at small data sizes.

### Phase 3 — Delta sync from SQLite watermarks (2 days)
- Replace `getLastSyncTimestamp` AsyncStorage value with `sync_cursors` table.
- On reconnect / foreground, pull only messages with `created_at > cursor` per conv.
- **User-visible change:** cheaper reconnects; less data over the wire.

### Phase 4 — Outbox on SQLite (2 days)
- Port `messageOutbox.ts` to the SQLite-backed `outboxRepo`.
- Migration step copies any existing AsyncStorage outbox entries.
- Sends transact with message inserts.
- **User-visible change:** safer retries (no zombie state on crash).

### Phase 5 — SQLite is primary, remove AsyncStorage caches (2 days)
- Delete `chatHistoryCache.ts`, `conversationListCache.ts`.
- Provider in-memory state becomes a thin mirror of SQLite queries, not an independent source of truth.
- Logout clears the DB file.
- **User-visible change:** storage is unbounded (subject to retention policy added in Phase 6), history persists past 24 h.

### Phase 6 — Retention policy + cleanup (1–2 days)
- Dev-tunable config: max messages per conv (default 2000), max age (default 1 year).
- Background cleanup job runs monthly on foreground.
- User-facing "Clear chat history" action in settings.
- **User-visible change:** optional UI to manage storage.

**Total estimate: 12–15 engineer-days.**

---

## 12. Testing

### Unit
- `conversationRepo.listWithUnread()` against a fixture DB.
- `messageRepo.upsert()` idempotency (same row twice → one row).
- `outboxRepo.flushAll()` with fake sendFn that fails twice then succeeds — ensure attempts counter and final deletion.
- Migration script: insert v0 AsyncStorage-shaped data, run migration, assert v1 tables populated.

### Integration
- Mock Supabase Realtime: dispatch INSERT/UPDATE/DELETE events, assert SQLite state converges.
- Offline simulation: enqueue sends with NetInfo mocked offline → go online → flush → assert DB + server state.

### Manual QA scenarios
- Cold-start with 0 convs — empty state renders fast.
- Cold-start with 200 convs and 10 k messages — first paint <500 ms on mid-range Android.
- Kill app mid-send — on relaunch, outbox has entry, flushes, DB stays consistent.
- Two devices, same user — both receive Realtime and converge.
- Soft-delete on device A, observe on device B — preview updates to "This message was deleted".
- Search-by-body over ~5 k messages — <200 ms.

### Regression
- Existing realtime/messaging tests (if any) must still pass. If the test suite is thin, add a smoke-test covering: send → server → Realtime → other client sees it.

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schema migration bug corrupts user data | Low | High | Wrap migration in a transaction; on any error, roll back and log. If migration fails 3× in a row, nuke the local DB and re-sync from server (messages aren't lost because server is authoritative). |
| SQLite bundle bloats app size | Medium | Low | `expo-sqlite` adds ~1 MB. Acceptable. |
| DB file grows unbounded | Medium | Medium | Phase 6 retention policy. Also: media is URL-referenced, not binary in DB, so growth is bounded by text volume. |
| expo-sqlite async API vs React's reconcile → stutters | Low | Medium | All reads inside `InteractionManager.runAfterInteractions` or `requestIdleCallback` analogue. Pre-warm on mount. |
| Two writers (Realtime + user send) collide on the same message | Low | Low | `INSERT OR REPLACE` via id is idempotent. Server `client_id` unique constraint prevents server-side duplicates. |
| Users who never upgrade see broken caches | Low | Low | Expo OTA / native release keeps old code working — no breaking change. |

---

## 14. Open questions

- **Do we want search in v1?** FTS5 is almost free to add to the schema now; the UI is another task. Recommend: add FTS5 tables in the initial migration to avoid a costly migration later, even if no UI consumes it yet.
- **Media caching**: currently images/videos are URL-referenced and downloaded on demand. Do we want to persist them too? Out of scope for this plan, but worth flagging — a media cache table keyed by URL could live alongside.
- **Multi-account**: if a user signs out and a different user signs in, do we keep the old DB? Recommend: yes, namespace DB files by `user_id` (`swellyo-${userId}.db`), open the correct one per session. Old DB survives re-login.
- **Web support**: `expo-sqlite` has wasm support for web. Test explicitly — the web build is live and used by real users.
- **Background sync on Android**: Expo doesn't give us reliable background tasks without ejecting. Sync-on-foreground is what we have. Accept.

---

## 15. TODO

### Phase 0 — Plumbing
- [ ] Add `expo-sqlite@~14` to `package.json`
- [ ] Create `src/db/index.ts` with `open(userId)` returning a DB handle
- [ ] Create `src/db/migrate.ts` with `runMigrations(db)` that reads `schema_meta.version` and applies pending files
- [ ] Write `src/db/migrations/001_initial.sql` per §5
- [ ] Add `src/db/events.ts` — minimal `EventEmitter` with `emit('messages:changed')` etc.
- [ ] Write a dev smoke test: on app start in __DEV__, log `SELECT COUNT(*) FROM messages`
- [ ] Run on iOS + Android + web to confirm expo-sqlite loads cleanly everywhere

### Phase 1 — Dual-write shadow
- [ ] Implement `src/db/repos/conversationRepo.ts` (insert/update/delete, listWithUnread)
- [ ] Implement `src/db/repos/messageRepo.ts` (upsert, listByConversation, markDeleted)
- [ ] Hook `messagingService.sendMessage` success path to also upsert into SQLite
- [ ] Hook `messagingService.editMessage` + `deleteMessage` to also write SQLite
- [ ] Hook Realtime INSERT/UPDATE/DELETE handlers in `subscribeToMessages` + `subscribeToConversationListUpdates` to write SQLite
- [ ] Hook initial `getConversations` fetch to upsert conversations + members into SQLite
- [ ] Verify in dev that `SELECT COUNT(*) FROM messages` grows as expected while using the app normally

### Phase 2 — Hydrate from SQLite
- [ ] Change `MessagingProvider.loadConversations` to query SQLite first
- [ ] Change `DirectMessageScreen.loadMessages` to query SQLite first
- [ ] Keep AsyncStorage caches as backup; add a feature flag `USE_SQLITE_PRIMARY=true` to toggle
- [ ] Measure cold-start time before/after on a device with ~50 convs loaded
- [ ] Handle the empty-DB case (new user): fallback to server fetch as today

### Phase 3 — Delta sync
- [ ] Implement `src/db/repos/syncCursorRepo.ts`
- [ ] Rewrite `getConversationsUpdatedSince` to be cursor-based off SQLite max timestamp
- [ ] On reconnect (channel re-SUBSCRIBED) or foreground, per-conv delta pull
- [ ] Concurrency cap: max 4 parallel delta pulls, queue the rest
- [ ] Handle pull errors: log, retry with backoff, don't block UI

### Phase 4 — Outbox on SQLite
- [ ] Create `src/db/repos/outboxRepo.ts` with the same API as `messageOutbox.ts`
- [ ] Replace all imports of `messageOutbox` with `outboxRepo`
- [ ] Migration: read any AsyncStorage `@swellyo_outbox` entries into SQLite, then delete the key
- [ ] Verify: kill app mid-send → relaunch → outbox still has the entry and flushes
- [ ] Delete old `src/services/messaging/messageOutbox.ts`

### Phase 5 — Make SQLite primary
- [ ] Flip `USE_SQLITE_PRIMARY` default to `true`
- [ ] Remove `chatHistoryCache.ts`, `conversationListCache.ts`, and the related AsyncStorage keys (add a one-time cleanup migration step)
- [ ] Refactor `MessagingProvider` state to be a mirror of SQLite queries via the event emitter, not an independent reducer source
- [ ] Clear DB file on logout (`logout.ts`)
- [ ] End-to-end QA: brand-new install, login, send/receive, logout, login as different user — no cross-contamination

### Phase 6 — Retention + settings
- [ ] Define retention config (default: 2000 messages/conv, 365 days)
- [ ] Background cleanup on first foreground of each month
- [ ] "Clear chat history" button in Settings that drops + recreates the DB and pulls fresh from server
- [ ] "Storage used" indicator in Settings (`SELECT page_count * page_size FROM pragma_page_count()`)

### Cross-cutting
- [ ] Error telemetry: pipe migration failures / DB-open failures to PostHog
- [ ] Performance telemetry: track `listWithUnread` query time in dev and log if >50 ms
- [ ] Docs: update `CLAUDE.md` "Messaging" section to explain the new local-first model
- [ ] Write a one-page runbook on how to inspect the local DB from a dev build (`sqlite3 $appdir/...`) for debugging user reports

---

## 16. Appendix — public API contracts we must preserve

`messagingService` surface that screens already depend on; these **must not break** at any phase boundary:

- `getConversations(limit, offset)`
- `getMessages(conversationId, limit, before?)`
- `sendMessage(conversationId, body, attachments, type, clientId?)`
- `editMessage(conversationId, messageId, body)`
- `deleteMessage(conversationId, messageId)`
- `markAsRead(conversationId, messageId?)`
- `subscribeToMessages(conversationId, callbacks)`
- `subscribeToConversations(callbacks)`
- `subscribeToConversationListUpdates(conversationId, callbacks)`

Internal: repos can change freely between phases. Screens can't tell the difference.
