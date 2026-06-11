---
name: nav-keepalive-realtime
description: How native-stack keeps screens mounted, react-freeze behavior on websockets, Supabase Realtime reconnect on background/foreground, provider-vs-screen subscription pattern, scroll restoration, resumable chat — all in context of Swellyo's AppContent hand-rolled router migration path
metadata:
  type: reference
---

# Keep-Alive Screens + Realtime State in React Navigation Native-Stack

Researched June 2026 for Swellyo (RN 0.81 / Expo 54 / react-navigation v7 / Supabase Realtime).

## 1. Does native-stack keep screens below the top mounted?

**Yes, with a critical distinction between React tree and native view hierarchy.**

React Navigation never unmounts screens when navigating away — the React component tree stays alive. When you push screen B on top of screen A:
- Screen A's React state, refs, `useState`, scroll offsets: ALL survive untouched.
- Screen A's `useEffect` subscriptions: continue running (effects are NOT frozen or cleaned up).
- Screen A's Supabase Realtime WebSocket callbacks: continue firing.

However the *native view layer* (UIView/Fragment) of screen A IS detached by default:
- `detachInactiveScreens` defaults to `true` on native-stack — native views are removed from the view hierarchy to save GPU memory.
- `detachPreviousScreen` defaults to `true` for standard push (auto-set to `false` for transparentModal).
- This native detachment is ONLY a rendering optimization. It does NOT affect React state, refs, or JS-side effects.

**Implication for the three Swellyo keep-alive cases:**
- React state: stack default is already enough — no `display:none` needed for JS-side state.
- WebSocket subscriptions: stack default is enough — `useEffect` callbacks keep running even when native view is detached.
- Scroll position: preserved IF the screen stays mounted (which it does in a stack push). Caveat: FlatList scroll position can still jump on web (see section 5).

**Sources:** react-navigation Navigation Lifecycle docs; react-navigation Stack Navigator docs (detachInactiveScreens/detachPreviousScreen options); react-native-screens npm page.

## 2. react-freeze / freezeOnBlur: what exactly stops?

**Only renders stop. All JS side-effects continue.**

react-freeze uses React Suspense to replace the frozen subtree with a placeholder, preserving all React state. What this means:
- FROZEN: component re-renders, reconciliation work.
- NOT FROZEN: `useEffect` callbacks, `setInterval`, `setTimeout`, WebSocket message handlers, Redux selectors, Supabase subscription callbacks.

Confirmed by react-freeze README: "All state changes are executed as usual, they just won't trigger a render of the updated component until the component comes back from the frozen state."

`freezeOnBlur` defaults to `false` on native-stack. It auto-enables only if you call `enableFreeze()` from `react-native-screens` at app root.

**Known gotcha:** There is a confirmed open issue (react-native-screens #2972, June 2025) where `enableFreeze()` causes FlashList+WebSocket screens to show stale UI when returning — the WebSocket is still delivering data but the frozen component does not re-render after unfreeze. Workaround: set `freezeOnBlur={false}` on that specific screen/navigator, or avoid `enableFreeze()` globally for real-time screens.

**For Swellyo:** Do NOT call `enableFreeze()` globally. If you adopt native-stack and want freeze on non-chat screens, set `freezeOnBlur={false}` explicitly on AI-chat and DMs navigator/screen. Chat screens with live subscriptions must never be frozen.

**Sources:** react-freeze README (software-mansion/react-freeze); react-native-screens #2972 (FlashList+WebSocket freeze bug, June 2025); Software Mansion blog post on react-freeze.

## 3. Provider-above-navigator vs in-screen useEffect for realtime

**Unanimous community consensus: provider above the navigator is the correct pattern for production chat apps.**

The key principle: if the WebSocket connection lifecycle is tied to a screen component, navigating away = potential cleanup/remount = message loss or duplicate subscriptions.

Industry evidence:
- **SendBird React Native SDK**: wraps the entire app in `SendbirdChatProvider` at root. The connection is established once, persists across all navigation. Screens subscribe to channels but do not own the connection.
- **Stream Chat React Native SDK**: same — `OverlayProvider` + `Chat` provider wrap the navigator. WebSocket connection is managed at provider level.
- **Supabase Realtime pattern**: MessagingProvider (which Swellyo already has) is the correct approach. It sits above AppContent's routing and owns all channel subscriptions. Individual chat screens read from provider state rather than creating their own channels.

**Swellyo already does this correctly** — `MessagingProvider.tsx` is above AppContent's routing logic and manages all conversation state and subscriptions. This is the right architecture.

**Sources:** SendBird React Native SDK docs (SendbirdChatProvider); Ably "WebSockets React Native" article; WebSocket.org "WSContext and Components Subscription Pattern"; community blog post on provider pattern (stackademic.com).

## 4. Resumable chat: how pros handle "pop and reopen 2 min later warm"

There are three approaches. Pros use approach A or B, not C.

**A. Provider/cache holds state, screen is stateless (recommended)**
Screen pops but provider retains message array. When user reopens chat screen, it reads from provider state immediately — appears "instant warm." This is what WhatsApp and Telegram do architecturally. The screen is a view into a cache, not the source of truth.
- Implementation: MessagingProvider holds `conversations` map keyed by conversationId. Chat screen reads `conversations[id]`, shows immediately on mount even before any new fetch.
- React Query variant: `gcTime` (formerly `cacheTime`) set to e.g. 30 minutes — cached messages survive screen pop.

**B. Never pop the screen (current Swellyo approach with display:none)**
Works fine but costs memory. The main risk is the OS killing the app under memory pressure and losing state anyway. On iOS the OS will background-kill the whole app before selectively killing a single React component, so this risk is theoretical for 1-2 pinned screens.

**C. Pop and refetch on reopen (naive approach)**
Results in a loading spinner every time. Users notice. Avoid.

**Verdict for Swellyo:** If MessagingProvider already holds conversation message arrays (it does for DMs), then approach A naturally works — you can safely allow the AI chat screen to pop because its conversation history is in the provider. The `display:none` trick adds nothing for DMs since provider already holds state. For the AI chat screen (TripPlanningChatScreen), the conversation is local state in the screen — this is the one case where either keeping it mounted or lifting its messages into the provider makes sense.

## 5. Scroll restoration edge cases

**Native-stack (iOS/Android):** FlatList scroll position IS preserved when the screen stays mounted (which it does in a stack push). The React component including its internal scroll offset ref is alive.

**Caveat — FlatList scroll reset bug:** There is a long-standing issue (react-navigation #9733, multiple reports 2019–2024) where FlatList resets scroll when navigating back. This happens specifically when the screen REMOUNTS (tab navigator with `unmountOnBlur:true`, or navigation.replace). In a native-stack push/pop, the screen stays mounted and this bug does not trigger.

**inverted FlatList (chat):** `maintainVisibleContentPosition` helps prevent scroll jumping when new messages arrive at the top of an inverted list. It is iOS-native only. For Android support, use GetStream's `@sendbird/react-native-scrollview-enhancer` or Stream's `flat-list-mvcp` wrapper — both add Android `maintainVisibleContentPosition` support.

**Web platform:** `react-native-screens` `enableFreeze()` explicitly does NOT work on web (react-native-screens #1359). On web, react-navigation uses the JS stack, `detachInactiveScreens` defaults to `true` per a 2022 commit but screen state is still preserved via React's virtual DOM. However web scroll offsets in FlatList/ScrollView are more fragile than native — exact behavior depends on whether the DOM node is kept alive.

**Sources:** react-navigation #9733 (FlatList scroll position not maintained); GitHub GetStream/flat-list-mvcp; react-native-screens #1359 (web freeze not supported).

## 6. App background/foreground and Supabase Realtime reconnect

**Behavior on background:** Supabase Realtime WebSocket disconnects with `CHANNEL_ERROR` after ~3 seconds in background (expected — OS throttles network). On foreground return, it auto-attempts reconnect.

**Auto-reconnect reliability:** Mixed. Community reports (supabase/realtime-js #463, supabase/realtime #1088) show:
- Auto-reconnect usually works but can get stuck in `CLOSED`/`TIMED_OUT` loop.
- Calling `subscribeToChannel()` again on a `CLOSED` channel creates duplicate listeners and causes a fluctuation loop.
- The fix is always: `supabase.removeChannel(oldChannel)` first, then create a new channel and subscribe.

**Recommended AppState pattern for Supabase Realtime in React Native:**
```typescript
// In your provider or App root
useEffect(() => {
  const sub = AppState.addEventListener('change', nextState => {
    if (nextState === 'active') {
      supabase.auth.startAutoRefresh();
      // If channel status is CLOSED: removeChannel then resubscribe
      resubscribeIfNeeded();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
  return () => sub.remove();
}, []);
```

**Where this logic should live:** In MessagingProvider (which already owns all channel subscriptions), not in individual screens. AppState listener in the provider checks each channel's status on foreground and calls `removeChannel` + fresh subscribe if status is `CLOSED`.

**Supabase has no official documented pattern** for this on React Native — the guidance exists for web (heartbeatCallback, Web Worker) but the RN pattern is community-derived.

**Sources:** supabase/realtime-js #463 (Expo offline reconnect bug, closed as "not planned"); supabase/realtime #1088 (TIMED_OUT reconnect loop); supabase discussion #27513 (auto-reconnect after CLOSED); supabase discussion #19387 (idle reconnects, no official answer).

## Verdicts for the three Swellyo keep-alive cases

### Case 1: AI chat screen (TripPlanningChatScreen) — display:none to survive conversation + scroll + subscriptions

**Verdict: "stack default is enough" for subscriptions and scroll IF using react-navigation native-stack.**

If TripPlanningChatScreen is a card in a stack with `detachPreviousScreen: false` (or in a transparentModal presentation), React state + useEffect + scroll all survive. The `display:none` hack is not needed.

If the screen has local `useState` for the conversation that you want to survive a pop-and-reopen: either (a) lift the conversation array into a provider/context so it survives regardless, or (b) keep the screen mounted in a persistent stack slot. The current display:none approach works but is fragile — it bypasses React Navigation entirely.

### Case 2: Conversations list (DMs home) — mounted underneath for scroll preservation

**Verdict: "stack default is enough."**

In a native-stack, the conversations list screen below the active DM screen stays mounted and its scroll position is preserved. No display:none needed. The only scenario where scroll would be lost is if you use a tab navigator with `unmountOnBlur:true` (Swellyo doesn't appear to do this for DMs).

### Case 3: Realtime WebSocket subscriptions tied to mounted components

**Verdict: "needs provider lift" — but Swellyo already does this correctly.**

MessagingProvider already owns all Supabase Realtime channel subscriptions above the AppContent router. This is the right architecture and matches what SendBird and Stream Chat SDKs do. The missing piece is the AppState reconnect logic: when the app foregrounds, MessagingProvider should check each channel's status and `removeChannel` + resubscribe if `CLOSED`.

## React Navigation v8 Note

React Navigation v8 (alpha Dec 2025, no beta yet as of March 2026) introduces `inactiveBehavior` option with a `pause` mode that uses `React.Activity` to clean up subscriptions/timers on inactive screens. This would affect WebSocket subscriptions on paused screens. Do not upgrade to v8 until beta is out and this behavior is understood. Stay on v7 for now.

**Source:** react-navigation blog "8.0 March Progress Report" (March 2026).
