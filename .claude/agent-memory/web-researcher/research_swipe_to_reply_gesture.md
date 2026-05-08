---
name: Swipe-to-Reply Gesture — Chat Messages (WhatsApp style)
description: ReanimatedSwipeable vs hand-rolled Gesture.Pan for per-message swipe-to-reply; conflict with react-native-screen-transitions swipe-back; threshold/haptic/snap-back numbers
type: reference
---

## Recommended API in 2025

**Use `ReanimatedSwipeable`** (imported from `react-native-gesture-handler/ReanimatedSwipeable`).
- The legacy `Swipeable` is soft-deprecated; docs explicitly call ReanimatedSwipeable its "drop-in replacement, rewritten using Reanimated."
- Full prop list includes `enabled`, `renderLeftActions`, `leftThreshold`, `overshootLeft`, `friction`, `simultaneousWithExternalGesture`, `requireExternalGestureToFail`, `blocksExternalGesture`.
- `progress` and `translation` in renderLeftActions are SharedValues — drive icon opacity/scale directly on the UI thread, no runOnJS needed.

## Conflict with react-native-screen-transitions (this project's stack)

The project uses `react-native-screen-transitions` v3.4 (`blank-stack`) with `gestureEnabled: true` and no `gestureActivationArea` set (defaults to full-screen swipe-back).

**The cleanest fix: set `gestureActivationArea: "edge"` on the DirectMessage screen options.**
This restricts the nav swipe-back to the left screen edge (~20px zone), leaving the rest of the screen free for per-message swipe-right. The library exposes `gestureActivationArea: { left: "edge" }` for per-side configuration. This is the analog to React Navigation's `gestureResponseDistance: { horizontal: 20 }` — limits nav to edge-only, no RNGH composition needed.

**Backup option if gestureActivationArea doesn't fully work with blank-stack:** set `activeOffsetX` on the ReanimatedSwipeable. The underlying pan gesture won't activate until the finger has moved horizontally >N pts, so edge-starts that trigger nav will exit the swipeable before it activates.

## Conflict pattern with standard React Navigation (for reference)

For standard Stack.Navigator (not this project), the recommended fix is:
- `gestureResponseDistance: 20` in screen options (limits nav swipe to 20px edge zone)
- ReanimatedSwipeable handles the rest of the screen for message replies

## WhatsApp/Telegram UX numbers (community consensus)

- **Reply threshold**: 60–80 pts (WhatsApp appears to use ~70-75; Telegram similar)
- **Snap-back**: always snap back to 0 — ReanimatedSwipeable does NOT stay open; fire callback at threshold then immediately close via `swipeableMethods.close()` in `onSwipeableWillOpen`
- **Icon animation**: drive via the `progress` SharedValue in renderLeftActions. `interpolate(progress.value, [0, 0.5, 1], [0, 0, 1])` for opacity. Scale from 0.5 to 1.
- **Haptic**: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` via `runOnJS` when translation crosses threshold. One fire only (use a hasTriggered ref).
- **`overshootLeft: false`** — prevents user from pulling the bubble past the icon, keeping it WhatsApp-tight.
- **`friction: 2`** — adds resistance, makes it feel native. Default is 1 (no friction).
- **`leftThreshold`**: set equal to your reply threshold (e.g., 75) so the component "opens" at that distance and triggers `onSwipeableOpen`.

## Incoming-only constraint

`enabled={message.isIncoming}` on the ReanimatedSwipeable wrapper. Outgoing messages render without the Swipeable wrapper (or with `enabled={false}`).

## Known footguns

1. **`enabled={false}` doesn't reset position** — if a message switches from enabled to disabled mid-swipe, the bubble can freeze. Use a key prop or avoid toggling mid-render.
2. **GestureHandlerRootView required on Android** — if messages are inside a Modal, add a local RNGH root (already documented in project memory for Android modals).
3. **`onSwipeableOpen` fires AFTER open animation completes** — use `onSwipeableWillOpen` + `swipeableMethods.close()` inside it for instant snap-back feel.
4. **`dragOffsetFromLeftEdge: 10` (default)** — this is the minimum dead zone before the swipeable activates. Don't set to 0 — it will fight with the nav gesture.
5. **RNGH #3326**: `requireExternalGestureToFail` at the parent level is unreliable. Prefer `gestureActivationArea` on the navigator side to avoid needing gesture composition.
6. **react-navigation `fullScreenGestureEnabled`** + FlatList = broken on iOS 26 (RN issue #12760). Irrelevant for this project since it uses react-native-screen-transitions, not react-navigation stack.

## Project-specific notes

- This project uses `react-native-screen-transitions` v3.4 (`blank-stack`) — NOT standard React Navigation Stack.Navigator.
- The `slideFromRightOptions` in `ConversationsStack.tsx` has `gestureEnabled: true` but NO `gestureActivationArea`.
- Adding `gestureActivationArea: "edge"` (or `{ left: "edge" }`) to `slideFromRightOptions` is the first thing to try.
- The library exposes `useScreenGesture()` hook for coordinating custom pan gestures with nav gestures if the simple approach isn't enough.
- RNGH v2.28, Reanimated v3.15 — both support ReanimatedSwipeable with SharedValue-based renderLeftActions.

## Sources

- RNGH ReanimatedSwipeable docs: https://docs.swmansion.com/react-native-gesture-handler/docs/components/reanimated_swipeable/
- RNGH swipeable vs nav conflict (issue #890): https://github.com/software-mansion/react-native-gesture-handler/issues/890
- react-native-screen-transitions GitHub: https://github.com/eds2002/react-native-screen-transitions
- Telegram-style swipe reply article (Part 1): https://medium.com/@ravil.nell/react-native-chat-reply-on-swipe-like-in-telegram-9083f83f180c
- Gesture.Pan from scratch (manual activation pattern): https://medium.com/@varunkukade999/part-1-react-native-swipeable-item-from-scratch-powering-reanimated-3-rngh-60-fps-a9f0d660cb1d
- RNGH discussion #3042 (Apple/WhatsApp swipeable): https://github.com/software-mansion/react-native-gesture-handler/discussions/3042
- expo-haptics: https://docs.expo.dev/versions/latest/sdk/haptics/
