# SPEC: Trip Chat as a tab

**Status:** Draft v1, written 2026-09-23 from an interview with Ohad.
**Reference image:** Ohad's mockup: black trip header, then the tab bar, then the
full group chat (messages + input). No hero, no floating "Trip Chat" button.

## Summary

The floating "Trip Chat" button on the group trip page is replaced by a **Chat** tab
next to Overview / Plan (or Overview / Dashboard). The chat shows inside the trip page,
under the header and the tabs. Every other way into a trip chat (Messages list, push,
in-app banner, share-to-Swellyo, commitment review, message search) now opens the trip
on this tab. People who left or were removed keep a **read-only** Chat tab that shows
messages up to the time they left. As part of this work, the server now keeps the chat
membership in sync with trip membership, which fixes the co-host removal bug.

## Requirements

### Tabs
1. `TripTab` (`src/components/trips/TripTabToggle.tsx:25`) gets `'chat'`. Label "Chat".
2. Tab sets (`visibleTabs`, `TripDetailScreen.tsx` ~1242):
   - Dashboard viewers: `['overview', 'dashboard', 'chat']`
   - Plan viewers: `['overview', 'plan', 'chat']`
   - Others who can chat (see 3): `['overview', 'chat']`
   - Everyone else: `['overview']`
3. **Who sees Chat:**
   - Host or approved member (same rule as the old button: `isHost || isApprovedMember`).
   - **Also on cancelled trips.** This is a change: the button and the menu item used to hide on cancel. The chat keeps working after a cancel.
   - **Departed users** (left or removed) see it **read-only** (see 14–17).
   - **Operator staff whose tier has `chat.participate`** (default tiers: Guide, Manager,
     Co-operator, Operator; not Crew, not Listed). Check it with
     `can('chat.participate')` from `useTripCapabilities`, never with a hardcoded tier
     list, so an `UPDATE` to `organized_trip_staff_roles` changes who chats with no
     release. Revoked staff (and staff whose tier loses the permission) get the same
     read-only view as departed travelers.
   - Simplest client rule: show Chat when the user has an **active** or **departed**
     `conversation_members` row for the trip chat. The server (req 23) keeps that row in
     sync with hosts, travelers and staff, so the client never works it out on its own.
4. The Chat tab shows an **unread badge**, a small count pill, using the trip conversation's
   `unread_count` from `MessagingProvider`. There is no badge while the Chat tab is open,
   and no badge for departed users.
5. The default-tab logic is unchanged: operators open on Dashboard, everyone else on
   Overview, unless `focus: 'chat'` is passed.

### Chat tab body
6. When `activeTab === 'chat'`:
   - The hero, countdown and scroll body are **not rendered**. The trip `ScrollView` is
     replaced by the chat. Do not nest a FlatList inside the ScrollView.
   - The tab bar sits **fixed right under the black header** (static, not the sticky
     clone).
   - The chat fills everything below it, down to the bottom safe area.
7. The chat is `DirectGroupChat` in a new **`embedded`** mode:
   - No own header (no back arrow, no trip photo/title row). The header's trip-tap
     action is dropped.
   - Chat search opens via an imperative handle (`ref.openSearch()`) or a
     `searchRequestKey` prop.
   - Same keyboard behavior as today: when the keyboard opens, the header and tab bar
     **stay** and the message list gets shorter. Its keyboard/offset math assumed a
     full-screen card with its own header, so re-check the offsets on iOS and Android.
8. **Leaving the tab unmounts the chat**, exactly like popping the chat card today.
   `chatHistoryCache` makes coming back instant. It reopens at the newest message, and
   the typed text is not kept.
9. While the Chat tab is active, call `setCurrentConversationId(convId)` and clear it on
   leave or unmount. This is the same pattern as `ChatCardScreen`
   (`RootNavigator.tsx:383`), so unread counts and banners are suppressed only while
   the chat is really visible.
10. Legacy trips with no conversation: create it lazily when the tab first opens, same as
    `handleOpenGroupChat` (`TripDetailScreen.tsx:1608`). While loading, show a spinner in
    the tab body. On error, show an inline error with a Retry button in the tab body, not
    an Alert.

### Removed / changed UI
11. Delete the floating "Trip Chat" CTA (`TripDetailScreen.tsx` ~3722) and its bottom
    clearance for chat-only viewers. The "Join a Trip" CTA for non-members stays.
12. The ⋮ menu "Trip Chat" item stays, but now calls `handleTabChange('chat')` instead
    of pushing a card. Like the tab, it now also shows on cancelled trips.
13. While on the Chat tab, the ⋮ menu gets **"Search chat"**. It opens `ChatSearchHeader`
    in place of the tab bar. Closing search brings the tab bar back.

### Departed users (read-only)
14. A departed user's Chat tab shows messages with `created_at <= left_at`. At the bottom,
    in place of the input, a bar says **"You're no longer on this trip."**
15. No send, react, edit, delete, typing indicator or realtime for them. The chat does not
    appear in their Messages list.
16. Rejoining (approved again) clears `left_at`, and the chat is fully live again.
17. If a departed user's local outbox has unsent messages for this conversation, drop them.
    Do not retry them forever (see Out of scope).

### Every entry point opens the tab
18. Add `'chat'` to `TripDetailFocus` (`notificationsService.ts:234`). Extend the
    `TripDetail` route params (`navigationRef.ts:18`) with an optional `chat` object:
    `{ targetMessageId?, sharedMedia?, reviewCommitment? }`. These are passed straight to
    the embedded chat.
19. Reroute every `pushRootCard('ChatCard', …)` whose conversation has
    `metadata.trip_id` to `pushRootCard('TripDetail', { tripId, focus: 'chat', chat })`:
    - `ConversationsScreen.tsx:226` (list tap and message-search results; `targetMessageId`)
    - `MessagingProvider.tsx:823` (in-app banner)
    - `AppContent.tsx:635` (push notification → `requestedChatCard`)
    - `AppContent.tsx:1588` (`handleOpenGroupChat`). This one is no longer needed from the
      trip page itself. Keep it for any other callers, rerouted.
    - `ShareToChatScreen.tsx:103` (`sharedMedia`)
    - `NotificationCenter.tsx:460` (`reviewCommitment: true`)

    Surftrip chats (`metadata.surftrip_id`) and DMs are unchanged.
20. If the same trip is already the top card, switch its tab instead of pushing a
    duplicate. If it's lower in the stack, push a new card (normal back behavior).
21. If the user can't see the Chat tab at all (never a member, or blocked by RLS), open
    the trip on Overview. No error.

## Server changes (one migration + backfill)

22. `conversation_members.left_at timestamptz null`.
23. **Trigger on `group_trip_participants`** (SECURITY DEFINER, pinned `search_path`):
    - When status moves to `'left'`/`'removed'`, or a row is DELETEd (peer trips), set
      `left_at = now()` on that user's row in the trip's conversation
      (`conversations.metadata->>'trip_id'`).
    - On approve or rejoin, upsert with `left_at = null`.

    - **Hosts:** any participant with `role = 'host'` gets an active row. Today, hosts
      added after the trip was created are never added to the chat (seen live on
      2026-09-23: 2 of 3 Operators on "El Salvador 26" have no row, so the button shows
      for them but the chat is empty and sends fail silently).
    - **Staff:** a trigger on `organized_trip_staff` (insert/update of `accepted_at`,
      `revoked_at`, `role_key`) adds an active row when the staff member is accepted,
      has an account, is not revoked, and their tier has `chat.participate`. It sets
      `left_at` when they're revoked or their tier loses the permission. A trigger on
      `organized_trip_staff_roles` does the same for every staff member when a tier's
      `capabilities` change.
    - If the trip has no conversation yet (legacy, created lazily), the triggers do
      nothing. Whoever creates the conversation must add all current hosts, active
      travelers and chat staff. Move the lazy creation into a SECURITY DEFINER RPC
      (`ensure_trip_conversation(trip_id)`) that does this.

    This moves the source of truth to the server. The client-side
    `removeConversationMember` calls in `leaveTrip` / `removeParticipant`
    (`groupTripsService.ts` ~1750, ~1889) are removed, and `addApprovedUserToTripChat`
    (~2427) is kept only as a fallback or removed.
    - **This fixes the bug:** today a co-host, staff member or co-operator removing
      someone deletes 0 rows (the RLS only lets `conversations.created_by` delete), so
      the removed person keeps full chat access.
24. RLS:
    - `is_user_conversation_member` / `is_conversation_member` now mean **active**
      (`left_at is null`). That covers INSERT, realtime topics and reactions.
    - New `messages` SELECT branch: the member row has `left_at is not null` and
      `messages.created_at <= left_at`.
    - `conversations` SELECT also allows departed members, so they can load the title.
    - Tighten the live `messages_update_sender` / `messages_delete_sender` to active
      members. Live has drifted from the repo here: today a departed user can edit or
      delete their old messages.
25. `getConversations` / `getConversationsUpdatedSince` exclude rows with `left_at` set.
26. **Backfill:**
    - Operator trips: for participants with status `left`/`removed` whose member row still
      exists, set `left_at` to their departure time.
    - For users with a chat row but no participant row on the trip (except staff, and the
      host via `host_id`), set `left_at = now()`.
    - Add missing active rows for every current host and every chat-permitted staff
      member (fixes the El Salvador 26 Operators).
    - Users whose row was already deleted get nothing back (no history). This is accepted.
27. Per project rules: diff each live function and policy before replacing it, apply via
    MCP `apply_migration` (never `db push`), GRANT EXECUTE on any new RPC, and re-check
    the ACL after `CREATE OR REPLACE`.

## Edge cases
- The keyboard is open when the user switches tab: dismiss it on tab change.
- A trip cancelled while the user is on the Chat tab: the chat keeps working (req 3).
- The user is removed while on the Chat tab: realtime stops. On the next focus or refetch
  the trip page sees departure and switches the input to the read-only bar. Sends in
  between fail and are dropped (req 17), not retried.
- Deep link with `targetMessageId` older than `left_at` for a departed user: works. Newer
  than `left_at`: open the chat at the bottom, with no jump.
- Android back while on the Chat tab: goes back (pops the trip card), like the other tabs.
- Web: the same layout. `DirectGroupChat` already runs on web.

## Files likely touched
- `src/components/trips/TripTabToggle.tsx`: `'chat'` tab + badge
- `src/screens/trips/TripDetailScreen.tsx`: tabs, chat body, CTA removal, menu, focus
- `src/screens/DirectGroupChat.tsx`: `embedded`, read-only mode, search handle
- `src/services/notifications/notificationsService.ts`: `TripDetailFocus`
- `src/navigation/navigationRef.ts`, `src/navigation/RootNavigator.tsx`: route params
- `src/screens/ConversationsScreen.tsx`, `src/context/MessagingProvider.tsx`,
  `src/components/AppContent.tsx`, `src/screens/ShareToChatScreen.tsx`,
  `src/components/notifications/NotificationCenter.tsx`: reroute
- `src/services/trips/groupTripsService.ts`, `src/services/messaging/messagingService.ts`:
  drop client chat-removal calls, filter `left_at`
- `src/services/messaging/messageOutbox.ts`: drop sends for departed conversations
- New migration in `supabase/migrations/`

## Out of scope (flag separately)
- `messageOutbox` retries forever on a permanent RLS error for all chats
  (`messageOutbox.ts:88-127`). Only the departed case is handled here.
- The `REPLACE_ALL` reducer keeps conversations missing from a fresh fetch
  (`conversationReducer.ts:340-349`), so removed chats linger in memory until restart.
- The live `conversation_members_delete` policy is not in any repo migration.

## Open questions
1. ~~Operator staff in the chat~~. Resolved 2026-09-23 (Ohad): anyone whose tier has
   `chat.participate`, and hosts missing from the chat get fixed and backfilled
   (req 3, 23, 26). This also closes "Staff are not in the group chat" in
   `docs/specs/operator-trips/staff-gaps-spec-and-plan.md:315`. Update that doc when
   this ships.
2. ~~Old media in a departed user's read-only history~~. Resolved 2026-09-23 (Ohad): it
   loads fine. No storage change is needed.
