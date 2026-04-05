---
name: RNGH Custom Slider — Thumb Jump Bug
description: Root cause and fix for the "thumb jumps to 0" bug in custom RNGH + Reanimated sliders when touching the transformed thumb directly
type: project
---

## Root Cause: `translationX` vs `event.x`

The jump-to-zero bug is caused by using `translationX` in the pan gesture, combined with storing `thumbX.value` in `onStart`. When the user taps the thumb (which is positioned via `translateX`), the native gesture recognizer's coordinate origin shifts to where the finger landed on the *transformed* child — not the track origin. This means `startX.value + e.translationX` produces a value anchored to the wrong starting point.

The correct approach is to **not use `translationX` at all**. Instead, use `event.x` — the X position of the touch relative to the GestureDetector's parent View — combined with the track's measured width from `onLayout`.

## The Correct Pattern (verified from react-native-reanimated-slider source)

```typescript
const sliderWidth = useSharedValue(0);
const thumbX = useSharedValue(0); // stores 0..1 progress, OR raw pixel position

const pan = Gesture.Pan()
  .onStart((e) => {
    const clamped = Math.max(0, Math.min(e.x, sliderWidth.value));
    thumbX.value = clamped / sliderWidth.value; // normalize to 0..1
  })
  .onUpdate((e) => {
    const clamped = Math.max(0, Math.min(e.x, sliderWidth.value));
    thumbX.value = clamped / sliderWidth.value;
  })
  .onEnd((e) => {
    const clamped = Math.max(0, Math.min(e.x, sliderWidth.value));
    thumbX.value = clamped / sliderWidth.value;
  });

// On the track container View:
// onLayout={(e) => { sliderWidth.value = e.nativeEvent.layout.width; }}

// Thumb animated style:
// translateX: thumbX.value * (sliderWidth.value - KNOB_SIZE)
```

**Why `event.x` works and `translationX` doesn't:**
- `translationX` = accumulated movement since gesture start. Requires `startX + translationX` math. The issue is that `startX` gets anchored to the *thumb's rendered position in the transformed coordinate space*, not the track origin.
- `event.x` = absolute X position within the GestureDetector container, regardless of which child was touched. It's immune to the transformed-child coordinate confusion.

## Key Implementation Notes

- `onStart` must also set the value (not just `onUpdate`), otherwise tap-in-place without drag doesn't move the thumb.
- Clamp to `[0, sliderWidth.value]` in every handler to prevent out-of-bounds.
- Use `onLayout` on the GestureDetector's direct child (the track container) to measure `sliderWidth`.
- Guard against `sliderWidth.value === 0` on initial render to avoid negative clamp bounds.
- `pointerEvents="none"` on the thumb is not the issue and does not help with the coordinate problem.
- `GestureDetector` wrapping a regular `View` (not Animated.View) is fine.

## Why This Bug Only Triggers on the Thumb

When touching the track (not the thumb), the touch point roughly coincides with the thumb's logical position, so `startX + translationX` gives a result close to where the thumb was — looks fine. When touching the thumb directly, the touch coordinates are relative to the thumb's transformed position, and the gesture system can misinterpret the coordinate origin, making `translationX` start tracking from an incorrect anchor.

**Why:** Root-cause from RNGH github issues and Jellify slider source review.
**How to apply:** Any custom RNGH + Reanimated slider in this project should use `event.x` + `onLayout` pattern, not `startX + translationX`.
