---
name: Android Edge-to-Edge — Expo SDK 54
description: How edgeToEdgeEnabled works in SDK 54, navigation bar behavior, safe area insets, version differences, Samsung S10, known bugs
type: project
---

## What edgeToEdgeEnabled does in SDK 54

- SDK 54 enables edge-to-edge **by default** for all new and existing Android projects
- The feature is now built into React Native 0.81 directly (no longer requires react-native-edge-to-edge library)
- Setting `edgeToEdgeEnabled: false` still works for Android 15 and below, but has NO effect on Android 16+
- Android 16 (API 36) has removed `windowOptOutEdgeToEdgeEnforcement` — there is no opt-out

## What it means for the navigation bar

- App draws behind both the status bar AND the navigation bar (system bars become transparent)
- Gesture nav bar: fully transparent, inset ~0-12dp
- 3-button nav bar: translucent scrim applied by default (semi-opaque), inset ~48-56dp
- `enforceNavigationBarContrast` in app.json controls whether the system auto-applies a scrim on 3-button nav

## Safe area insets

- `useSafeAreaInsets()` from `react-native-safe-area-context` is the correct tool
- Returns correct values IF edge-to-edge is properly enabled
- **Critical bug**: on Android 15 without edge-to-edge properly configured, bottom inset returns 0 (issue #546)
- On Android 13 and below, insets may also be 0 unless `edgeToEdgeEnabled=true` in gradle.properties
- Rule: always `paddingBottom: insets.bottom` on any screen with bottom content (tab bars, input bars, buttons)

## Android version breakdown

| Version | Behavior |
|---------|----------|
| Android 10-13 | Edge-to-edge optional; insets may be 0 without explicit enablement |
| Android 14 | Edge-to-edge optional but recommended |
| Android 15 (API 35) | Edge-to-edge enforced when targeting SDK 35; opt-out via `windowOptOutEdgeToEdgeEnforcement=true` still worked |
| Android 16 (API 36) | Edge-to-edge fully mandatory; opt-out removed entirely |

SDK 54 targets API 36, so all Android 16 devices = mandatory edge-to-edge regardless of app.json flag.

## Samsung Galaxy S10 navigation

- Ships with **3-button navigation by default** (Back, Home, Recents)
- Gesture nav must be manually enabled in Settings > Display > Navigation bar
- Practical impact: many real-world S10 users will have the 3-button bar visible and translucent (not transparent)
- 3-button inset = ~48-56dp; this content area needs paddingBottom applied

## Recommended approach for SDK 54

1. Keep `edgeToEdgeEnabled: true` (or let SDK default take over) — you cannot avoid it on Android 16 anyway
2. Use `useSafeAreaInsets()` on every screen that has bottom content
3. Apply `paddingBottom: insets.bottom` to the outermost container or the specific element at the bottom
4. For chat/input screens, use `react-native-keyboard-controller` (not KeyboardAvoidingView) — adjustResize is broken with edge-to-edge on Android 15+
5. Do NOT use SafeAreaView + useSafeAreaInsets together — can cause flickering

## Known issues in SDK 54

- `React Native Modal` overrides navigation bar transparency — makes it opaque again (expo issue #39749, open as of Sep 2025)
  - Workaround: use expo-router modal screens or React Navigation modal instead of raw RN Modal
- Bottom inset returns 0 on Android 13 and below when edge-to-edge not explicitly set in gradle
- `adjustResize` keyboard mode broken with edge-to-edge on Android 15+ — use `react-native-keyboard-controller`

## Key sources

- https://expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
- https://github.com/expo/expo/issues/39749 (Modal nav bar bug)
- https://github.com/AppAndFlow/react-native-safe-area-context/issues/546 (bottom inset 0)
- https://github.com/AppAndFlow/react-native-safe-area-context/issues/662 (Android 13 and below insets)
- https://github.com/react-native-community/discussions-and-proposals/discussions/827
- https://developer.android.com/develop/ui/views/layout/edge-to-edge
