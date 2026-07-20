---
name: project_root_card_stack_growth_and_chat_leak
description: Root-stack (RootNavigator) has zero dedup/cap on card pushes; ChatCard's subscribeToMessages is NOT focus-gated (unlike TripDetail/Surftrip/Notifications/Profile-video, which all correctly are) — confirmed 2026-07-18
metadata:
  type: project
---

Investigated 2026-07-18: "intermittent freeze, touches dead except native @bottom-tabs bar" after heavy navigation (trip -> chat -> profile -> trip -> chat ... cycling).

## 1. Root stack growth — CONFIRMED unbounded, every open is a push

- `pushRootCard()` in `src/navigation/navigationRef.ts:108-119` always does `navigationRef.dispatch(StackActions.push(name, params))`. Every internal navigation in `src/navigation/RootNavigator.tsx` (TripDetail -> EditTrip/TripUpdates/TripMembers/PackingAndGear/YourGear/ManageSuggestedGear/ManageGear/Commitment, TripMembers -> ProfileCard, NotificationsPanel -> TripDetail, SurftripCard -> ChatCard) also uses `navigation.dispatch(StackActions.push(...))`, never `navigate()`.
- The ONLY guard is a 700ms same-route+same-JSON-params double-tap defense (`DUP_PUSH_WINDOW_MS`, navigationRef.ts:105-117) — it does NOT dedup different routes or the same route with different params (e.g. a different `tripId`). No `popToTop`, no max-depth cap, no route-dedup exists anywhere in `src/` (grepped, zero hits).
- Conclusion: a user CAN build an arbitrarily deep stack (15-30+) by cycling trip -> chat -> profile -> another trip -> chat -> ...; nothing in the code prevents or collapses it.

## 2. Card mounting — default native-stack behavior, no freeze/detach opt-in

- `RootStack.Navigator` (`RootNavigator.tsx:630`) uses only `screenOptions={{ headerShown: false }}` — no `freezeOnBlur`, no `detachPreviousScreen`. `react-native-screens`' `enableFreeze()` is never called anywhere in `src/` (grepped). `react-native-screen-transitions` is NOT a dependency (checked package.json).
- Per `.claude/agent-memory/codebase-researcher/reference_nav_keepalive_realtime.md`-equivalent research (see `web-researcher` memory `research_nav_keepalive_realtime.md`): native-stack's default `detachInactiveScreens=true` only detaches the *native view* (GPU/render optimization) — the React tree, all `useState`/refs, and all `useEffect` subscriptions on covered cards stay fully alive and running indefinitely, for as long as that card sits anywhere in the stack.

## 3. Per-card-type resource audit result

**SAFE — correctly focus-gated (tear down on blur via `useFocusEffect`, not just on unmount):**
- `TripDetail` card -> `useTripRealtime` (`src/hooks/trips/useTripRealtime.ts:34`) — explicit doc comment explains WHY: "the card stack keeps every visited screen MOUNTED... a plain useEffect would hold this channel open forever and they'd pile up." This is the discipline instituted by the June 14 fix (commit `a03352f`, "perf: fix app-wide freeze from realtime channel pileup in card stack").
- `TripsScreen` (tab root, always mounted since `detachInactiveScreens=false` on the tab navigator) -> `useTripsListRealtime` (`src/hooks/trips/useTripsListRealtime.ts:43`) — same `useFocusEffect` pattern, plus `InteractionManager` deferral.
- `SurftripCard` -> `SurftripDetailScreen.tsx` — 3 separate `useFocusEffect` blocks (lines 156, 203, 227).
- `NotificationsPanel` -> `NotificationCenter.tsx` — 4 `useFocusEffect` blocks (lines 102, 195, 206, 256).
- `ProfileCard`/Profile tab -> `ProfileScreen.tsx:400-440` — the surf-clip `useVideoPlayer` is driven by `useIsFocused()`; explicit comment: "Pause the surf-level clip whenever this card isn't actually on screen... without this the muted, looping video would decode forever." Player is paused (not destroyed) on blur — correct.
- `TripMembers`/`PackingAndGear`/`YourGear`/`ManageGear`/`Commitment` cards — no own realtime channels or focus hooks; they just read react-query cache that TripDetail's `useTripRealtime` keeps fresh. Not a leak vector.

**LEAK — CONFIRMED NOT focus-gated (the anti-pattern a03352f explicitly fixed elsewhere, still present here):**
- `ChatCard` (`DirectMessageScreen.tsx` and `DirectGroupChat.tsx`, both routed by `ChatCardScreen` in RootNavigator.tsx:231-266) call `messagingService.subscribeToMessages(currentConversationId, {...})` inside a **plain `useEffect`**, not `useFocusEffect`.
  - `DirectMessageScreen.tsx`: effect body starts ~line 934, dep array at line 1322: `}, [currentConversationId, markAsRead, setMessagingCurrentConversationId, reconnectAttempt, otherUserId]);`. Cleanup (`unsubscribe()`, line 1289/1557) only fires on unmount or when one of those deps changes — NEVER on blur/cover.
  - `DirectGroupChat.tsx`: byte-for-byte the same pattern, dep array at line 1281 (identical deps), cleanup at lines 1246/1276.
  - `messagingService.subscribeToMessages` (`src/services/messaging/messagingService.ts:2447`) registers up to 6 listeners per channel (3 `postgres_changes` INSERT/UPDATE/DELETE in legacy/shadow mode + 3 `broadcast` new/update/delete in shadow/broadcast mode) via `getOrCreateConversationChannel` (line 2474), keyed by `conversationId` in `this.activeChannels` Map (line 306). Re-subscribing the SAME conversationId is handled cleanly (tears down `activeSubscriptions` first, line 2462-2466) — the leak is specifically across DIFFERENT conversationIds stacked simultaneously.
  - Net effect: **every distinct conversation ever opened as a ChatCard stays live-subscribed to Supabase Realtime for as long as that card remains anywhere in the (unbounded) root stack**, not just while visible. With N distinct chats opened during a heavy-navigation session, N channels + their listeners stay registered concurrently. This is architecturally identical to the pre-a03352f TripDetail bug, just never migrated to chat screens.
  - Secondary, same-severity-category bug: `ChatCardScreen`'s own `setCurrentConversationId` effect (`RootNavigator.tsx:238-241`) is also a plain (non-focus-gated) `useEffect` — the "currently open conversation" (used to suppress unread-badge increments) can point at a chat that's actually buried under other cards. Correctness bug, not itself a freeze cause.

## 4. Compounding factor — RAF loop tied to a known stuck-menu bug

`DirectMessageScreen.tsx:808-846` runs a `requestAnimationFrame` loop (re-measuring a message bubble's screen rect every frame via `measureInWindow`) gated on `[menuVisible, selectedMessage, currentUserId]` — correctly torn down when `menuVisible` goes false. BUT per `.claude/agent-memory/codebase-researcher/project_screen_freeze_overlay_audit.md`, `MessageActionsMenu.requestClose()` (`src/components/MessageActionsMenu.tsx:185-197`) only calls `onClose()` (the thing that sets `menuVisible` back to false) `if (finished)` — an `Animated.parallel(...).start()` callback that can resolve `finished:false` if interrupted, which is exactly what happens when a **new navigation push occurs mid-animation** (heavy navigation = frequent chance of colliding with an in-flight menu-close). If that happens on a covered ChatCard, both bugs compound: the menu's full-screen in-tree `TouchableOpacity` tap-catcher (not a Modal) stays mounted forever AND this RAF loop spins forever calling `measureInWindow` every frame on a screen the user can no longer see — pure wasted CPU, indefinitely, per affected covered chat card.

## 5. Ranked plausibility for "touches dead, only native tab bar survives"

1. **HIGHEST**: `MessageActionsMenu` stuck-open bug (pre-existing finding) becomes MORE likely to trigger under heavy navigation specifically because pushing a new card mid-close-animation is a realistic way to get `finished:false`. If the user later pops back down to that exact chat card, its full-screen tap-catcher is still there silently swallowing touches — matches the reported symptom (native tab bar, which lives outside the RN view tree, stays tappable) exactly.
2. **HIGH**: Unbounded live Realtime channel accumulation from ChatCard's non-focus-gated `subscribeToMessages` — not itself a touch-freeze mechanism, but is the same class of bug that caused the confirmed June 14 "app-wide freeze from realtime channel pileup" incident (a03352f), and independently degrades performance/battery/CPU the more distinct chats are opened during a session, making JS-thread stalls (and therefore #1's animation interruption) more likely.
3. **MEDIUM**: No cap on root-stack depth means both of the above scale directly with "how many screens deep" the user goes — this is the mechanism, not a separate cause. Fixing depth alone (e.g. capping stack depth or deduping by route) would reduce exposure to both #1 and #2 without fixing either root bug.

## Tooling note
No Bash tool was available in this research session — could not run `git show a03352f --stat` or `git log` to inspect the historical fix diff directly; conclusions above are based entirely on reading current source state and existing agent-memory notes referencing that commit.
