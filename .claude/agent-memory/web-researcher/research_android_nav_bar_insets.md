---
name: Android Navigation Bar Insets — React Native / Expo SDK 54
description: Comprehensive guide to handling Android navigation bar (gesture/2-button/3-button) insets with edgeToEdgeEnabled, SafeAreaView vs useSafeAreaInsets, edges prop behavior, and bottom UI element patterns
type: reference
---

## What edgeToEdgeEnabled:true Does

Setting `edgeToEdgeEnabled: true` in app.json (or using Expo SDK 53+, which defaults to it) makes the app draw behind the system bars — both the status bar at the top AND the navigation bar at the bottom. Content can render beneath these bars. The app is responsible for applying its own inset padding to avoid overlap. In React Native 0.81 / Expo SDK 54, this is enabled via the `enableEdgeToEdge` build.gradle property. SDK 54 treats this as default-on.

## Navigation Mode Types and Inset Heights

Android supports three navigation modes, controlled by the user in system settings:

- **3-button nav** (triangle/circle/square): Taller bar, ~48dp inset. The classic Android buttons.
- **2-button nav**: A gesture handle + back button. Medium height, ~30dp inset.
- **Gesture nav**: A thin pill indicator at the very bottom. Smallest inset, ~24dp. Most modern phones default to this.

The inset value from `useSafeAreaInsets().bottom` reflects the actual mode the user has set — it is dynamic. Never hardcode navigation bar height; always read from the insets API.

## How react-native-safe-area-context Handles Bottom Insets

`react-native-safe-area-context` (RNSC) is the correct library to use. It reads native WindowInsets and exposes them to JS.

- **`SafeAreaProvider`** must wrap the root of the app (already the case if using Expo's default setup).
- **`SafeAreaView`** is a View that automatically applies insets as padding to all 4 edges by default.
- **`useSafeAreaInsets()`** hook returns `{ top, right, bottom, left }` as numbers (dp/points).

## The edges Prop (SafeAreaView)

`<SafeAreaView edges={['top', 'bottom', 'left', 'right']}>` — default is all edges.

You can pass a subset:
- `edges={['top']}` — only apply top inset (common for screens with navigation header already handling top, but content touching the bottom nav bar)
- `edges={['bottom']}` — only apply bottom inset (rarely the right choice for full-screen containers)
- `edges={['top', 'bottom']}` — applies both
- Omit `edges` entirely — applies all four edges

Edge modes: Each edge can be `'off'`, `'additive'` (default, adds inset to existing padding), or `'maximum'` (uses whichever is larger: safe area inset or your padding). Pass as object:
`edges={{ bottom: 'additive', top: 'off' }}`

## When to Use SafeAreaView vs useSafeAreaInsets Hook

**Use `SafeAreaView`** for full-screen containers where you want uniform inset padding on all (or most) edges. It is natively implemented so device rotation is handled instantly without JS bridge delay.

**Use `useSafeAreaInsets` hook** when:
- You only need a specific inset value to apply to a single element (e.g., a FAB button, a fixed bottom bar)
- You're building a custom component that needs to read the inset value to compute its own layout
- You're applying the padding to a sub-element, not the root container

**Do NOT use both together** on the same screen/component — they can cause double-padding and flickering, as they update at different times.

## Double-Padding Pitfall (Most Common Bug)

When you use `SafeAreaView` with default `edges` (all edges), it adds `insets.bottom` as padding to the container. If you then ALSO apply `paddingBottom: insets.bottom` inside that container on a child element, you double the padding. Result: too much space at the bottom.

Fix: use `SafeAreaView` for the outer container with `edges={['top']}` only, then apply `paddingBottom: insets.bottom` manually where you need it on the bottom element.

## Bottom inset = 0 Bug (Android 14/15, older RNSC)

`react-native-safe-area-context` versions before ~5.2.0 returned `bottom: 0` on Android 15 (targetSdk 35) with edge-to-edge enabled. This was a known issue tracked in issues #546 and #552. It was fixed via PR #590 ("Fix issues with inset calculation for apps targeting Android SDK 35+"). The fix landed in v5.2.0+. Expo SDK 54 ships RNSC ~5.6.0, which includes the fix. If `useSafeAreaInsets().bottom` returns 0 despite a visible navigation bar, confirm the library version is at least 5.2.0.

Workaround if still hitting 0: use `initialWindowMetrics` from RNSC instead of the hook, though this is a static snapshot from app launch.

## Best Practices for Specific UI Elements

**Full-screen containers (most screens):**
```tsx
<SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
  {/* content */}
</SafeAreaView>
```

**Screen with custom bottom bar / input bar (chat pattern):**
Use `edges={['top']}` on SafeAreaView, apply bottom padding manually to the sticky element:
```tsx
const insets = useSafeAreaInsets();
<SafeAreaView style={{ flex: 1 }} edges={['top']}>
  <ScrollView>...</ScrollView>
  <View style={{ paddingBottom: insets.bottom }}>
    {/* bottom input bar */}
  </View>
</SafeAreaView>
```

**Fixed "Next" button at the bottom of a screen:**
```tsx
const insets = useSafeAreaInsets();
<View style={{ position: 'absolute', bottom: insets.bottom + 16, left: 0, right: 0 }}>
  <Button />
</View>
```

**Tab bar (React Navigation):** React Navigation's bottom tab navigator handles the inset automatically. Do not add additional bottom inset padding to screens that are inside a tab navigator, unless the tab bar is hidden.

**Modal screens / full-screen overlays:** Modals in RN get their own root, so they need their own `SafeAreaProvider` or they inherit the parent's. Always wrap modals in `SafeAreaView` too.

## Device Manufacturer Differences

Android manufacturers apply their own navigation bar heights and defaults. The inset API abstracts this, but key practical differences:

- **Samsung**: Galaxy devices (especially S-series) often default to 3-button navigation even on flagship models. S24 FE has a confirmed bug where the native nav bar overlaps React Navigation tab bars — tracked in RNSC issue #663 and react-navigation issue #12727. The root cause is Samsung's custom window inset handling. Fix: ensure RNSC is on v5.2+ and use the `useSafeAreaInsets` hook rather than fixed values.
- **Pixel**: Defaults to gesture navigation since Android 10. Reports ~24dp bottom inset in gesture mode. Consistent behavior; fewest surprises.
- **OnePlus (OxygenOS)**: Reports 0 bottom inset on Android 15+ before RNSC 5.2 fix (reported in issue #634 with OnePlus 11R). With RNSC 5.2+, insets are correct.
- **Xiaomi (MIUI)**: Historically adds custom chrome around navigation bars. Generally follows Android inset APIs but MIUI-specific navigation overlays can cause incorrect inset reporting on older MIUI versions. Test on a physical device.

## Testing Bottom Insets Across Navigation Modes

In Android Studio Emulator: Settings > System > Gestures > System Navigation, switch between Gesture, 2-button, and 3-button to observe inset changes. Requires hot-reload or restart.

For physical device testing, the AVD (Android Virtual Device) with Android 15 has a known emulator bug where navigation bar mode changes may not take effect — use a physical device or Android 14 emulator to test mode switching.

Log insets during development:
```tsx
const insets = useSafeAreaInsets();
console.log('Bottom inset:', insets.bottom); // gesture ~24, 2-button ~30, 3-button ~48
```

## Minimum Fallback Value

The community does not recommend a fixed fallback because gesture navigation legitimately reports ~24dp, not 0. The RNSC 5.2+ fix ensures bottom=0 only occurs on devices that truly have no navigation bar (tablets with external keyboards, some landscape modes). A common defensive pattern seen in open source apps:

```tsx
const insets = useSafeAreaInsets();
const safeBottom = Math.max(insets.bottom, Platform.OS === 'android' ? 0 : 0);
// i.e., trust the insets — don't apply a fixed minimum
```

If you were on RNSC <5.2 (pre-fix era), the workaround was `Math.max(insets.bottom, 16)` but this is no longer needed with SDK 54 / RNSC 5.6.

## Existing Swellyo Patterns (observed in codebase, April 2026)

- `ChatScreen.tsx` and `DirectMessageScreen.tsx`: use `SafeAreaView edges={['top']}` + `useSafeAreaInsets()` hook for the bottom input bar area — this is the correct pattern.
- `OnboardingStep1Screen.tsx`: uses `SafeAreaView` (all edges) + also reads `useSafeAreaInsets()` for layout calculations — risk of double-counting on Android.
- `ConversationsScreen.tsx`: uses `Platform.OS === 'web' ? View : SafeAreaView` with no `edges` specified — applies all edges including bottom.
- Most other screens: use `SafeAreaView` with no `edges` (default = all edges) which is fine for simple screens.
