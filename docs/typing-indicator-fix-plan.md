# Direct Messaging: Real-Time Typing Indicator – Fix Plan

## Current implementation (summary)

- **DirectMessageScreen**: Has `isTyping` state; passes `onTyping(userId, isTyping)` to `messagingService.subscribeToMessages()`. Sends typing via `messagingService.startTyping(conversationId)` / `stopTyping(conversationId)` in a debounced effect (300ms debounce, 3s auto-stop).
- **messagingService**: Uses a single Supabase Realtime channel per conversation (`messages:${conversationId}`). Listens for `broadcast` event `typing` and calls `onTyping(userId, isTyping)`. Sends typing with `channel.send({ type: 'broadcast', event: 'typing', payload: { userId, isTyping } })`.

## Issues identified

### 1. **Stale closure for `currentUserId` in `onTyping` (root cause)**

- The subscription is set up in an effect that depends only on `[currentConversationId, markAsRead, setMessagingCurrentConversationId]`. **`currentUserId` is intentionally not in the dependency array** (comment: "Removed currentUserId from deps").
- `currentUserId` is set asynchronously in a separate effect (after `getSession()` / `getCurrentUser()`).
- The `onTyping` callback is created when the subscription effect runs and **closes over `currentUserId` at that time**. If the subscription runs before auth has resolved, that value is `null` and never updates inside the callback.
- The code only shows the indicator when `currentUserId && userId !== currentUserId`. With a stale `null`, the condition is never true, so the other user’s typing is never shown.

**Fix:** Use a ref that always holds the latest `currentUserId`, and read from that ref inside `onTyping` instead of from the closure. No need to add `currentUserId` to the subscription effect deps or re-subscribe.

### 2. **Possible race when sending typing (weaker)**

- `startTyping` / `stopTyping` use `activeChannels.get(conversationId)`. That map is only updated when `subscribeToMessages`’s channel reaches status `SUBSCRIBED`.
- If the user types before the subscription is fully established, `activeChannels` has no channel, so the service creates a **new** channel, subscribes it, and sends the typing broadcast on that new channel. Both channels use the same name `messages:${conversationId}`. Supabase Realtime typically treats same-named channels as one logical channel, so this likely works, but in theory could cause duplicate or missed broadcasts in edge cases.
- **Recommendation:** Keep as-is for now; only revisit if typing still fails after fixing the closure. If needed, ensure a single channel per conversation (e.g. wait for existing subscription before sending typing, or reuse the same channel object).

### 3. **Supabase Realtime / config**

- Broadcast is a Realtime feature; the project must have Realtime enabled and (if applicable) no firewall/config blocking WebSocket.
- No code bug identified here; just something to verify if nothing is received at all.

---

## Plan (in order)

1. **Fix stale closure (implemented)**  
   - Add `currentUserIdRef` and keep it in sync with `currentUserId`.  
   - In the `onTyping` callback passed to `subscribeToMessages`, use `currentUserIdRef.current` instead of `currentUserId` when checking `userId !== currentUserId`.  
   - No change to effect dependencies; no re-subscription.

2. **Verify**  
   - Open a DM on two devices/emulators (different users).  
   - Type on one; the other should show the typing indicator.  
   - Stop typing; indicator should disappear (within debounce/auto-stop timing).

3. **Optional follow-ups (if still broken)**  
   - Confirm Supabase project has Realtime enabled and that broadcast is allowed.  
   - Add short debug logs (e.g. in `onTyping` and in `messagingService` broadcast handler) to confirm events are sent and received.  
   - Revisit channel lifecycle if there is any evidence of duplicate or missing channels.

---

## Files touched

- `src/screens/DirectMessageScreen.tsx`: add `currentUserIdRef`, sync it with `currentUserId`, and use it in `onTyping`.
