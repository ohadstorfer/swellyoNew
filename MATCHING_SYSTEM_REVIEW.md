# User Matching System – Architectural & UX Audit

**Date:** February 2025  
**Scope:** End-to-end matching flow (entry → matching → result → post-match).  
**Codebase:** Traced; references are to real files and functions.

---

## 1. Executive Summary

The matching system lets users chat with an AI (Swelly), specify trip and surfer criteria, and receive a list of matched users. Matching runs **entirely on the client** after the edge function returns “finished” + extracted data. The edge function does **not** run matching; it only does LLM extraction and chat persistence. Two algorithm variants exist (V2/unified in `matchingService.ts`, V3 in `matchingServiceV3.ts`), toggled by `EXPO_PUBLIC_USE_V3_MATCHING`. There is duplicate surface area (`TripPlanningChatScreenCopy`, `swellyServiceCopy`) and metadata is passed via mutable array properties (`__needsConfirmation`, `__singleCriterion`, etc.). The flow works but has **critical** issues: client-side matching and DB access, no retries or idempotency for attach-matches, fragile state (e.g. `getPreviouslyMatchedUserIds(messages)` can be stale), and UX gaps (e.g. Send Message spinner never resets). The system is not ready for 10x scale without moving matching to the backend, hardening state and errors, and simplifying the codebase.

---

## 2. Architecture Overview

- **Entry:** User opens Trip Planning from Conversations (Swelly button). Rendered by `AppContent` → `TripPlanningChatScreen` (or `TripPlanningChatScreenCopy` in dev).
- **Chat:** `swellyService.startTripPlanningConversation` / `continueTripPlanningConversation` call Supabase Edge Function `swelly-trip-planning` (`/new_chat`, `/continue/:chatId`). Edge function uses OpenAI for conversation and extracts structured data; it does **not** call any matching logic.
- **Matching:** When the edge function returns `is_finished: true` and `data`, the **client** runs `findMatchingUsers` or `findMatchingUsersV3` in `TripPlanningChatScreen` (lines 774–777). These use the **client’s** Supabase client (anon key) to read `surfers` and compute matches in the app.
- **Persistence of matches:** Client calls `swellyService.attachMatchedUsersToMessage(chatId, matchedUsers, destination)` which hits `POST /attach-matches/:chatId`. The edge function finds the last assistant message and attaches `metadata: { matchedUsers, destinationCountry }`, then saves chat history. No use of `matching_users` table in the current flow.
- **History restore:** On load with `persistedChatId`, client calls `swellyService.getTripPlanningHistory(chatId)` (GET `/:chatId`), then restores `messages` and parses `metadata.matchedUsers` from assistant messages.
- **Post-match:** User taps “Send Message” on `MatchedUserCard` → `onSendMessage(userId)` → `handleStartConversation(userId)` in `AppContent`. That checks for an existing conversation via `messagingService.getConversations`, then either opens it or shows `ConversationLoadingScreen` and creates a new conversation, then navigates to DM.

**Key files:**

| Layer | File(s) | Role |
|-------|---------|------|
| UI | `src/screens/TripPlanningChatScreen.tsx` | Chat UI, triggers matching, handles single/partial/exact flows |
| UI | `src/components/MatchedUserCard.tsx` | Renders one match; Send Message / View Profile |
| UI | `src/components/AppContent.tsx` | `handleStartConversation`, `handleViewUserProfile`, trip planning state |
| UI | `src/components/ConversationLoadingScreen.tsx` | Shown when starting a new convo from trip planning |
| Service | `src/services/swelly/swellyService.ts` | Trip planning API: start/continue, attach-matches, get history |
| Service | `src/services/matching/matchingService.ts` | `findMatchingUsers`, `findMatchingUsersV2`; unified + V2 logic |
| Service | `src/services/matching/matchingServiceV3.ts` | `findMatchingUsersV3`; 4-layer algorithm |
| Service | `src/services/matching/matchQualityAnalyzer.ts` | `analyzeMatchQuality`, exact/partial classification |
| Edge | `supabase/functions/swelly-trip-planning/index.ts` | new_chat, continue, attach-matches, GET history |
| Types | `src/types/tripPlanning.ts` | `TripPlanningRequest`, `MatchedUser`, `MatchQuality` |

---

## 3. Flow Diagram (Text)

```
[User] → Conversations → Tap Swelly → TripPlanningChatScreen
         ↓
    useEffect: healthCheck, then startTripPlanningConversation(contextMessage)
         → Edge POST /new_chat → OpenAI → return_message + chat_id
         → setMessages([Swelly reply]), setChatId(...)
         ↓
[User types] → sendMessage() → continueTripPlanningConversation(chatId, { message })
         → Edge POST /continue/:chatId → OpenAI → return_message, is_finished, data
         ↓
    If is_finished && data:
         setMessages(..., "Finding the perfect surfers...")
         excludedUserIds = getPreviouslyMatchedUserIds(messages)   // ⚠️ uses current messages
         matchedUsers = findMatchingUsers(V3)(requestData, currentUser.id, excludedUserIds)  // client-side
         ↓
    Branch: __needsConfirmation && __singleCriterion? → ask "add more criteria?" (never true – not set)
         hasPartialMatches? → ask "show these?" → user says yes → show cards
         else → show exact matches or no-matches message
         ↓
    setMessages(..., matchesMessage with matchedUsers)
    onChatStateChange(chatId, allMatchedUsers, destination)
    attachMatchedUsersToMessage(chatId, matchedUsers, destination)  // fire-and-forget
         ↓
[User taps Send Message on card] → onSendMessage(userId) → handleStartConversation(userId)
         → getConversations() → existing? → setSelectedConversation → DirectMessageScreen
         else → setPendingConversation, setShowConversationLoading(true) → ConversationLoadingScreen
         → (create conversation) → handleConversationLoadingComplete → setSelectedConversation → DM
```

**Data flow (matches):**

- **Source of truth for “who was matched”:** In UI, derived from `messages[].matchedUsers` (and aggregated in parent state). On backend, stored in chat history as `metadata` on the last assistant message (attach-matches endpoint).
- **Excluded users for next run:** `getPreviouslyMatchedUserIds(messages)` – see Issues.

---

## 4. Identified Issues

### Critical

1. **Matching runs on client with direct DB access**  
   - **Where:** `TripPlanningChatScreen.tsx` lines 774–777 call `findMatchingUsers` / `findMatchingUsersV3`; both use `supabase.from('surfers').select('*')` (and related queries) from the client.  
   - **Why it’s critical:** Exposes full surfer table to the client; logic and data can be inspected or tampered with; every user runs heavy work (and can DoS by spamming); RLS is the only protection.  
   - **Recommendation:** Move matching to the edge function (or a dedicated backend). Use service role only on server; return only the list of matched user IDs + minimal display fields.

2. **Stale closure in `getPreviouslyMatchedUserIds(messages)`**  
   - **Where:** `TripPlanningChatScreen.tsx` line 770: `const excludedUserIds = getPreviouslyMatchedUserIds(messages);` inside `sendMessage`.  
   - **Why it’s critical:** `messages` is the state at the time the user sent the message. The flow then does `setMessages(prev => [...prev, userMessage, botMessage])` and later more `setMessages`. The matching block runs in the same tick and still sees the **old** `messages`, so it does not include the current turn’s matches in exclusions. If the user gets two “finished” responses in a row (e.g. double-tap or race), the second run might re-include users from the first.  
   - **Recommendation:** Compute excluded IDs from the **updated** message list that includes the latest assistant message (e.g. pass `[...messages, userMessage, botMessage]` or derive from `response` + previous state), or maintain a dedicated `Set<string>` of matched user IDs and update it whenever you append a message with matches.

3. **`matching_users` table unused**  
   - **Where:** Migration `20250127000000_create_matching_users_table.sql` creates `matching_users`; no code writes to or reads from it.  
   - **Why it matters:** No audit trail, no server-side idempotency or replay protection, and the design doc (server-side match storage) is not implemented.  
   - **Recommendation:** Either use it from the edge when you move matching server-side (write matches per chat_id/requesting_user_id/matched_user_id) or remove the table and migration if you decide not to persist matches server-side.

### High

4. **Attach-matches is fire-and-forget and not idempotent**  
   - **Where:** `TripPlanningChatScreen.tsx`: multiple places call `swellyService.attachMatchedUsersToMessage(chatId, ...).catch(...)` with no retry or user feedback.  
   - **Risk:** Network or 5xx can leave UI showing matches that are never stored; history restore then loses them. Duplicate calls (e.g. double-tap, re-render) can attach twice; edge logic “last assistant message without metadata” can attach to the wrong message if order changes.  
   - **Recommendation:** Retry with backoff (e.g. 2–3 times); consider idempotency key (e.g. hash of chatId + matchedUserIds + destination). Optionally show “Saving…” and “Saved” or a soft error “Matches might not be saved; try again.”

5. **MatchedUserCard “Send Message” loading never resets**  
   - **Where:** `MatchedUserCard.tsx`: `setIsLoading(true)` and `setLoadingAction('message')` on press; no `setIsLoading(false)` after navigation.  
   - **Impact:** Button can stay in loading state until unmount; confusing if user comes back.  
   - **Recommendation:** Reset loading when the parent signals “conversation opened” or on timeout (e.g. 3s), or unmount the card when navigating away.

6. **Single-criterion confirmation is dead code**  
   - **Where:** `TripPlanningChatScreen.tsx` (and Copy) check `(matchedUsers as any).__needsConfirmation` and `__singleCriterion`. These are **never set** in `matchingService.ts` or `matchingServiceV3.ts`.  
   - **Impact:** That branch never runs; single-criterion flows always get “exact” treatment. Either the feature was abandoned or the wiring was never completed.  
   - **Recommendation:** Either implement setting `__needsConfirmation` and `__singleCriterion` in the matching layer when there’s only one criterion and you want to ask “add more criteria?”, or remove the branch and related UI to reduce confusion.

7. **Double persistence path (AsyncStorage + backend)**  
   - **Where:** `tripPlanningStorage.ts` (AsyncStorage) is used in TripPlanningChatScreen only for **migration**: on restore, it loads AsyncStorage and calls `attachMatchedUsersToMessage` for each stored group, then clears AsyncStorage. Current flow only writes to backend via attach-matches.  
   - **Risk:** If attach-matches often fails, users have no local fallback anymore (AsyncStorage is cleared after migration).  
   - **Recommendation:** Either keep a local cache of “last matched users per chatId” and retry attach-matches on next open, or ensure attach-matches is reliable and drop AsyncStorage for matches.

### Medium

8. **Two algorithm implementations and env toggle**  
   - **Where:** `findMatchingUsers` (unified + V2) vs `findMatchingUsersV3`; toggle `EXPO_PUBLIC_USE_V3_MATCHING`.  
   - **Risk:** Long-term maintenance burden; behavior differs by env; hard to A/B test in a controlled way.  
   - **Recommendation:** Pick one path (e.g. V3), deprecate the other, and move toggling to server-side feature flags if needed.

9. **Duplicate screens and services**  
   - **Where:** `TripPlanningChatScreenCopy.tsx`, `swellyServiceCopy.ts`; `TripPlanningChatScreenCopy` references server-side matching that does not exist in the main edge function.  
   - **Risk:** Drift, bugs fixed in one place only, confusion.  
   - **Recommendation:** Remove Copy variants or clearly separate “experimental” and document; consolidate on one screen and one service.

10. **Metadata on array return type**  
    - **Where:** `matchingService.ts` attaches `__rejectedMatches`, `__destinationFilteredSurfers`, `__passedOtherFilters`, etc., to the returned array.  
    - **Risk:** Type-unsafe (`(matchedUsers as any).__...`), easy to break when changing return shape.  
    - **Recommendation:** Return a single object, e.g. `{ matches: MatchedUser[], rejected?: MatchedUser[], destinationFiltered?: ..., passedOtherFilters?: number }`, and use that in the UI.

11. **Error handling in sendMessage**  
    - **Where:** `TripPlanningChatScreen` catch for “Error finding matching users” shows a generic message and adds one error message to the thread; outer catch for “Failed to send message” only shows an Alert.  
    - **Risk:** User doesn’t know if the failure was “Swelly” vs “matching” vs network; no retry.  
    - **Recommendation:** Differentiate (e.g. “Couldn’t load matches” vs “Message didn’t send”) and offer “Try again” where appropriate.

12. **Partial-match confirmation uses fragile message matching**  
    - **Where:** When user confirms partial matches, the code finds the message to update by comparing `msg.matchedUsers.length` and `msg.matchedUsers[0]?.user_id` to `pendingPartialMatches` (lines 586–591).  
    - **Risk:** If there are multiple messages with the same length and first user, the wrong message could be updated; or none, triggering the fallback “create new message” and possible duplication.  
    - **Recommendation:** Store a stable message id or index when you create the “partial match question” and use that to update the exact message.

### Low

13. **MatchedUserCard `calculateDaysInDestination` shape**  
    - **Where:** `MatchedUserCard.tsx`: helper expects `destination_name`; `MatchedUser.destinations_array` in types is `{ country, area[], time_in_days }`. The card actually uses `user.days_in_destination` for display, so the helper may be dead or used with a different shape elsewhere.  
    - **Recommendation:** Align type and usage; remove or fix the helper.

14. **Rate limiting only in edge**  
    - **Where:** Edge function has in-memory rate limit per user; client has no throttling on send or on matching.  
    - **Risk:** User or script can trigger many match runs (each doing multiple Supabase queries).  
    - **Recommendation:** Add client-side debounce/disable send while loading; keep server-side rate limit and consider per-user limits on matching if moved to server.

15. **No explicit timeout on edge or fetch**  
    - **Where:** `swellyService` uses plain `fetch`; edge uses `serve()` with no explicit timeout.  
    - **Risk:** Long OpenAI or DB calls can hang the request; Supabase edge default timeout applies.  
    - **Recommendation:** Add `AbortController` with timeout (e.g. 60s) for trip-planning and attach-matches; return a clear “Request timed out” response.

---

## 5. UX Improvement Suggestions

- **Loading:** Keep “Finding the perfect surfers…” until matching completes; consider a progress hint if matching takes >2s.  
- **Empty state:** When there are zero matches, the no-matches message is generated by `analyzeNoMatchesReason`; ensure copy is clear and suggests relaxing filters or destination.  
- **Errors:** Distinguish “message not sent” vs “matching failed”; offer “Try again” and optionally “Edit your request.”  
- **Send Message:** After starting a conversation, give feedback (e.g. “Opening chat…” then navigate). Reset MatchedUserCard loading state when leaving or when conversation is ready.  
- **Partial vs exact:** Make it obvious when results are “close” matches (partial) vs “all criteria met” (exact).  
- **Restore:** If history load fails, show a short message and allow “Start over” instead of a broken thread.  
- **Accessibility:** Ensure buttons (Send Message, View Profile) and card content have proper labels and order for screen readers.

---

## 6. Technical Debt

- **Duplicate code:** TripPlanningChatScreenCopy, swellyServiceCopy; two matching algorithms.  
- **Metadata on arrays:** `__needsConfirmation`, `__singleCriterion`, `__rejectedMatches`, etc., should be a proper result type.  
- **Unused DB table:** `matching_users` created but never used.  
- **Long edge function:** `swelly-trip-planning/index.ts` is very large (~3200+ lines); hard to test and reason about. Split into routes/handlers and shared parsing/normalization.  
- **Mixed sync/async state updates:** Multiple `setMessages` in one flow (e.g. add user message, add bot message, add “Finding…”, then replace with results); easy to introduce races. Prefer one or two batched updates or a reducer.

---

## 7. Performance Risks

- **Client-side matching:** Loads all non-demo surfers (minus exclusions) then filters in memory in both matching services. With 10x growth this will be slow and heavy on the client and Supabase.  
- **No pagination:** `findMatchingUsers` / V3 do not paginate surfers; one big query.  
- **Re-renders:** Large `messages` array and many MatchedUserCards can cause expensive re-renders; consider virtualizing the message list or memoizing cards.  
- **Edge:** Single large file and long prompts increase cold start and execution time; splitting and trimming prompts will help.

---

## 8. Security Risks

- **RLS on `surfers`:** Matching reads all surfers (excluding current user and demo). If RLS is misconfigured, data could leak. Verify RLS policies and that the anon key cannot read more than intended.  
- **Auth on attach-matches:** Endpoint should verify that the authenticated user owns the chat (or is allowed to attach to that chat_id). Confirm that chat history is keyed by user and that no one can attach to another user’s chat.  
- **Rate limiting:** In-memory rate limit in the edge resets on cold start and is not shared across instances. For production, use a shared store (e.g. Redis/Upstash) or Supabase for rate limit state.

---

## 9. Refactor Recommendations

1. **Move matching to the server** (edge or backend): Accept `TripPlanningRequest` + `requestingUserId` + `excludedUserIds`; run `findMatchingUsers` or V3 server-side; return only match IDs and minimal display fields. Client then only displays and calls attach-matches with that list.  
2. **Single result type:** Replace “array + metadata” with `{ matches, rejected?, destinationFiltered?, passedOtherFilters? }` (and optional `needsConfirmation`, `singleCriterion`) and use it in the screen.  
3. **Stable exclusion set:** Maintain `previouslyMatchedUserIds: Set<string>` (or derive from latest messages after each update) and pass that into matching instead of relying on `getPreviouslyMatchedUserIds(messages)` at send time.  
4. **Attach-matches:** Retry with backoff; optional idempotency key; surface soft failure in UI.  
5. **Remove or implement single-criterion confirmation:** Either set `__needsConfirmation`/`__singleCriterion` in matching when appropriate, or remove the branch and copy.  
6. **Consolidate screens/services:** One TripPlanningChatScreen, one swellyService; remove Copy variants or gate behind a clear “experiment” path.  
7. **Split edge function:** Separate handlers for new_chat, continue, attach-matches, get history; shared parsing and normalization; smaller files and testable units.

---

## 10. Scalability Assessment

- **Current:** Suitable for small user bases. Matching and attach-matches are client- and single-instance edge; no horizontal scaling of matching logic.  
- **At 10x:** Client-side matching and full surfer fetch will not scale; must move to server-side matching with filtered queries, pagination, and possibly caching. Use `matching_users` (or similar) for audit and idempotency. Rate limiting should be shared across edge instances.  
- **Data flow:** Single source of truth for “matches for this chat” should be the backend (chat message metadata and/or `matching_users`); client should treat UI state as a cache that can be rehydrated from the server.

---

## 11. Action Plan (Prioritized)

| Priority | Action | Owner / Notes |
|----------|--------|----------------|
| P0 | Move matching to edge (or backend); stop reading full surfers from client | Backend/FE |
| P0 | Fix exclusion list: use updated messages or dedicated set so “previously matched” is correct | FE |
| P1 | Add retry and optional idempotency for attach-matches; show save failure if needed | FE |
| P1 | Reset MatchedUserCard loading state when conversation opens or after timeout | FE |
| P1 | Either implement or remove single-criterion confirmation and metadata | FE/Backend |
| P2 | Replace array metadata with a single result object type | FE |
| P2 | Consolidate to one matching algorithm and one screen/service (remove Copy) | FE |
| P2 | Use or remove `matching_users` table | Backend |
| P3 | Split swelly-trip-planning into smaller modules and add timeouts | Backend |
| P3 | Differentiate error messages and add “Try again” where appropriate | FE |
| P3 | Harden partial-match message update (stable id/index) | FE |

---

*End of audit.*
