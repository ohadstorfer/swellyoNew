---
name: WhatsApp Send Animation — RN Reanimated v3 Patterns
description: How WhatsApp animates message send, best RN Reanimated v3 patterns, FlatList pitfalls, and 2-day recommended approach
type: project
---

## What WhatsApp Actually Does

Not officially documented. Based on UX analysis:
- No shared-element flight from composer to list. The bubble simply **appears at the bottom of the list** with a short entering animation.
- Input clears **synchronously on send** (before the animation plays). The message object is appended to state immediately.
- The entering effect is roughly: **fade + slight upward translate**, ~200ms, ease-out curve. No spring, no scale.
- The existing messages do NOT animate (no layout shift down). The inverted list naturally handles positioning.
- Tick mark (single gray) appears immediately — optimistic send. Confirmed by UX teardowns.

## RN Reanimated v3 Patterns

### Entering animation on the new bubble
- Wrap Animated.View (renderItem) with `entering={FadeInUp.duration(200)}` — the closest match to WhatsApp's feel.
- `FadeInUp` animates opacity 0→1 + translateY ~20px→0. Feels natural without being flashy.
- Do NOT use SlideInDown/SlideInUp on an inverted FlatList — known bug (issue #4450): animation flies off-screen once viewport is full.
- Do NOT use ZoomIn for chat — too bouncy, not messenger-like.

### Guarding against FlatList re-mount fires (critical)
FlatList unmounts items scrolled off-screen and re-mounts on scroll back — this re-fires `entering`. Fix:
- Track the item count at the time messages were first loaded in a `useRef` (e.g., `lastKnownCountRef`).
- In `renderItem`, only pass `entering` prop if `index < lastKnownCountRef.current` (i.e., it's a genuinely new message).
- Alternatively: `skipEnteringExitingAnimations` prop on Animated.FlatList wraps all items with LayoutAnimationConfig to suppress mount/unmount animations — but this kills ALL entering, so you still need the ref trick for the new message.

### LinearTransition for sibling push-down
- NOT needed for chat. Inverted FlatList handles layout naturally.
- If using a non-inverted list, `itemLayoutAnimation={LinearTransition.duration(200)}` pushes existing items down as new one appears.

### Shared element
- Overkill. Not how WhatsApp works. Don't use.

## Performance Notes

- Animating ONE item (the new message) is trivially cheap — no frame drop risk on any device.
- Animating many items simultaneously (e.g., initial load with entering) causes frame drops on Android lower-end devices (known issue #3854 — max ~30 elements/frame).
- Reanimated v3 layout animations run on UI thread — single bubble animation is safe.
- Development builds show worse perf than release; test on release build before worrying.

## Libraries

- No dedicated library for this specific effect. Always custom.
- `react-native-gifted-chat` has no built-in send animation — open issue #592 since 2017 with no resolution.
- `react-native-streaming-message-list` handles the scroll/snap problem for streaming AI responses, not the send animation itself.

## Pitfalls

1. **SlideInDown + inverted FlatList = animation flies off screen** once list is full (Reanimated #4450).
2. **Entering fires on FlatList re-mount** (scroll away then scroll back) — must gate with ref/index check.
3. **Input must clear synchronously** before animation — do not await anything before clearing text state.
4. **Android layout animation bug**: some Reanimated versions had FlatList layout animation not working on Android (issues #2737, #2770). FadeInUp entering works; itemLayoutAnimation is flakier on Android.
5. **New Architecture (Bridgeless) perf regression** on Android in Reanimated — reported in #7435. Release builds largely unaffected.

## Recommended Approach (2-day job)

1. Clear input text synchronously on send, push message to state immediately (optimistic).
2. In renderItem, pass `entering={FadeInUp.duration(200)}` conditionally (only when index >= pre-existing count tracked via useRef).
3. That's it. No LinearTransition needed (inverted list handles siblings). No shared element.
4. Use `FlatList.scrollToOffset({offset:0})` after state update to keep view at bottom.

## Sources

- Reanimated entering/exiting docs: https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/
- LayoutAnimationConfig docs: https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/layout-animation-config/
- SlideInDown inverted FlatList bug: https://github.com/software-mansion/react-native-reanimated/issues/4450
- Entering animation only for new items discussion: https://github.com/software-mansion/react-native-reanimated/discussions/6748
- Frame drop issue: https://github.com/software-mansion/react-native-reanimated/issues/3854
- Ghost component entering bug: https://github.com/software-mansion/react-native-reanimated/issues/4811
- Gifted-chat animation issue (no resolution): https://github.com/FaridSafi/react-native-gifted-chat/issues/592
