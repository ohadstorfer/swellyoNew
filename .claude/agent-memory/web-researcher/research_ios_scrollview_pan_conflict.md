---
name: iOS ScrollView + Pan GestureDetector — Slow Scroll Bug
description: Root cause and fix for inner ScrollView needing fast swipe when wrapped in a horizontal Pan GestureDetector (RNGH v2) on iOS
type: project
---

The symptom is: slow finger drags don't start scrolling inside a ScrollView that lives inside a `GestureDetector` with a horizontal `Pan` gesture. Only fast swipes work.

**Root cause**: `failOffsetY([-15, 15])` on the parent Pan gesture implicitly creates "wait for fail" semantics on iOS. The system puts the inner UIScrollView in a `require(toFail:)` relationship with the parent Pan recognizer. Until the Pan determines it has failed (the finger moved >15pts vertically), iOS holds the scroll gesture in a POSSIBLE state — it will not activate. Fast swipes cross the 15pt failOffsetY threshold quickly and release the scroll; slow drags stay in the activation window long enough for the scroll to feel blocked.

**Key facts**:
- This is an iOS-only issue. Android's gesture system doesn't use UIKit's require-to-fail chain.
- RNGH v2 GestureDetector wrapping RN core ScrollView creates this implicit dependency. The RNGH ScrollView (from `react-native-gesture-handler`) wraps with NativeViewGestureHandler, which participates in the RNGH gesture graph and handles this correctly.
- `activeOffsetX([15, 1000])` + `failOffsetY([-15, 15])` together mean: the Pan waits to see if movement is more horizontal or vertical. While it waits, the scroll is held pending.

**Correct fix — two-part**:

1. Import `ScrollView` from `react-native-gesture-handler` instead of `react-native` so the ScrollView participates in the RNGH gesture graph.

2. Add `.simultaneousWithExternalGesture(scrollRef)` to the Pan gesture, where `scrollRef` is a `Gesture.Native()` handle assigned to the ScrollView via `ref`. This tells RNGH that the Pan and the native scroll gesture are allowed to run at the same time — it breaks the blocking require-to-fail chain.

```tsx
// Pattern (RNGH v2 GestureDetector API):
import { ScrollView, Gesture, GestureDetector } from 'react-native-gesture-handler';

const nativeScroll = Gesture.Native();

const swipeGesture = Gesture.Pan()
  .enabled(!isSwipeDisabled)
  .activeOffsetX([15, 1000])
  .failOffsetY([-15, 15])
  .simultaneousWithExternalGesture(nativeScroll)
  .onUpdate(...)
  .onEnd(...);

// In JSX:
<GestureDetector gesture={swipeGesture}>
  <Animated.View>
    <GestureDetector gesture={nativeScroll}>
      <ScrollView>
        {/* content */}
      </ScrollView>
    </GestureDetector>
  </Animated.View>
</GestureDetector>
```

**Alternative if `simultaneousWithExternalGesture` is unreliable** (RNGH issue #3326 documents it being flaky when declared at parent level):
- Declare `blocksExternalGesture(panGesture)` on the *child* native gesture instead — putting the relationship declaration on the child is more reliable.
- Or: use `Gesture.Simultaneous(swipeGesture, nativeScroll)` and pass that to the outer GestureDetector.

**gorhom/bottom-sheet pattern (reference)**:
Bottom-sheet uses `BottomSheetScrollView` (RNGH ScrollView under the hood) and registers the scroll gesture explicitly with the sheet's pan gesture via RNGH's gesture graph. It does NOT use RN core ScrollView inside the sheet.

**react-navigation swipe-back reference**:
React Navigation solves this via `NativeViewGestureHandler waitFor={stackGestureRef}` wrapping the ScrollView. The modern equivalent is `Gesture.Native().simultaneousWithExternalGesture(navSwipeGesture)`.

**Applies to Swellyo**: ProfileScreen imports `ScrollView` from `react-native-gesture-handler` (already correct on line 47), but the `swipeGesture` Pan does NOT declare `simultaneousWithExternalGesture` with the scroll gesture. Adding `.simultaneousWithExternalGesture(nativeScroll)` on the Pan and wrapping the ScrollView with a `GestureDetector gesture={nativeScroll}` should fix slow-drag behavior.

**Why:** failOffsetY creates an implicit iOS require-to-fail chain that holds the scroll hostage until the pan direction is determined.
**How to apply:** When implementing or fixing a screen that has a horizontal swipe-to-dismiss gesture wrapping a ScrollView, always pair the Pan with simultaneousWithExternalGesture on the inner native scroll gesture.
