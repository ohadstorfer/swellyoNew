---
name: RNGH Pan Gesture vs ScrollView Vertical Scroll Conflict
description: Root cause and fixes for horizontal Gesture.Pan wrapping a screen where vertical ScrollView slow-drag stops working on iOS
type: project
---

## Root Cause

A `Gesture.Pan()` wrapping the entire screen with `.failOffsetY([-15, 15])` is the problem. On iOS, the gesture system must decide which recognizer "wins" before any movement happens. The `-15 to +15` failOffset is so tight that even the natural micro-vertical wobble of a slow finger drag (which is rarely a perfectly horizontal movement) causes the Pan to begin evaluation and block the ScrollView from receiving the touch. With a fast flick the velocity carries the finger clearly horizontal before the Y drift hits the threshold, so the Pan fails cleanly and the scroll works. With a slow drag the finger wanders into the failOffset zone and the Pan takes ownership.

The **primary culprit** is the combination of:
- `GestureDetector` wrapping the full screen's `Reanimated.View`
- `.failOffsetY([-15, 15])` — threshold too tight for real-world slow finger drags
- The ScrollView from `react-native-gesture-handler` inside that GestureDetector without declaring a relationship to the outer Pan gesture

**Not the culprit**: `react-native-screen-transitions` / blank-stack. The swipe is implemented as a custom RNGH gesture, not via navigator gestureEnabled.

## Canonical Fix — Two-Part

### Part 1: Loosen failOffsetY

Change `.failOffsetY([-15, 15])` to `.failOffsetY([-30, 30])` or even `[-50, 50]`.
The 15pt threshold is too tight. Apple's own gesture recognizer uses ~10px but the finger wobble on a slow drag regularly exceeds that. Most community examples use 20-50.

### Part 2: Declare simultaneousWithExternalGesture

The RNGH ScrollView inside the GestureDetector needs to run simultaneously with the outer Pan. The ScrollView imported from `react-native-gesture-handler` is gesture-aware — use `.simultaneousWithExternalGesture()` to declare the relationship.

```tsx
const scrollRef = useRef(null);
const nativeGesture = Gesture.Native().withRef(scrollRef);

const swipeGesture = Gesture.Pan()
  .enabled(!isSwipeDisabled)
  .activeOffsetX([15, 1000])
  .failOffsetY([-30, 30])          // was [-15, 15] — too tight
  .simultaneousWithExternalGesture(nativeGesture)  // let ScrollView coexist
  .onUpdate(...)
  .onEnd(...);

const composedGesture = Gesture.Simultaneous(swipeGesture, nativeGesture);

// In JSX:
<GestureDetector gesture={composedGesture}>
  <Reanimated.View ...>
    <ScrollView ref={scrollRef} ...>  {/* RNGH ScrollView */}
```

### Simpler Alternative (if Part 2 is complex to wire up)

Just loosen the failOffsetY to `[-40, 40]` — this alone often fixes the problem because the Pan only activates when clearly horizontal and fails immediately on vertical intent. The ScrollView then takes over normally. Reported as working in multiple GitHub issues.

## iOS Native Mechanics (confirmed via research April 2025)

`failOffsetY` creates an **implicit `require(toFail:)` relationship** at the UIKit level. iOS puts the inner `UIScrollView`'s pan recognizer in POSSIBLE state until the outer Pan recognizer fails (i.e., moves >failOffsetY pts vertically). Fast swipes exit the failOffset zone quickly, releasing the scroll. Slow drags linger in the evaluation window long enough to feel blocked. This is iOS-only — Android doesn't use UIKit's require-to-fail chain.

## Reliability Warning on blocksExternalGesture

RNGH issue #3326 (Jan 2025, open): `requireExternalGestureToFail` and `blocksExternalGesture` declared at the **parent level** don't work reliably on either platform. **Workaround**: declare `blocksExternalGesture(panGesture)` on the *child* native gesture, not the parent. Or use `Gesture.Simultaneous()` at the top level.

## gorhom/bottom-sheet reference pattern

Bottom-sheet registers `BottomSheetScrollView` (RNGH ScrollView) and explicitly participates in RNGH's gesture graph via `simultaneousWithExternalGesture`. It does NOT use RN core ScrollView inside the sheet.

## Sources (GitHub issues)
- RNGH #1775 — horizontal gesture blocks vertical scroll
- RNGH #1933 — pan inside ScrollView blocks scrolling
- RNGH #2616 — hard to compose gestures with ScrollView
- RNGH #1658 — failOffsetY + activeOffsetX conflict
- RNGH #3049 — pan doesn't activate after scrolling on iOS (separate but related)
- RNGH #3326 — blocksExternalGesture/requireExternalGestureToFail unreliable at parent level
- react-navigation #8946 — StackNavigator swipe vs ScrollView

**Why:**
The slow drag symptom (only fast works) is the definitive signal that failOffsetY is too tight. It's not a velocity filter — it's the Y offset check triggering iOS's require-to-fail chain during slow deliberate drags.

**How to apply:**
For ProfileScreen.tsx: loosen failOffsetY first (one-line fix, confirmed safest), then add simultaneousWithExternalGesture if still needed.
