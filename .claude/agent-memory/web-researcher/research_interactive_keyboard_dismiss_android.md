---
name: Interactive Keyboard Dismiss — Android (KeyboardGestureArea)
description: How KeyboardGestureArea interpolator="ios" vs "linear" works on Android for chat screens; FlatList config; swipe-back conflicts; version gap vs v1.18.5
type: reference
---

## Platform scope — critical

`KeyboardGestureArea` is Android-only (>= Android 11). On iOS it renders as `React.Fragment` — iOS gets its dismiss from `keyboardDismissMode="interactive"` on the ScrollView natively. On Android < 11 it also renders as Fragment (no-op).

## interpolator="ios" on Android — what it actually means

"ios" on Android = keyboard only responds to a gesture when the finger TOUCHES the keyboard panel itself. Swipes through the message list (above the keyboard) do NOT drag the keyboard.

"linear" = any swipe anywhere inside the KeyboardGestureArea drags the keyboard proportionally — swipe down 20px anywhere = keyboard moves 20px. This is the "whole-list scroll-to-dismiss" pattern.

**For a chat app that wants WhatsApp/iMessage-style behavior on Android, "linear" is the correct choice.** The "ios" option on Android is actually MORE restrictive (you have to reach the keyboard panel), which is not what most chat apps do.

## What WhatsApp/Instagram/iMessage actually do

- iOS: full interactive dismiss via `keyboardDismissMode="interactive"` — keyboard follows finger anywhere in the list.
- Android (WhatsApp, Instagram native): drag from anywhere in the message list dismisses the keyboard — this matches "linear" interpolator behavior, NOT "ios".
- The "ios" Android behavior would only dismiss if you drag starting FROM the keyboard panel — that is not standard chat UX.

## Recommended setup for chat (v1.18.5)

Since v1.18.5 does NOT have KeyboardChatScrollView:

```tsx
<KeyboardGestureArea
  interpolator="linear"   // "whole list drags keyboard" — matches WhatsApp Android
  style={{ flex: 1 }}
>
  <FlatList
    keyboardDismissMode="interactive"  // still needed for the scroll view to report position
    inverted
    ...
  />
</KeyboardGestureArea>
```

Set `keyboardDismissMode="interactive"` on the FlatList — the library docs say this is required alongside KeyboardGestureArea for the gesture tracking to work correctly.

## v1.13+ offset prop

In v1.13+, `offset` on KeyboardGestureArea extends the "keyboard touch zone" downward to include the TextInput top border, so dismiss gestures can start from the composer input area, not just the keyboard panel itself. Useful with "ios" interpolator.

## Swipe-back conflict gotcha

No documented conflict between KeyboardGestureArea and React Navigation swipe-back on Android (Android uses a back button/gesture system, not a horizontal swipe-back like iOS). The conflict issue is iOS-specific (RNGH vs native swipe-back gesture).

## Input bar handling

The composer/TextInput bar does NOT need to be inside KeyboardGestureArea for the dismiss gesture to work. The gesture area just needs to wrap the scrollable content area where finger drag happens.

## Android 11 requirement

Builds targeting Android < 11 = no interactive dismiss (component renders as Fragment). This affects roughly 5-8% of Android users as of 2025. "on-drag" fallback is acceptable for those devices.

## Sources
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/views/keyboard-gesture-area
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/interactive-keyboard
- https://kirillzyusko.github.io/react-native-keyboard-controller/blog/release-1-13
- https://github.com/kirillzyusko/react-native-keyboard-controller/blob/main/example/src/screens/Examples/InteractiveKeyboard/index.tsx
- https://github.com/kirillzyusko/react-native-keyboard-controller/discussions/6
