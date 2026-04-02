---
name: Blocking Feature Research
description: All touchpoints that need changes to implement user blocking (no blocked_users table exists yet)
type: project
---

Researched 2026-04-02. No blocking infrastructure exists. Key findings:

**DB tables relevant to blocking:**
- `surfers` — profile data; matching queries run against this table
- `conversations` / `conversation_members` / `messages` — messaging data
- `users` — auth-level user data
- No `blocked_users` table exists yet — must be created in Supabase

**Where to filter blocked users (client-side matching):**
- `src/services/matching/matchingService.ts`: `findMatchingUsers()` (line 880) already accepts `excludedUserIds?: string[]` parameter and filters in-memory. Blocked user IDs can be passed here directly — no structural change needed, just pass the list.
- `findMatchingUsersV2()` (line 657) does NOT have an excludedUserIds param — needs it added if used.

**Edge function (swelly-trip-planning):**
- Does NOT query `surfers` directly. It only extracts filters (returning `is_finished: true` + `data`). The actual DB query runs client-side in `matchingService.ts`. No edge function changes needed for blocking.

**Messaging — conversation list:**
- `src/context/MessagingProvider.tsx` manages `conversations` state via a reducer. Conversations are loaded via `messagingService.getConversations()` called inside MessagingProvider. Blocked users' conversations should be filtered from the `conversations` array after fetch — either in `getConversations()` or in the reducer/provider.

**Messaging — messages:**
- `src/services/messaging/messagingService.ts`: `getConversations()` (line 167) fetches all conversations where user is a member. No per-user filter exists. Add a `.not('other_user_id', 'in', blockedIds)` or post-fetch filter here.

**UI touchpoints:**
- `src/screens/ConversationsScreen.tsx`: renders conversations from `useMessaging()` context. Filtering in MessagingProvider is the cleanest approach — ConversationsScreen needs no changes if blocked convs are removed upstream.
- `src/screens/DirectMessageScreen.tsx`: has a commented-out three-dot menu button at line 1877 (`ellipsis-vertical` icon, commented out). This is the natural place to add a "Block user" action. A `MessageActionsMenu`-style sheet already exists for message actions — same pattern can be used for a conversation-level menu.
- `src/screens/ProfileScreen.tsx`: accepts `userId?: string` prop (line 42) for viewing other users. A block button could live in the profile header when `userId !== currentUser`.
- `src/screens/TripPlanningChatScreenCopy.tsx`: uses `<MatchedUsersCarousel>` (line 1655). Blocked users should be excluded before `matchedUsers` is passed to the carousel — handled upstream in `findMatchingUsers()` via `excludedUserIds`.

**How to apply:**
When implementing blocking, the cleanest data flow is:
1. Create `blocked_users` table in Supabase (blocker_id, blocked_id, created_at)
2. Load blocked user IDs once at app start (or on auth)
3. Filter at three layers: matching query (pass to `excludedUserIds`), conversation list (filter in MessagingProvider), and profile view (hide block-action on own profile)
