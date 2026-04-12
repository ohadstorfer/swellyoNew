---
name: Bottom Safe Area Insets — Android React Native
description: When to use useSafeAreaInsets vs SafeAreaView edges, patterns for fixed buttons/tab bars/chat inputs, double-padding gotcha, Android 15 edge-to-edge bottom=0 bug
type: reference
---

## Topic
Bottom safe area handling in React Native with react-native-safe-area-context, focused on Android navigation bar overlap and Expo SDK 54 / RN 0.81.

## Key Decision: SafeAreaView vs useSafeAreaInsets

**SafeAreaView with edges prop** — better performance (native measurement, no flicker). Best for wrapping screen-level content where you need predictable top+bottom coverage in one component.

**useSafeAreaInsets hook** — more granular control; necessary when you need to position absolutely-placed elements (FABs, overlays) or when you need to apply insets conditionally to non-View elements. Can flicker on first render.

**Never mix both on the same screen** — using SafeAreaView and useSafeAreaInsets together causes layout flickering because they may update at different times. Pick one per screen.

## Patterns by UI Element Type

### Fixed bottom button (full-width "Next", "Submit")
Use useSafeAreaInsets, apply paddingBottom to the button's container:
```tsx
const insets = useSafeAreaInsets();
<View style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
  <Button title="Next" />
</View>
```
The Math.max ensures minimum breathing room on devices with no inset (Android 3-button nav).

### Floating action button (absolute positioned)
```tsx
const insets = useSafeAreaInsets();
<TouchableOpacity style={{
  position: 'absolute',
  bottom: insets.bottom + 16,
  right: insets.right + 16,
}}>
```

### Bottom tab bar (React Navigation)
React Navigation's tab navigator ALREADY applies bottom safe area insets to the tab bar itself. Screens rendered inside tabs MUST NOT add a bottom inset — doing so creates double padding.
Pattern: use `edges={['top']}` only on screens inside tab navigators.

### Chat input bar at bottom
Use useSafeAreaInsets for paddingBottom on the input container. Do NOT wrap input in SafeAreaView with bottom edge — KeyboardAvoidingView and safe area interact badly. Apply the inset only when keyboard is not visible. See research_android_keyboard_chat.md for full keyboard handling.

### Screen with top-only SafeAreaView that needs bottom fix
Option A — change edges array: `edges={['top', 'bottom']}` on the existing SafeAreaView.
Option B — keep SafeAreaView for top, use hook for bottom on the specific bottom element.
Option B is preferred when the bottom element is absolute-positioned or a separate component.

## Android 15 / Edge-to-Edge Critical Issue

Expo SDK 54 enables edge-to-edge on Android automatically (via React Native's enableEdgeToEdge build.gradle). On Android 15 (API 35) devices, react-native-safe-area-context can return bottom=0 incorrectly. This is a known open issue (GitHub #546). Workaround: add a fallback minimum — `Math.max(insets.bottom, 16)` or `Math.max(insets.bottom, 0)` — but this does not fully solve it on affected devices. Monitor react-native-safe-area-context releases for fix.

## Common Mistakes

1. **Double bottom padding in tab screens** — screen uses SafeAreaView with bottom edge AND navigator already pads the tab bar.
2. **Mixing SafeAreaView + useSafeAreaInsets on same screen** — causes flicker.
3. **Not using edges prop at all** — default SafeAreaView applies all 4 edges; inside a stack navigator this adds unnecessary left/right insets on tablets.
4. **Hardcoding paddingBottom: 34** (iOS home indicator) — breaks on Android where the value is device-dependent and can be 0, 20, 24, or 48px.
5. **Wrapping entire screen in SafeAreaView for just the bottom** — wastes re-renders; only the bottom element needs the inset.
6. **Not accounting for bottom=0 on Android 15** — assuming insets.bottom > 0, then rendering nothing as padding on affected devices.

## Sources
- https://reactnavigation.org/docs/handling-safe-area/
- https://appandflow.github.io/react-native-safe-area-context/api/safe-area-view/
- https://github.com/AppAndFlow/react-native-safe-area-context/issues/546 (Android 15 bottom=0 bug)
- https://github.com/AppAndFlow/react-native-safe-area-context/issues/663 (Samsung Galaxy nav bar overlap)
- https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
- https://dev.to/dainyjose/edge-to-edge-styling-in-react-native-on-android-15-2ihd
