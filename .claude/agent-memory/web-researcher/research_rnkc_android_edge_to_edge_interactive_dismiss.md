---
name: RNKC Android Edge-to-Edge + Interactive Dismiss Known Issues
description: Specific GitHub issues for react-native-keyboard-controller v1.13-1.20 on Android — nav bar gap/padding bugs, KeyboardProvider translucent props, fixed in 1.21.5; no exact "progress stuck" issue found, root cause traced to edge-to-edge/translucency mismatch
type: reference
---

## Bottom line for Swellyo (v1.18.5)

The library is on v1.18.5, and the specific "extra bottom padding / input bar not flush with screen bottom on Android" bug (GitHub Discussion #984) was fixed in **v1.21.5** ("don't modify edge-to-edge mode by default when module toggled on/off"). v1.18.5 predates this fix — Swellyo is very likely hitting exactly this. Two options:
1. Upgrade to >= 1.21.6 (also gets KeyboardChatScrollView, see [[research_rnkc_chat_keyboard_sync]]).
2. Immediate workaround without upgrading: set `navigationBarTranslucent={true}` and `statusBarTranslucent={true}` explicitly on `<KeyboardProvider>` (see below) — this was the community workaround before 1.21.5 shipped a real fix.

## No exact "progress not returning to 0" issue found

Searched GitHub issues/discussions specifically for "progress stuck" / "height wrong after interactive dismiss" on Android — did not find an issue matching that exact framing. The closest matches:
- Issue #85 — progress value jumps between 0/1 instead of animating smoothly — but this was reported on **iOS** (iPhone 8 Plus, iOS 16), not Android.
- The Android-side symptom that IS well documented is not "progress stuck at nonzero" but rather **height calculation drift caused by translucency/edge-to-edge misconfiguration** (see below) — this produces the same visible symptom (input bar not flush with bottom, or floating above the nav bar) but via a different mechanism (wrong inset math, not a stuck shared value).

## Discussion #984 — Extra bottom padding on Android (KeyboardProvider) — closest match to symptom (b)

- **Symptom**: strange padding/margin at the bottom of screens on Android — "extra space between the navigation bar and the content above it." Reported on Xiaomi Mi 11, Xiaomi 13T (physical devices; not reproducible on Pixel 9 Pro emulator). Also noted on Android 9. Not on Honor 200. Not on iOS.
- **Root cause (maintainer explanation)**: `KeyboardProvider` auto-enables edge-to-edge mode. By default the library adds padding to fake standard (non-edge-to-edge) RN behavior. This synthetic padding sometimes conflicts with the real system-UI insets on certain devices/OEMs, especially when the app's own `StatusBar`/window flags don't agree with what the library assumes.
- **Workaround** (pre-fix, applies directly to v1.18.5):
  ```tsx
  <KeyboardProvider
    navigationBarTranslucent={true}
    statusBarTranslucent={true}
  >
  ```
  Also mentioned: add explicit `backgroundColor` to the `<StatusBar>` component; if top padding isn't a problem, `navigationBarTranslucent` alone (without `statusBarTranslucent`) can be enough.
- **Fixed in**: v1.21.5 (maintainer confirmed "fixed a very similar bug" in that release changelog: "don't modify edge-to-edge mode by default when module toggled on/off").
- URL: https://github.com/kirillzyusko/react-native-keyboard-controller/discussions/984

## Issue #592 — Inconsistent NavigationBar behavior on Android when toggling `enabled`

- **Symptom**: toggling `KeyboardProvider`'s `enabled` prop (via `useKeyboardController`) causes the system NavigationBar to disappear when `enabled=true` and reappear + lift content (layout jump) when `enabled=false`.
- **Device/version**: Pixel 7, Android 14, RNKC v1.13.4, RN 0.75.3 / 0.73.9, New Architecture (Fabric).
- **Root cause**: the `enable()`/`disable()` native methods used to force edge-to-edge on/off as a side effect, instead of respecting the app's own edge-to-edge state.
- **Fix**: PR #765 (linked, closed) — same underlying issue class as Discussion #984, ultimately addressed by the 1.21.5 "don't modify edge-to-edge mode when toggled" fix.
- URL: https://github.com/kirillzyusko/react-native-keyboard-controller/issues/592

## Issue #1181 — Samsung-only: KeyboardProvider disables edge-to-edge entirely

- **Symptom**: wrapping app with `<KeyboardProvider>` disables edge-to-edge mode altogether on Galaxy A10s (Android 10) and Galaxy A40 (Android 11).
- **Status**: persisted on Samsung devices even after PR #1074; not reproducible on stock Android 11 emulator. OEM-specific (One UI), unresolved as of latest data found.
- URL: https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1181

## Issue #334 — Incorrect KeyboardAvoidingView calculations on Android (Pixel 5 physical only)

- **Symptom**: RNKC's `KeyboardAvoidingView` produces inconsistent/wrong bottom offset on a physical Pixel 5 (not reproducible on Pixel 5 emulator).
- **Root cause**: relies on `useWindowDimensions`, which "doesn't account for translucent system UI (e.g. status bar) on all devices/emulators" (cites RN discussion #33735) — i.e. same family of bug as translucency-mismatch above, but hitting the derived `KeyboardAvoidingView` math specifically rather than raw keyboard height.
- **Workaround used by reporter**: bypass `KeyboardAvoidingView`'s internal calc entirely — use `useReanimatedKeyboardAnimation().height` directly as bottom padding on a custom Animated view.
- **Fix**: PR #468 (closed/merged), version not confirmed in source.
- URL: https://github.com/kirillzyusko/react-native-keyboard-controller/issues/334

## KeyboardProvider translucency props — what they actually do (docs)

- `statusBarTranslucent` (bool): controls whether the Android StatusBar is translucent. By default the library runs edge-to-edge with a translucent status bar internally but auto-adds top padding to *look* like a normal (non-edge-to-edge) RN app. If your app also uses the RN `<StatusBar translucent>` prop, you must set this at the **provider** level instead — the two don't compose automatically.
- `navigationBarTranslucent` (bool): same idea, but for the Android NavigationBar (gesture bar / 3-button bar).
- `preserveEdgeToEdge` (bool): keeps edge-to-edge always enabled even when the module itself is toggled off — needed if some *other* library (e.g. `react-native-edge-to-edge`) is independently managing edge-to-edge and you don't want RNKC's enable/disable lifecycle fighting it.
- If the project uses `react-native-edge-to-edge` (zoontek), all three of the above are **auto-set to true** — no manual config needed. (Relevant: check if Swellyo uses this lib — if not, these props default to more conservative values and must be set explicitly per the workaround above.)
- Exact default boolean values (true/false) for `statusBarTranslucent`/`navigationBarTranslucent` when NOT using `react-native-edge-to-edge` were not explicitly stated in docs at time of research — treat as unset/false and set explicitly rather than relying on defaults.

## Interactive dismiss: iOS vs Android hook behavior (docs-confirmed)

- `KeyboardGestureArea` is Android-only (renders as Fragment on iOS and on Android < 11). See [[research_interactive_keyboard_dismiss_android]] for interpolator="ios" vs "linear" behavior.
- `useReanimatedKeyboardAnimation` (`height`/`progress` shared values) is documented to **automatically** update during interactive/gesture-driven dismissal on both platforms — no extra wiring needed, because it's UI-thread/worklet-driven and tied into the native `WindowInsetsAnimationCallback` (Android 11+) / native keyboard notifications (iOS).
- `useKeyboardHandler` (the lower-level, more granular hook) does **NOT** auto-track interactive gestures — docs explicitly say you must implement the `onInteractive` handler yourself to get frame-accurate values during a drag-to-dismiss gesture. If Swellyo's chat screen uses `useKeyboardHandler` anywhere (vs `useReanimatedKeyboardAnimation`), missing `onInteractive` is a likely cause of "progress not updating during the swipe."
- No documented statement was found claiming Android's `WindowInsetsAnimationCallback` fires fewer/coarser events than iOS during a drag — the callback is frame-driven on both, matching. The bugs found are about **wrong final/intermediate height values due to translucency/edge-to-edge misconfiguration**, not about missing events.

## Maintainer-recommended chat composer pattern (Android + interactive dismiss)

No dedicated "Android interactive dismiss + chat composer" guide/blog post exists yet — the Margelo blog "Go-To Guide for Understanding Keyboards in React Native" explicitly says Part 2 (covering "interactive dismissal — the kind chat apps do where the keyboard tracks your finger") had not been published as of this research. Until that lands, the maintainer's standing recommendation (from docs + example app) is:
1. `KeyboardGestureArea` wraps both the scrollable list and the composer.
2. `KeyboardStickyView` (not `KeyboardAvoidingView`) for the composer itself — pure translation, no layout/flex recompute, avoids the class of "gap after dismiss" bugs caused by mixing translate-driven and layout-driven adjustments.
3. `KeyboardProvider` with explicit `navigationBarTranslucent`/`statusBarTranslucent` set (don't rely on defaults) to keep the native inset math consistent with the app's actual edge-to-edge state.
4. See [[research_rnkc_chat_keyboard_sync]] for the full official recipe (requires v1.21+ for `KeyboardChatScrollView`; v1.18.5 fallback pattern also documented there).

## Sources
- https://github.com/kirillzyusko/react-native-keyboard-controller/discussions/984
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/592
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1181
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/334
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/615
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/85
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/584
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/keyboard-provider
- https://github.com/kirillzyusko/react-native-keyboard-controller/releases
- https://blog.margelo.com/deep-dive-in-keyboard-handling
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/interactive-keyboard
- https://github.com/kirillzyusko/react-native-keyboard-controller/discussions/6
