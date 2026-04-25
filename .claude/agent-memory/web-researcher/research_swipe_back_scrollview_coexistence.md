---
name: Swipe-Back vs ScrollView Coexistence — iOS Native + RNGH
description: How major iOS apps (Telegram, WhatsApp, Instagram) handle horizontal swipe-back + vertical scroll conflict; native techniques and RNGH equivalents
type: reference
---

## How major apps handle swipe-back + ScrollView conflict

### Edge-only vs full-screen:
- **WhatsApp, Instagram, Threads, Signal, Slack, Discord**: Use Apple's default `UIScreenEdgePanGestureRecognizer` — edge-only (~20px from left). No conflict with scroll because it only triggers at the literal screen edge.
- **Telegram**: Famous for full-screen swipe-back. Uses a custom `UIPanGestureRecognizer` with a `gestureRecognizerShouldBegin` guard that checks the velocity/translation ratio (translation.x must dominate translation.y). Only activates when the gesture is "more horizontal than vertical."

### Native iOS technique for full-screen swipe + scroll:
1. **Translation ratio check in `gestureRecognizerShouldBegin`** — check `abs(translation.x) > abs(translation.y)` before allowing the pop gesture to activate. This is the Telegram-style approach.
2. **`gestureRecognizer:shouldRecognizeSimultaneouslyWithGestureRecognizer:`** — returning YES allows both recognizers to fire. When you want priority, DON'T use this; instead use #3.
3. **`require(toFail:)` chain** — the native scroll's panGestureRecognizer must fail before the custom pop gesture activates. This is the correct "priority" mechanism, not simultaneous.
4. **Content offset check** (FDFullscreenPopGesture pattern) — check `scrollView.contentOffset.x <= 0` before allowing simultaneous recognition. Only fires swipe-back if scroll is at left boundary.
5. **UIScreenEdgePanGestureRecognizer** — Apple's built-in solution. Avoids ALL scroll conflicts because it only activates from the literal screen edge (15-20px zone).

### The "slow drag doesn't scroll" bug root cause:
When `failOffsetY` is set too tight (e.g., [-15,15]), iOS enters a "wait for fail" chain — the system holds the gesture undecided until it's sure the pan recognizer has failed. For slow drags (low velocity), the undecided period is longer, causing the lag. Fast flicks resolve quickly because velocity clearly exceeds the threshold.

### RNGH equivalent patterns:
- `simultaneousWithExternalGesture(Gesture.Native())` = `shouldRecognizeSimultaneouslyWith` returning YES. Lets both fire at once.
- `failOffsetY` = the threshold before the pan gesture fails, triggering the require-to-fail chain.
- Loosening `failOffsetY` to [-40,40] reduces the undecided hold time for slow drags.
- `activeOffsetX` = minimum horizontal movement before the pan gesture activates (avoids false triggers on vertical starts).

### Confirmed working RNGH pattern (validated in this project, April 2026):
```
Gesture.Pan()
  .activeOffsetX([-10, 10])
  .failOffsetY([-40, 40])
  .simultaneousWithExternalGesture(nativeGesture)
```
Where `nativeGesture = Gesture.Native()` wraps the ScrollView.

### Key gotcha — fullScreenGestureEnabled in react-navigation:
As of iOS 26 / Xcode 26, `fullScreenGestureEnabled: true` conflicts with momentum scroll on FlatList/FlashList. React Navigation v7 issue #12760. The native recognizer now takes over and ignores the prop. Avoid relying on fullScreenGestureEnabled for screens with scrollable lists.

### Sources:
- FDFullscreenPopGesture: https://github.com/forkingdog/FDFullscreenPopGesture
- SloppySwiper: https://github.com/fastred/SloppySwiper
- RNGH issue #2616 (gesture + ScrollView composition): https://github.com/software-mansion/react-native-gesture-handler/issues/2616
- react-navigation issue #7132: https://github.com/react-navigation/react-navigation/issues/7132
- RNGH simultaneous pan+scroll Medium: https://medium.com/@taitasciore/handling-pan-and-scroll-gestures-simultaneously-and-gracefully-with-gesture-handler-2-reanimated-63f0d8f72d3c
- react-navigation issue #12760 (fullScreenGestureEnabled iOS 26): https://github.com/react-navigation/react-navigation/issues/12760
