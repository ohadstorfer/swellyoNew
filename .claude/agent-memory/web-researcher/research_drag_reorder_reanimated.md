---
name: Drag-to-Reorder — Reanimated v3 + Gesture Handler v2
description: Canonical pattern for smooth drag-reorder with handle-only activation, live row shifting, and snap-back-free commit. Absolute positioning, positions map, onEnd spring + runOnJS timing, onFinalize vs onEnd distinction.
type: reference
---

## Core Architecture: Absolute Positioning + Positions Map

Every row is rendered with `position: 'absolute'` and a `top` shared value derived from its current slot index times ITEM_HEIGHT. This is the only approach that survives array reorders without visual jump — because the visual position is driven by the shared value, not the flex layout.

A single `positions` shared value (object map of `id -> index`) is the source of truth. When the dragged item passes a threshold, `positions` is updated in-place on the UI thread via `objectMove()`. All non-dragged rows listen with `useAnimatedReaction` and animate their own `top` with `withSpring`.

## The "Stay Where You Dropped" Fix

The snap-back bug is caused by: item springs to new index slot, array reorders in React, row re-renders with a new `top` derived from the now-shifted slot — but if you reset `top.value` anywhere to `originalOffset`, it fights the spring mid-flight.

The canonical fix (from the eveningkid Apple Music gist):
```js
onFinish() {
  // Lock top to where positions map says we are NOW
  top.value = positions.value[id] * ITEM_HEIGHT;
  runOnJS(setMoving)(false);
}
```
Do NOT use `withSpring` in onFinish/onEnd to snap to the target — instead, set `top.value` directly (instant) to whatever the positions map already computed. The spring was the enemy.

Alternatively (computerjazz DraggableFlatList approach): spring the active item from its current drag offset TO `placeholderOffset - activeCellOffset`, then in the spring callback call `runOnJS(onDragEnd)`. The spring lands exactly on the target slot.

## onEnd vs onFinalize (RNGH v2)

- `onEnd`: fires only when the gesture was ACTIVE and completed (finger lifted). Put spring animation + runOnJS here.
- `onFinalize`: fires always (even on cancelled/failed gesture). Has a `canceled` property. Use it for cleanup/reset, NOT for commit logic.

Race condition: if you write to the same shared value in `onFinalize` that `withSpring` (started in `onEnd`) is animating, the spring gets cancelled and its `finished` callback receives `false`. This is why "callback never fires" — `onFinalize` runs immediately after `onEnd`, overwrites the shared value, cancels the spring.

Fix: put all spring + commit logic in `onEnd`. Use `onFinalize` only for things that don't touch animated shared values (e.g., resetting a `isDragging` boolean, re-enabling gesture).

## Long-Press Handle Pattern (RNGH v2 new API)

```js
const longPress = Gesture.LongPress().minDuration(200);
const pan = Gesture.Pan()
  .manualActivation(true)
  .onTouchesMove((e, stateManager) => {
    if (isDraggingActive.value) stateManager.activate();
    else stateManager.fail();
  });
const composed = Gesture.Simultaneous(longPress, pan);
// In LongPress onStart: set isDraggingActive.value = true
```
Only wrap the drag handle in the GestureDetector. The card body gets no gesture, so parent ScrollView scroll works normally.

## Live Shifting Pattern

In `onUpdate` of the pan gesture, compute `newIndex = clamp(floor((dragY) / ITEM_HEIGHT), 0, count-1)`. If it differs from the current index in the positions map, call `objectMove(positions.value, currentIndex, newIndex)` and reassign `positions.value`. Each other row's `useAnimatedReaction` picks this up and calls `withSpring` on its own `top` value. This is fully on the UI thread.

## Key Sources

- eveningkid Apple Music gist: https://gist.github.com/eveningkid/00dc171095eb6d64f45afdbaa50a76c3
- computerjazz DraggableFlatList (commit pattern): https://github.com/computerjazz/react-native-draggable-flatlist
- RNGH v2 callbacks doc: https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/callbacks-events/
- Varun Kukade Part 3 (positions map pattern): https://medium.com/@varunkukade999/part-3-react-native-drag-drop-list-60-fps-from-scratch-using-reanimated-3-rngh-a9d29ad43735
