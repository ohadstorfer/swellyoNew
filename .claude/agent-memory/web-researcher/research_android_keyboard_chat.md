---
name: Android Keyboard Handling in React Native Chat Apps
description: windowSoftInputMode choices, edgeToEdge impact, KeyboardAvoidingView pitfalls, and recommended approach for Expo SDK 54 chat screens
type: project
---

## Summary

For Expo SDK 54 chat apps on Android, the combination of edgeToEdge + adjustResize is broken. The community-recommended solution is `react-native-keyboard-controller`.

## windowSoftInputMode

- Expo config key: `softwareKeyboardLayoutMode` (values: `resize` or `pan`)
- `resize` (adjustResize): Default. But **broken when edgeToEdge is enabled** — behaves like `adjustNothing` (no resize, no pan)
- `pan` (adjustPan): Pans the whole view up. Conflicts with `KeyboardAvoidingView` (double adjustment)
- `adjustNothing`: Only settable via config plugin (not Expo app.json), avoids all auto behavior

## edgeToEdge + Expo SDK 54

- SDK 54: edgeToEdge is default for all new projects
- Android 16+: edgeToEdge is forced — `edgeToEdgeEnabled` in app.json has no effect
- **Critical**: `adjustResize + edgeToEdge = adjustNothing behavior** — window does NOT resize, content does NOT move. You must handle keyboard manually.
- You must use `react-native-keyboard-controller` or manual `Keyboard.addListener` inset tracking

## Manual paddingBottom + Keyboard.addListener Pattern

- Fragile — double adjustment issues when combined with SafeAreaView or KAV
- Known issue: extra bottom padding persists after keyboard closes (RN issue #52596)
- Only recommended as fallback if `react-native-keyboard-controller` can't be used

## react-native-keyboard-controller (RECOMMENDED)

- Uses Android 11+ `WindowInsetsAnimation` API — frame-by-frame keyboard position
- Works correctly in edgeToEdge mode
- Has `KeyboardChatScrollView` specifically for chat UIs
- Drop-in `KeyboardAvoidingView` replacement from the library
- Requires **development build** (not supported in Expo Go)
- Expo has official docs: https://docs.expo.dev/versions/latest/sdk/keyboard-controller/

## For Bottom Tabs + Chat

- Set `softwareKeyboardLayoutMode: "pan"` in app.json, OR
- Use `tabBarHideOnKeyboard: true` on the tab navigator

## Samsung One UI

- No Samsung-specific documented issues found
- General Android timing bugs with SafeAreaView + KAV (double padding on first autofocus) affect all Android including Samsung
- Samsung keyboard may report height differently but no confirmed unique bug

## Dynamic behavior hook pattern (SDK 53/54 workaround)

Set KAV `behavior` to `undefined` when keyboard is hidden, `"height"` when shown — prevents black space. Works but is a hack vs. using keyboard-controller.

**Why:** adjustResize + edgeToEdge = adjustNothing starting Android 15/targetSdk 35
**How to apply:** For any chat screen in this project, prefer `react-native-keyboard-controller`. If not viable, use `softwareKeyboardLayoutMode: "resize"` + dynamic behavior hook.

## Sources
- https://docs.expo.dev/guides/keyboard-handling/
- https://docs.expo.dev/versions/latest/sdk/keyboard-controller/
- https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
- https://medium.com/@gligor99/fixing-keyboardavoidingview-issues-on-android-with-expo-sdk-53-29626fa9d9ce
- https://kirillzyusko.github.io/react-native-keyboard-controller/
- https://github.com/facebook/react-native/issues/52596
