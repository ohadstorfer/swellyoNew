# Message Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp-level message search — global (Chats list, across all conversations) and in-conversation (header search with ▲▼ "N of M" hit navigation), with jump-to-message + flash highlight.

**Architecture:** One SECURITY DEFINER Postgres RPC (`search_messages`, pg_trgm-indexed ILIKE) serves both experiences. Client adds a thin service wrapper, a full-screen global search overlay launched from the revived ConversationsScreen search bar, a `targetMessageId` jump param threaded through `ChatCard`, and an in-chat search header mode in DirectMessageScreen + DirectGroupChat that reuses the existing reply-jump path (`getMessagesAround` + `scrollToIndex` + flash highlight).

**Tech Stack:** Supabase Postgres (pg_trgm), React Native/Expo, existing messagingService patterns. All-JS → OTA-able.

**Spec:** `docs/superpowers/specs/2026-07-14-message-search-design.md`

## Global Constraints

- Message text column is `messages.body` (NOT `content`).
- New SECDEF RPC: pin `search_path = public, extensions, pg_temp`; `REVOKE ... FROM PUBLIC, anon`; explicit `GRANT EXECUTE TO authenticated` (project-wide revoke means no grant ⇒ client 403).
- Migrations are applied manually (SQL editor / MCP apply_migration) — never `supabase db push`. Repo file is reference.
- No commits — Ohad reviews and commits manually. NEVER `git add -A` / `reset --hard`.
- New UI text/styles: match existing screen styles; `ff()` for any new fontFamily usage.
- Exclude `deleted = true` and `is_system = true` messages; membership-scope everything via `conversation_members`.
- Debounce 300 ms, min query length 2, RPC limit clamp ≤ 50.

---

### Task 1: Backend — pg_trgm index + `search_messages` RPC

**Files:**
- Create: `supabase/migrations/20260714120000_message_search.sql`

**Interfaces:**
- Produces RPC: `search_messages(p_query text, p_conversation_id uuid default null, p_limit int default 30, p_offset int default 0)` returning rows `(message_id uuid, conversation_id uuid, body text, message_created_at timestamptz, sender_id uuid, sender_name text, sender_avatar_url text, conversation_is_direct boolean, conversation_name text)`.

- [ ] **Step 1: Write the migration file** (see SQL below — caller escapes ILIKE wildcards client-side AND the fn is defensive via `replace`):

```sql
-- Message search: trigram index + membership-scoped search RPC.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_messages_body_trgm
  ON public.messages USING gin (body extensions.gin_trgm_ops)
  WHERE deleted = false AND body <> '';

CREATE OR REPLACE FUNCTION public.search_messages(
  p_query text,
  p_conversation_id uuid DEFAULT NULL,
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  body text,
  message_created_at timestamptz,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  conversation_is_direct boolean,
  conversation_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    m.id,
    m.conversation_id,
    m.body,
    m.created_at,
    m.sender_id,
    sp.name,
    sp.profile_image_url,
    c.is_direct,
    CASE
      WHEN c.is_direct THEN op.name
      ELSE c.title
    END AS conversation_name
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  JOIN public.conversation_members me
    ON me.conversation_id = m.conversation_id AND me.user_id = auth.uid()
  LEFT JOIN public.user_profiles sp ON sp.user_id = m.sender_id
  LEFT JOIN LATERAL (
    SELECT up.name
    FROM public.conversation_members om
    JOIN public.user_profiles up ON up.user_id = om.user_id
    WHERE om.conversation_id = c.id AND om.user_id <> auth.uid()
    LIMIT 1
  ) op ON c.is_direct
  WHERE m.deleted = false
    AND m.is_system = false
    AND m.body <> ''
    AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
    AND length(trim(p_query)) >= 2
    AND m.body ILIKE '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_messages(text, uuid, int, int) TO authenticated;
```

- [ ] **Step 2: Verify real table/column names before applying** — `conversations.title`, `conversation_members.user_id`, and the profile table name (`user_profiles` vs `surfers` etc.) via `mcp__supabase__list_tables`. Adjust SQL to reality.
- [ ] **Step 3: Apply** via `mcp__supabase__apply_migration` (or hand SQL to Ohad for the SQL editor if MCP write is blocked).
- [ ] **Step 4: Smoke-test** as a real query: `select * from search_messages('hola');` via an authenticated context is not possible from SQL editor (auth.uid() null) — instead verify function exists + `EXPLAIN` uses the trgm index with `set enable_seqscan=off` style spot check, and rely on Task 3's client call for end-to-end.

### Task 2: Pure utils — LIKE escaping + snippet windowing (+ tests)

**Files:**
- Create: `src/utils/messageSearch.ts`
- Test: `src/utils/__tests__/messageSearch.test.ts`

**Interfaces (produces):**
```ts
export function escapeLikeQuery(q: string): string          // trims; escapes \ % _
export interface SnippetPart { text: string; match: boolean }
export function buildSnippet(body: string, query: string, radius?: number): SnippetPart[]
// centers first case-insensitive occurrence, ellipsizes both sides, radius default 40 chars;
// no occurrence → head of body, no match part.
```

- [ ] Write failing tests: escaping (`%`,`_`,`\`), snippet with match mid-long-text (leading/trailing `…`), match at start, no match, Hebrew match, case-insensitive match.
- [ ] Run `npx jest src/utils/__tests__/messageSearch.test.ts` — expect FAIL.
- [ ] Implement `src/utils/messageSearch.ts`.
- [ ] Run tests — expect PASS.

### Task 3: Service — `messagingService.searchMessages()`

**Files:**
- Modify: `src/services/messaging/messagingService.ts` (add near `getMessagesAround`, ~line 935)

**Interfaces (produces):**
```ts
export interface MessageSearchResult {
  messageId: string; conversationId: string; body: string; createdAt: string;
  senderId: string; senderName: string | null; senderAvatarUrl: string | null;
  conversationIsDirect: boolean; conversationName: string | null;
}
async searchMessages(query: string, opts?: { conversationId?: string; limit?: number; offset?: number }): Promise<MessageSearchResult[]>
```

- [ ] Implement: trim query, return `[]` if `< 2` chars; `supabase.rpc('search_messages', { p_query: escapeLikeQuery(query), p_conversation_id: opts?.conversationId ?? null, p_limit: opts?.limit ?? 30, p_offset: opts?.offset ?? 0 })`; map snake_case rows → `MessageSearchResult`; on error log + throw (callers show friendly state).
- [ ] `npx tsc --noEmit` clean.

### Task 4: Jump-to-message via `targetMessageId` param

**Files:**
- Modify: `src/navigation/navigationRef.ts` — add to `ChatCard` params: `targetMessageId?: string;`
- Modify: `src/navigation/RootNavigator.tsx:242-263` — pass `targetMessageId={params.targetMessageId}` to `<Chat …>`.
- Modify: `src/screens/DirectMessageScreen.tsx` — add `targetMessageId?: string` prop; generalize `handleReplyPreviewPress` (:3713) into `jumpToMessage(messageId)` used by both reply taps and this; `useEffect` after initial messages load: if `targetMessageId` set and not yet consumed (ref guard), call `jumpToMessage(targetMessageId)`.
- Modify: `src/screens/DirectGroupChat.tsx` — same (its `handleReplyPreviewPress` is at :3529).

- [ ] Implement both screens + params + navigator pass-through.
- [ ] Key details: consume-once `useRef(false)`; wait until `!loading && messages.length > 0` before jumping; reuse existing `highlightedMessageId` flash.
- [ ] `npx tsc --noEmit` clean.

### Task 5: Global search UI (Chats list)

**Files:**
- Create: `src/components/MessageSearchOverlay.tsx`
- Modify: `src/screens/ConversationsScreen.tsx` — revive search bar (:1193-1199) as a `TouchableOpacity` opening the overlay; render overlay; wire result taps through `openConversation` (:199) extended with `targetMessageId`.

**Component contract:**
```ts
interface MessageSearchOverlayProps {
  visible: boolean;
  onClose: () => void;
  conversations: Conversation[];           // already-filtered list from screen
  onOpenConversation: (conv: Conversation) => void;                 // Chats-section tap
  onOpenMessage: (r: MessageSearchResult) => void;                  // Messages-section tap
}
```

- [ ] Build overlay: full-screen (absolute fill over content, NOT a bottom sheet), auto-focus `TextInput` + Cancel; 300 ms debounce; two `SectionList`/manual sections: **Chats** (in-memory name filter of `conversations`) and **Messages** (RPC via `searchMessages`); message row = avatar + conversation name + `buildSnippet` with bold match + relative time; idle/loading/empty/error states; keyboard dismiss on scroll.
- [ ] ConversationsScreen: `showMessageSearch` state; search-bar tap opens; `onOpenMessage` → close overlay + `pushRootCard('ChatCard', {...conv fields, targetMessageId: r.messageId})` (resolve conv fields from `conversations` by `r.conversationId`; fall back to RPC row's name/direct flag if the conversation isn't in the loaded list).
- [ ] `npx tsc --noEmit` clean.

### Task 6: In-conversation search (DM + group)

**Files:**
- Create: `src/components/chat/ChatSearchHeader.tsx`
- Modify: `src/screens/DirectMessageScreen.tsx`, `src/screens/DirectGroupChat.tsx`

**Component contract:**
```ts
interface ChatSearchHeaderProps {
  query: string; onChangeQuery: (q: string) => void;
  currentIndex: number; total: number;      // 0-based index; render "index+1 of total"
  onPrev: () => void; onNext: () => void;   // prev = older (▲), next = newer (▼)
  onClose: () => void;
  loading: boolean;
}
```

- [ ] Screens: add a search icon to the chat header (existing header right-side area); `searchMode` state swaps header for `ChatSearchHeader`.
- [ ] Hit logic per screen: debounced `searchMessages(query, { conversationId })` (results newest-first); on results, jump to hit 0; ▲ increments index (older), ▼ decrements; each move calls the Task-4 `jumpToMessage(hit.messageId)`; chevrons disabled at ends; when results length hits the 50 cap, fetch next page on ▲ at the end (offset += 50).
- [ ] Close restores normal header, clears query/results, keeps list position.
- [ ] `npx tsc --noEmit` clean.

### Task 7: Verification

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx jest src/utils/__tests__/messageSearch.test.ts` — pass.
- [ ] Manual checklist for Ohad (device): global search Hebrew + partial word; tap old message → jump+flash; in-chat ▲▼ across an out-of-window hit; no results state; other users' chats never appear.
- [ ] No commit — Ohad reviews.
