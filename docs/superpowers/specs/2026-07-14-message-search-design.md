# Message Search — Design Spec (2026-07-14)

WhatsApp-level message search: global (across all chats, from the Chats list) and in-conversation (within an open chat, with hit navigation). All-JS, OTA-able. Approved by Ohad 2026-07-14.

## Backend

### Migration (applied manually in SQL editor; repo file is reference)

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
2. Partial GIN trigram index:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_messages_body_trgm
     ON public.messages USING gin (body gin_trgm_ops)
     WHERE deleted = false AND body <> '';
   ```
3. RPC `search_messages(p_query text, p_conversation_id uuid DEFAULT NULL, p_limit int DEFAULT 30, p_offset int DEFAULT 0)`
   - `SECURITY DEFINER`, `SET search_path = public, extensions, pg_temp`.
   - `REVOKE EXECUTE ... FROM PUBLIC, anon;` + `GRANT EXECUTE ... TO authenticated;` (project convention: new SECDEF RPCs need explicit GRANT or the client gets 403).
   - Visibility: only conversations where `auth.uid()` is in `conversation_members`.
   - Filters: `deleted = false`, `is_system = false`, `body <> ''`, `body ILIKE '%' || p_query || '%'` (escape `%`/`_`/`\` in `p_query`).
   - `p_conversation_id NULL` → global search; non-NULL → scoped to that conversation (still membership-checked).
   - Order: `created_at DESC`. Pagination via `p_limit`/`p_offset` (limit clamped ≤ 50).
   - Returns per row: `message_id, conversation_id, body, message_created_at, sender_id, sender_name, sender_avatar_url, conversation_is_direct, conversation_name` (group name for groups; other participant's name for directs). Enough to render result rows with no follow-up fetches.

### Matching semantics
Substring match (ILIKE), case-insensitive, works mid-word and in any language (Hebrew/Spanish/English). No stemming. Minimum query length enforced client-side: 2 chars.

## Client — shared service

`messagingService.searchMessages(query, { conversationId?, limit?, offset? })` — thin RPC wrapper returning typed `MessageSearchResult[]`. Errors surface via `friendlyErrorMessage` conventions; empty array on no hits.

## Client — global search (Chats list)

- Revive the commented-out search bar at the top of `ConversationsScreen.tsx` (~line 1193, existing `searchBar*` styles). It is a **tap target**, not a live input.
- Tapping opens a full-screen search overlay/screen (`MessageSearchScreen` component) with auto-focused input, cancel button, keyboard up. Full-screen, not a bottom sheet.
- Debounce 300 ms, min 2 chars. Two sections:
  1. **Chats** — in-memory filter of the already-loaded conversation list by display name. No network.
  2. **Messages** — RPC results. Row: avatar, conversation name, snippet with the matched substring **bold**, relative timestamp. Snippet windowing: center the match, ellipsize both sides.
- Tap a Chats row → open the conversation normally.
- Tap a Messages row → navigate to `DirectMessageScreen`/`DirectGroupChat` with a `targetMessageId` (+ `targetMessageCreatedAt`) param.
- States: idle (empty prompt), loading (spinner), no results, error.

## Client — jump-to-message

In both `DirectMessageScreen` and `DirectGroupChat`: on mount/param-change with `targetMessageId`, reuse the existing reply-jump path — find in `invertedMessages`, else `messagingService.getMessagesAround()` to re-anchor, then `scrollToIndex({ viewPosition: 0.5 })` and flash-highlight the bubble (same highlight used for reply jumps). Extract/reuse rather than duplicate where practical.

## Client — in-conversation search

- Search action in the chat header of both DM and group screens.
- Active state replaces the header with: back/close, text input, and a hit-navigation bar: `▲ ▼` chevrons + "N of M" counter (WhatsApp pattern). Disabled chevrons at the ends.
- Same RPC with `p_conversation_id` set; debounce 300 ms, min 2 chars; results ordered newest-first, entering search lands on the newest hit; ▲ walks older, ▼ newer.
- Each hit navigation uses the jump-to-message path above (with `getMessagesAround` re-anchoring for out-of-window hits) + flash highlight.
- Closing search restores the normal header and leaves the list where it is.

## Out of scope (this round)

- Highlighting matched text inside message bubbles (WhatsApp doesn't either — bubble flash only).
- Searching file names, contact metadata, media metadata.
- Recent-search history persistence.
- Search inside Swelly AI chats (`ChatScreen`) — user DMs and groups only.

## Acceptance criteria

1. Typing ≥2 chars in global search returns matching chats (by name, instant) and matching messages (via RPC) across only the user's conversations.
2. Tapping a message result opens the right chat scrolled to that message with a flash highlight, even if the message is months old (out of the loaded window).
3. In-chat search shows "N of M" and ▲/▼ moves between hits with the same jump+highlight, including out-of-window hits.
4. Hebrew and partial-word queries match (e.g. "boa" finds "board").
5. Deleted and system messages never appear; another user's conversations never appear.
6. `npx tsc --noEmit` clean; `mediaAlbums`-style unit tests for any new pure utils (snippet windowing, query escaping).
