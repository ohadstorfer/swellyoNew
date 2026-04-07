---
name: expo-image-picker allowsEditing Android Issues
description: Known bugs with allowsEditing crop overlay not appearing on Android in expo-image-picker v17 / SDK 54, and workarounds
type: reference
---

## Summary

`allowsEditing: true` on Android has multiple known issues in expo-image-picker v17 (SDK 54).

## Core Issue

On Android, the crop overlay toolbar becomes blurred/invisible in light mode due to `expoCropToolbarColor` being set to `#00000000` (fully transparent). The crop screen may appear to open but actions are unusable. In dark mode, behavior is correct.

- GitHub issue: https://github.com/expo/expo/issues/40089
- Affects SDK 54 with expo-image-picker ~17.0.8

## Secondary Issue

Older-but-still-relevant: On Android, no "done/confirm" button is visible after crop, making it impossible to confirm selection. Issue #10583.

## Expo Go vs Dev Build

No confirmed difference documented. The issue appears in both. The crop UI on Android uses a native UCrop-based component configured via `colors.xml`.

## Workarounds

1. **Config plugin override** — use `withAndroidColors` to override `expoCropToolbarColor` to a visible color like `#ffffff`
2. **Switch to `react-native-image-crop-picker`** — works reliably on Android but requires a development build (not compatible with Expo Go or Managed workflow without EAS)
3. **Post-selection crop with `expo-image-manipulator`** — skip `allowsEditing`, let user pick, then manually crop using `ImageManipulator.manipulate()` with a crop region. This is the most Expo-native solution.
4. **Disable `allowsEditing` entirely** — remove crop from Android, apply it only on iOS via `Platform.OS === 'ios'`

## Recommended Path (Expo SDK 54, Managed workflow)

Use `expo-image-picker` with `allowsEditing: Platform.OS === 'ios'` and post-process crops on Android via `expo-image-manipulator`. This avoids the Android UCrop toolbar bug entirely.
