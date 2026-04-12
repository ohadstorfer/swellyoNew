---
name: Force LTR Layout — React Native / Expo
description: Best practices for forcing LTR layout in an English-only Expo RN app on RTL devices (Hebrew, Arabic). Covers I18nManager placement, restart requirement, AndroidManifest, native layer, and Expo config.
type: project
---

## Summary

Confirmed multi-layer approach required. No single JS call reliably covers all platforms and first-launch scenarios on its own.

## Layer 1 — JS module level in App.tsx (always do this)

Call unconditionally at module level (outside the component), not inside useEffect:

```ts
import { I18nManager, Platform } from 'react-native';
if (Platform.OS !== 'web') {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
}
```

Calling unconditionally (not just when `isRTL`) is safer — avoids missing the case where the cached state hasn't propagated yet on first install.

## Layer 2 — First-launch restart (critical for Android)

On Android, if the device is in an RTL language, the native layer applies RTL BEFORE the JS bridge loads. The module-level call above corrects the JS state and persists it, but the current render is already RTL. A reload is needed to apply LTR visually.

Pattern using expo-updates:

```ts
import * as Updates from 'expo-updates';

// In App.tsx at module level (before component):
if (Platform.OS !== 'web' && I18nManager.isRTL) {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
  // Reload once to apply. The `if (isRTL)` guard prevents infinite loop.
  Updates.reloadAsync();
}
```

The `if (isRTL)` guard is the key to avoiding the infinite reload loop that broke SDK 50 apps. Only reload when actually RTL.

## Layer 3 — Android native (most reliable, eliminates the reload need)

In `MainApplication.kt` (Kotlin), add before `loadReactNative(this)` in `onCreate()`:

```kotlin
import com.facebook.react.modules.i18nmanager.I18nUtil

override fun onCreate() {
    super.onCreate()
    // Force LTR before React Native loads
    I18nUtil.getInstance().allowRTL(applicationContext, false)
    // ... rest of onCreate
}
```

This fires before the JS bridge, so RTL never activates at all — no restart needed. This is the most reliable fix.

## Layer 4 — AndroidManifest.xml

`android:supportsRtl="false"` tells the Android OS not to mirror layouts for RTL locales. Combined with the native I18nUtil call, this provides OS-level enforcement.

Current project already has this set: `android:supportsRtl="false"` in AndroidManifest.xml at line 19.

## Layer 5 — iOS AppDelegate.swift

Swift equivalent (add before `super.application(...)` call in `didFinishLaunchingWithOptions`):

```swift
RCTI18nUtil.sharedInstance().allowRTL(false)
RCTI18nUtil.sharedInstance().forceRTL(false)
```

## Expo app.json — NOT needed for LTR-only apps

The `extra.supportsRTL` and `extra.forcesRTL` properties in app.json only apply when the `expo-localization` config plugin is installed and `supportsRTL: true` is explicitly set. Omitting them defaults to no RTL support. No change needed.

## What the current project has

- `App.tsx` lines 27-30: conditional `if (I18nManager.isRTL)` guard — GOOD but incomplete (missing restart)
- `AndroidManifest.xml` line 19: `android:supportsRtl="false"` — ALREADY SET, correct
- `MainApplication.kt`: no I18nUtil call yet — MISSING native layer
- `AppDelegate.swift`: no RCTI18nUtil call yet — MISSING native layer

## Key findings

- Module level (outside component) is correct; useEffect fires too late — layout already rendered
- `allowRTL(false)` alone is not enough on Android; `forceRTL(false)` is also needed
- The JS calls persist across subsequent launches (stored natively), so the restart is a one-time cost
- `android:supportsRtl="false"` helps but is not sufficient alone — RN has its own RTL system on top of Android's
- The SDK 50 infinite reload bug is caused by NOT having the `if (isRTL)` guard before calling `Updates.reloadAsync()`

**Why:** Eyal needed reliable LTR enforcement for an English-only app, specifically for Hebrew/Arabic device users.
**How to apply:** When implementing, add native layer to MainApplication.kt + AppDelegate.swift, keep module-level JS calls, and add the guarded reload.
