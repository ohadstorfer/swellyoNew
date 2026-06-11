# R4 — Lineup / Messaging Navigation Inventory

> Scope: ConversationsStack, ConversationsScreen, DirectMessageScreen, DirectGroupChat,
> ConversationLoadingScreen, MessagingProvider, keyboard handling, DM open paths,
> web bypass, gesture config, AppContent wiring.
>
> Live as of: 2026-06-11, branch `eyal`.

---

## 1. Screen / Component Inventory

| ID | File | Type | Trigger | Close |
|----|------|------|---------|-------|
| C1 | `src/screens/ConversationsScreen.tsx` | Tab root (Lineup) | Always mounted when `shouldShowConversations` is true in AppContent | Never unmounts while app is in main flow |
| C2 | `src/screens/DirectMessageScreen.tsx` | Overlay / Stack screen | `selectedConversation` state in AppContent **or** `navigation.navigate('DirectMessage')` in ConversationsStack (native) | `onBack` → sets `selectedConversation = null` (AppContent path) or `navigation.goBack()` (Stack path) |
| C3 | `src/screens/DirectGroupChat.tsx` | Overlay / Stack screen | Same routing as C2; chosen when `isDirect === false` | Same as C2 |
| C4 | `src/screens/surftrips/SurftripDetailScreen.tsx` | Stack screen | `navigation.navigate('SurftripDetail')` from ConversationsStack; also `activeSurftripDetailId` in AppContent | `navigation.goBack()` (stack) or `setActiveSurftripDetailId(null)` (AppContent) |
| C5 | `src/components/ConversationLoadingScreen.tsx` | Full-screen overlay | `showConversationLoading` flag in AppContent; fires when a DM is initiated from ProfileScreen for a not-yet-created conversation | On animation complete → `handleConversationLoadingComplete()` |
| C6 | `src/screens/SwellyoTeamWelcome.tsx` | Early-return overlay inside ConversationsScreen | `showSwellyoTeamWelcome` local state; user taps "Swellyo Team" fake conversation row | `onBack` → `setShowSwellyoTeamWelcome(false)` |
| C7 | `src/screens/SwellyShaperScreen.tsx` | Early-return overlay inside ConversationsScreen | `showSwellyShaper` local state | `onBack` → `setShowSwellyShaper(false)` |
| C8 | `src/screens/ReportUserScreen.tsx` | Inline render inside DirectMessageScreen / DirectGroupChat | `showReportUser` local state in DM screens | `onBack` local handler inside the DM |

**Experimental / copy files (shadow live files):**
- `src/screens/TripPlanningChatScreenCopy.tsx` — shadows `TripPlanningChatScreen.tsx`. Currently rendered in AppContent behind `showTripPlanningChatCopy` flag. Wires DM open identically via `handleStartConversation`.
- No `-copy` variants exist for DirectMessageScreen, DirectGroupChat, or ConversationsStack. `DirectGroupChat.tsx` is structurally a near-duplicate of `DirectMessageScreen.tsx` (same 4950-line pattern, same keyboard/animation code) but is the **live** group chat screen, not a copy.

---

## 2. The Only Real Navigator: ConversationsStack

**File:** `src/navigation/ConversationsStack.tsx`

### Key facts

- Uses `createBlankStackNavigator` from `react-native-screen-transitions/blank-stack` (v3.4.0), **NOT** React Navigation's standard Stack or NativeStack.
- `enableNativeScreens={false}` — screens are plain React Native Views, not native `RNSScreen` containers. This is intentional; native screens broke the custom transition interpolator.
- `independent` prop is set — the stack has its own navigation context, separate from any ancestor navigator. This means `useNavigation()` inside stack children returns this stack's navigator, not AppContent's.
- Three routes: `ConversationsList`, `DirectMessage`, `SurftripDetail`.
- `DirectMessage` and `SurftripDetail` share the same `slideFromRightOptions` — translateX from `screen.width` to `0`, using `Transition.Specs.DefaultSpec`.

### Gesture config (exact)

```ts
gestureEnabled: true,
gestureDirection: 'horizontal',
gestureActivationArea: 'edge',   // ← left edge only; body swipes are claimed by per-message swipe-to-reply
transitionSpec: {
  open: Transition.Specs.DefaultSpec,
  close: Transition.Specs.DefaultSpec,
},
```

`gestureActivationArea: 'edge'` was added deliberately to prevent the full-screen swipe-back from conflicting with the per-message `SwipeToReplyWrapper` gesture (which lives on message bubbles in the body of the chat).

### Web bypass

```ts
if (Platform.OS === 'web') {
  return <ConversationsScreen {...props} stackScreenFocused />;
}
```

On web, **the inner stack does not exist at all.** `ConversationsScreen` renders directly. DMs on web go through the `selectedConversation` state path inside `ConversationsScreen` itself (early-return render). There is no push navigation on web.

### Context exposed to children

`ConversationsStackContext` (created in this file, not a separate file) provides:
- `navigateToDM(params: DMNavParams)` — calls `setCurrentConversationId` then `navigation.navigate('DirectMessage', params)`
- `closeDM()` — clears `currentConversationId`, calls `navigation.goBack()`
- `navigateToSurftripDetail(groupId)` — `navigation.navigate('SurftripDetail', { groupId })`
- `closeSurftripDetail()` — `navigation.goBack()`

The context is provided on `ConversationsListRoute` only (the root stack screen). DM and SurftripDetail screens do **not** consume it; they use `useNavigation()` directly.

---

## 3. AppContent Wiring — The Dual-Router Problem

AppContent has **two independent routing mechanisms** for DMs:

### Path A — ConversationsStack internal navigation (native only)
1. User taps a conversation row inside `ConversationsScreen`
2. `ConversationsScreen.openConversation()` checks if `stackCtx` (from `useConversationsStack()`) is non-null
3. If yes: calls `stackCtx.navigateToDM(params)` → `navigation.navigate('DirectMessage', params)`
4. DM screen is pushed onto the inner blank stack with a slide-right transition
5. `ConversationsScreen` **stays mounted** underneath

### Path B — AppContent `selectedConversation` overlay (used from Profile, TripPlanning, notification tap, and web)
1. `handleStartConversation(userId)` in AppContent is called (e.g., from ProfileScreen's `onMessage` prop)
2. AppContent sets `showConversationLoading = true` + `pendingConversation = {...}` — shows `ConversationLoadingScreen` immediately (prevents home flash)
3. Conversation is created in background; on completion `handleConversationLoadingComplete()` is called
4. AppContent sets `selectedConversation = { id, otherUserId, ... }` which triggers `activeOverlay` rendering of DirectMessageScreen/DirectGroupChat
5. `ConversationsStack` stays mounted underneath but is covered by the overlay

### The `stackScreenFocused` / `isListFrontmost` props

AppContent passes two flags into `ConversationsStack`:
- `isListFrontmost`: `true` only when no overlay (selectedConversation, tripPlanning, profile, etc.) is covering the stack. Used to gate the "surftrips tab tip" tutorial from firing while a DM overlay is open. This is passed **through ConversationsStack into ConversationsScreen** as a prop.
- `stackScreenFocused`: derived from `useIsFocused()` inside `ConversationsListRoute` — `false` when a DM or SurftripDetail is pushed on the inner stack. Distinct from `isListFrontmost` (which gates AppContent overlays). Both are ANDed in ConversationsScreen for tutorial gating.

### `selectedConversation` state shape (AppContent)

```ts
{
  id?: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean;
  tripId?: string;
  surftripId?: string;
  fromTripPlanning?: boolean;
  fromTripPlanningCopy?: boolean;
  fromWelcomeOverlay?: boolean;
}
```

The `fromTripPlanning` flag is used in `handleBackFromChat` to return to TripPlanningChatScreen instead of the conversations list when back is pressed.

---

## 4. MessagingProvider — State Owned, Mount Assumptions

**File:** `src/context/MessagingProvider.tsx`

### State owned at provider level (NOT screen-local)

- `conversations: Conversation[]` — useReducer, global list
- `loading: boolean`
- `hasMoreConversations`, `isLoadingMoreConversations`
- `currentConversationId` — via ref (`currentConversationIdRef`) + `setCurrentConversationId` function
- Supabase Realtime subscription to a per-user conversations channel (subscribed on mount)
- Per-conversation list subscriptions (one filtered channel per conv — `listSubsRef`)
- `messageOutbox` — persistent outbox for failed sends
- `chatHistoryCache` — in-memory + AsyncStorage message cache
- `avatarCacheService` — prefetch avatar pool

### What assumes screens stay mounted

1. **ConversationsScreen** deliberately avoids `useFocusEffect` for `refreshConversations` — the comment says: "refreshing on every navigation focus causes a delayed REPLACE_ALL that wipes scroll position after returning from a chat." AppState `change → active` is used instead. Unmounting and remounting ConversationsScreen would break this. It must stay mounted.

2. **DirectMessageScreen/DirectGroupChat** own their own Supabase Realtime subscription (`messagingService.subscribeToMessages`) in a `useEffect`. The cleanup function calls `messagingService.stopTyping()` and unsubscribes. These screens **must unmount cleanly** when navigating away — the subscription is not shared.

3. **MessagingProvider** subscribes to a conversations-list channel globally. This subscription is independent of any screen lifecycle. Safe to migrate.

4. The `setCurrentConversationId` in MessagingProvider is used to suppress unread count increments when the user is actively viewing a conversation. When DM is pushed on the inner stack, `ConversationsListRoute` calls `setCurrentConversationId(params.conversationId)` in `navigateToDM`, and `DirectMessageRoute` clears it on unmount via `useEffect` cleanup.

### Realtime subscription deduplication

Both the inner stack's `DirectMessageRoute` **and** `DirectMessageScreen` itself call `setCurrentConversationId`. The stack wrapper sets it before push; the screen sets it again on mount. On cleanup the screen clears it to `null`. There is no conflict but a migrator must preserve this ordering.

---

## 5. Keyboard Handling — The Core Constraint

### The problem (verbatim from code comment)

> "Bypasses the measureLayout-based KAV which breaks when nested inside **react-native-screen-transitions' transformed ContentLayer**. height is negative when keyboard is open on iOS → use abs for padding."

### The solution (both DirectMessageScreen and DirectGroupChat)

```ts
const { height: kbHeight, progress: kbProgress } = useReanimatedKeyboardAnimation();
const animatedKeyboardPadding = useAnimatedStyle(() => ({
  paddingBottom: Math.round(Math.abs(kbHeight.value)),
}));
```

This replaces `KeyboardAvoidingView` entirely. The chat messages area's `paddingBottom` tracks keyboard height as a Reanimated worklet value — no JS bridge, no `measureLayout`.

**Why it exists:** `react-navigation`'s standard KAV measures its Y position relative to the root to compute how much to shift. When the screen is inside a `translateX` transform (as in the blank-stack's slide animation), the Y measurement is skewed and the shift is wrong. The Reanimated approach skips position measurement entirely.

### Platform branches in keyboard handling

- **iOS:** `keyboardDismissMode="interactive"` on FlatList. No `KeyboardGestureArea` (causes phantom gap on iOS — see comment at line ~3862 in DirectMessageScreen).
- **Android:** `KeyboardGestureArea` wraps the chat area when not Expo Go, with `textInputNativeID` + `offset={composerHeight}` for 1:1 drag. FlatList gets `keyboardDismissMode="interactive"` only when `useGestureArea` is true.
- **Expo Go fallback:** `isExpoGo` check in `keyboardAvoidingView.ts` — `KeyboardGestureArea` and `KeyboardStickyView` are `null` in Expo Go. DM screens handle null by skipping the wrapper.

### The `composerHeight` measurement

Composer (`ChatTextInput`) reports its height via `onLayout` with a 2px tolerance to prevent stale re-renders propagating into `KeyboardGestureArea.offset`. This height is passed as the `offset` prop to `KeyboardGestureArea` so the gesture zone extends upward to cover the input.

---

## 6. Typing Indicators

- Typing state is screen-local: `[isTyping, setIsTyping]` in DirectMessageScreen / DirectGroupChat.
- Driven by `messagingService.subscribeToMessages` → `onTyping(userId, isTyping)` callback.
- Outgoing typing: debounced in `typingDebounceRef` (fires `messagingService.startTyping`) + 3-second auto-clear via `typingTimeoutRef`.
- Failsafe: 4-second timeout (`typingFailsafeRef`) clears `isTyping` if no explicit `false` arrives via Realtime.
- The typing indicator **feeds the incoming-message bubble's entering animation**: when a real message arrives, `setIsTyping(false)` is called immediately in `onNewMessage` so the animation calculates from the correct anchor point (if the indicator were still visible, the bubble's initial position would be shifted ~40dp and it would appear to slide the wrong way).

---

## 7. DM Open Paths

### From Lineup list (ConversationsScreen)

Native: `openConversation()` → `stackCtx.navigateToDM()` → `navigation.navigate('DirectMessage', params)`
Web: `openConversation()` → `setSelectedConversation(sel)` (no stackCtx on web)

### From ProfileScreen ("Message" button)

AppContent: `handleStartConversation(userId)` → check if conversation exists → if yes, set `selectedConversation` directly; if no, set `showConversationLoading=true` + `pendingConversation` → `ConversationLoadingScreen` animates → on complete, sets `selectedConversation`.

This path always goes through AppContent's `selectedConversation` overlay, **bypassing ConversationsStack**.

### From TripPlanningChatScreen / TripPlanningChatScreenCopy

Same as ProfileScreen: `onStartConversation={handleStartConversation}` in AppContent. Goes through overlay path. `fromTripPlanning: true` flag is set on `selectedConversation` so back-press returns to trip planning instead of conversations list.

### From notification tap (push notification)

AppContent receives `pendingNotificationConversationId` from the notification handler. This is passed as a prop into `ConversationsStack` → `ConversationsScreen`. ConversationsScreen has a `useEffect` that watches `pendingNotificationConversationId` and calls `handleConversationPress(conv)` once conversations are loaded. On native this triggers `stackCtx.navigateToDM()` (inner stack push). On web it triggers `setSelectedConversation`.

### From SurftripDetailScreen ("Chat" button inside group detail)

In the inner stack: `SurftripDetailRoute` calls `navigation.navigate('DirectMessage', { ..., isDirect: false })` on `onOpenChat`.
In AppContent: `handleOpenSurftripChat()` sets `selectedConversation` with `surftripId`.

---

## 8. ConversationLoadingScreen

- **File:** `src/components/ConversationLoadingScreen.tsx`
- **Role:** Full-screen animated overlay shown while a new conversation is being created (async). Prevents the home screen from flashing when the profile closes and the DM isn't ready yet.
- **Trigger:** `showConversationLoading && pendingConversation` branch in AppContent's `activeOverlay`.
- **Close:** Calls `onComplete` callback which triggers `handleConversationLoadingComplete()`, which sets `selectedConversation` from `pendingConversation` and clears `showConversationLoading`.
- **Not a navigation screen** — it's a component, no route params.

---

## 9. What Breaks If ConversationsStack Screens Become Root Native-Stack Cards

### 1. KAV / keyboard handling breaks immediately

`DirectMessageScreen` and `DirectGroupChat` both explicitly document that they bypass `KeyboardAvoidingView` because it fails inside react-native-screen-transitions' **transformed ContentLayer**. A standard `react-navigation` NativeStack uses `RNSScreen` (native containers) instead of JS transforms. The existing `useReanimatedKeyboardAnimation` + manual `paddingBottom` approach would **still work** in a NativeStack (the worklet doesn't care about transforms), but the code comment and the import guard (`KeyboardStickyView` comment in `keyboardAvoidingView.ts`) must be re-evaluated — they may no longer need the workaround, or a simpler KAV might work.

**Net result:** Keyboard handling likely still works (Reanimated approach is transform-agnostic), but the workaround can be simplified. No hard break.

### 2. The `independent` prop disappears — navigation context changes

ConversationsStack uses `independent` because it lives inside AppContent which has no navigator context of its own. In the new architecture, it would be a screen in the root NativeStack — `useNavigation()` would return the root navigator. The `ConversationsStackContext` (navigateToDM, closeDM) would need to be rewritten to use root-stack navigation.

**Net result:** `navigateToDM`, `closeDM`, `navigateToSurftripDetail` — all context functions — must be rerouted to root navigator calls.

### 3. `enableNativeScreens={false}` flag disappears

The flag was set to prevent native `RNSScreen` containers from interfering with the custom JS-driven translate interpolator. With a standard NativeStack, `RNSScreen` is the point — remove this concern. However, the `screenStyleInterpolator` in `slideFromRightOptions` is a react-native-screen-transitions specific API and does not exist in react-navigation NativeStack. The custom transition must be rewritten using NativeStack's `animation`, `customAnimationOnGesture`, or `animationMatchesGesture` props.

**Net result:** The slide-right animation and gesture must be re-implemented using NativeStack animation APIs. The `Transition.Specs.DefaultSpec` reference disappears.

### 4. `gestureActivationArea: 'edge'` is a react-native-screen-transitions API

There is no direct equivalent in react-navigation's NativeStack. The closest is `fullScreenGestureEnabled: false` (gesture only from edge) in react-navigation v7+ on iOS, but Android behavior differs. The edge-only constraint was added specifically to avoid conflict with `SwipeToReplyWrapper` — this constraint must be replicated or the swipe-to-reply gesture will fight with the back gesture on Android.

**Net result:** Requires careful gesture conflict resolution. The existing `gestureActivationArea: 'edge'` solution is specific to this library and must be replaced.

### 5. `stackScreenFocused` prop derived from `useIsFocused()` works differently

In the current setup, `useIsFocused()` on `ConversationsListRoute` returns `false` when `DirectMessage` or `SurftripDetail` is pushed. In a root NativeStack, the ConversationsList screen would be blurred/unfocused when a card is pushed above it — `useIsFocused()` would still return `false`. This prop would work identically.

**Net result:** No change needed here.

### 6. The dual-router (AppContent overlay vs. inner stack) must be unified

Currently, DMs opened from Profile/TripPlanning/notifications use the `selectedConversation` overlay path, while DMs from the conversations list use the inner stack push. In the migrated architecture, both should use the root NativeStack's push. This requires:
- Eliminating `selectedConversation` state and `ConversationLoadingScreen` overlay — replace with root-stack push with a loading state passed as route params or shown within the DM screen.
- `handleStartConversation` in AppContent becomes `navigation.navigate('DirectMessage', params)`.
- The `fromTripPlanning` back-navigation logic needs to become a navigation state (e.g. a `source` param that the DM screen uses to decide `navigation.goBack()` vs. `navigation.navigate('TripPlanning')`).

**Net result:** Medium-complexity refactor, not a trivial change.

---

## 10. What Depends on the `react-native-screen-transitions` Package

| Dependency | Where | Can be removed after migration? |
|------------|-------|---------------------------------|
| `createBlankStackNavigator` | `ConversationsStack.tsx:3-4` | Yes — replace with NativeStack |
| `Transition.Specs.DefaultSpec` | `ConversationsStack.tsx:45-46` | Yes — replace with NativeStack `animation` prop |
| `screenStyleInterpolator` (translateX worklet) | `ConversationsStack.tsx:48-68` | Yes — replace with NativeStack slide animation |
| `gestureActivationArea: 'edge'` | `ConversationsStack.tsx:43` | Yes — replace with NativeStack gesture config |
| The keyboard workaround comments referencing "transformed ContentLayer" | `DirectMessageScreen.tsx:399`, `DirectGroupChat.tsx:388`, `keyboardAvoidingView.ts:25` | Comments become inaccurate; the underlying `useReanimatedKeyboardAnimation` approach can stay or be simplified |

If ConversationsStack migrates fully to react-navigation NativeStack, `react-native-screen-transitions` would have **zero remaining consumers** and can be removed from `package.json`.

---

## 11. Platform-Specific Branches Summary

| Branch | Location | Behavior |
|--------|----------|----------|
| `Platform.OS === 'web'` | `ConversationsStack.tsx:72` | Skip inner stack entirely; render ConversationsScreen directly |
| `Platform.OS === 'web'` | `ConversationsScreen.tsx` (openConversation) | No stackCtx on web → use local `selectedConversation` state |
| `Platform.OS === 'web'` | `ConversationsScreen.tsx` (font styles) | Many `Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' }` inline overrides |
| `Platform.OS === 'android'` | `DirectMessageScreen.tsx:3868` | `KeyboardGestureArea` enabled only on Android dev builds |
| `Platform.OS === 'ios'` | `DirectMessageScreen.tsx:3925-3931` | `keyboardDismissMode="interactive"` without `KeyboardGestureArea` (phantom gap fix) |
| `isExpoGo` | `keyboardAvoidingView.ts:7-8` | `KeyboardGestureArea` = null; `KeyboardStickyView` = null; falls back to RN's built-in KAV |

No `.web.tsx` variant files exist for any messaging screen — platform logic is inline.

---

## 12. Landmines for the Migration Engineer

1. **The scroll-position comment is load-bearing.** `ConversationsScreen` explicitly avoids `useFocusEffect` for refresh to prevent REPLACE_ALL wiping scroll position on return from a DM. If the screen unmounts (which a NativeStack card would do when blurred unless `detachInactiveScreens={false}`), this comment's entire premise changes. The screen must remain mounted or the refresh strategy must change.

2. **Dual routing convergence.** Two different mechanisms open DMs today (inner stack push vs. AppContent overlay). A migration that converts only one but not the other will leave the app in a half-migrated state where DMs from the list use the new root stack, but DMs from Profile still show an `absoluteFill` overlay. This is functional but visually inconsistent and will be a source of subtle bugs.

3. **`ConversationsStackContext` is consumed inside `ConversationsScreen`.** `openConversation()` checks `useConversationsStack()` for a non-null context to decide which path to take. If the context provider moves or is eliminated, all conversation-open calls fall through to the `setSelectedConversation` local state path — which still works on native (it's the web path), but loses the stack push animation.

4. **`setCurrentConversationId` must fire on push AND on mount.** `ConversationsListRoute.navigateToDM()` calls `setCurrentConversationId(params.conversationId)` before the push, and `DirectMessageRoute` also calls it on mount via `useEffect`. Both must fire in the migrated setup to correctly suppress unread badge increments for the open conversation.

5. **`SwipeToReplyWrapper` gesture conflict.** Per-message swipe-to-reply uses `react-native-gesture-handler`. The `gestureActivationArea: 'edge'` constraint in the current blank-stack prevents the full-screen back gesture from conflicting. A NativeStack migration must replicate this constraint — the swipe-to-reply gesture claims horizontal pan touches in the message body, so the back gesture must be edge-only.

6. **`ConversationLoadingScreen` is not a route.** It's a component rendered as an AppContent overlay. In the migrated architecture this should become a loading state within the DM route itself (e.g., a loading view shown until `conversationId` is available) rather than a separate navigation layer.

7. **DirectGroupChat is a near-copy of DirectMessageScreen (~4950 lines each).** Both have identical keyboard handling. Any migration changes to keyboard behavior must be applied to both files identically.
