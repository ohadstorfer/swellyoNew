---
name: Custom Keyboard Swap (Attachment Panel In-Place) — RN 0.81 / Expo SDK 54 / Fabric
description: Whether a WhatsApp/Telegram-style in-place keyboard-to-panel swap is achievable on Fabric; library survey (RNKC KeyboardExtender, wix archived); verdict = spacer technique is the only realistic path
metadata:
  type: reference
---

## Verdict (2026-07)

True native `inputView` swap (iOS) hosting a Fabric RN view, cross-platform, is **not a maintained/available path** in this stack. The only realistic, widely-used technique is the **"spacer" / persisted-height technique** — not a true in-place native keyboard swap, but achievable to look near-instant.

## 1. iOS native inputView approach

- Mechanically still exists in UIKit: `UIResponder.inputViewController` / `inputView` + `reloadInputViews()` is unchanged in iOS 17/18. Nothing about Fabric breaks the *UIKit* mechanism itself — Fabric only changes how RN mounts/manages its own view tree, not first-responder/inputView plumbing.
- The problem is **hosting a Fabric-managed RN subtree inside that inputView**. The only real-world implementation (wix/react-native-keyboard-input's `RCTCustomInputController.m`) creates an `RCTRootView` (old bridge architecture) and assigns it as `customKeyboardController.rootView`. This pattern predates Fabric/New Architecture and was never ported — `RCTRootView` bridging to a Fabric surface would need custom native work (a `RCTFabricSurface`/`RCTSurfaceHostingView` equivalent manually wired to a `UIInputViewController.view`). No public library does this today.
- Conclusion: technically possible to hand-roll (someone competent in Fabric internals could wire an `RCTSurfaceHostingView` into an inputView), but it is bespoke native Objective-C/Swift work, not a documented supported path, and would need re-validation on every RN upgrade. Not recommended for this project.

## 2. Library survey

### react-native-keyboard-controller (v1.21.x, actively maintained — 1.21.14 published within the last day as of research date)
- Has `KeyboardExtender` (introduced v1.18.0) — closest-sounding API, but it does **NOT** replace/swap keyboard content. Per official docs it "**increases keyboard height**" — it ADDS an extra row above/attached to the existing system keyboard (e.g. quick-amount buttons in a payment app), the system keyboard itself stays visible underneath. Explicitly cannot contain nested `TextInput`s. Confirmed via docs: "KeyboardExtender adds extra height above the keyboard... not for swapping out keyboard content like WhatsApp's attachment panel" (contrasted directly against KeyboardStickyView).
  - Open bug: iOS crash when embedding `@expo/ui` SwiftUI `Button` inside `KeyboardExtender` (issue #1345, unresolved as of research). Android unaffected.
- Has `OverKeyboardView` — renders content OVER the keyboard without dismissing it (e.g. context menus). Also not a swap — keyboard stays.
- Has `KeyboardBackgroundView` — visual-only, matches keyboard's system background color/blur so a custom view can *blend in*. Useful as a supporting primitive for the spacer technique (see #5) but does not itself swap content.
- **Does NOT have** any `KeyboardController.setInputView()` or true content-swap API. No such feature request found as an accepted/planned item in issues/discussions during this research pass.
- Does have the one genuinely useful primitive for this problem: **`KeyboardController.dismiss({ animated: false })`** — introduced v1.19 (blog: "Version 1.19 — instant dismiss"). Lets you hide the keyboard with **zero slide-down animation**, on both iOS and Android (per docs; no platform caveat documented). This is the key building block for making the spacer-swap look instant (see #5).

### wix/react-native-keyboard-input + react-native-keyboard-tracking-view
- **Archived by the owner on 2026-04-13.** Repo is now read-only. README: "This repository is archived and no longer maintained. The components have moved to our UI library — please migrate to react-native-ui-lib."
- No New Architecture/Fabric/Expo mention anywhere in the README — predates all three.
- `react-native-ui-lib`'s `Keyboard` component is the suggested migration target, but it's built on top of the same now-archived native modules; no independent confirmation found that it's Fabric-verified for this specific inputView-swap use case (only that it exists as a wrapper).
- **Do not adopt** for a New Architecture / Expo prebuild project — no compatibility guarantee, unmaintained, would likely require patch-package or a fork to even build.

### No other maintained alternative found
- Searched specifically for newer 2025/2026 libraries targeting this exact pattern (inputView swap / custom keyboard content) — none found. The ecosystem has converged on RNKC as the general keyboard-handling solution, and RNKC's own answer to "custom keyboard content" is KeyboardExtender (extends, doesn't replace) plus the spacer technique for anything that needs to fully replace the keyboard area.

## 3. Android reality check

- Android has **no equivalent of iOS's `inputView`**. There is no public API to hand your own View to the IME and have the system host it in the keyboard's place. `InputMethodService` exists but that's for building an actual system-wide keyboard app (a separate APK component, not something an app embeds inline for itself).
- Confirmed: the only real option on Android is "hide the IME, show a same-height custom view" — i.e. the spacer technique.
- `WindowInsetsAnimation`/`WindowInsetsAnimationCompat` (Android 11+, API 30+) is what `react-native-keyboard-controller` uses to track the keyboard's real-time height frame-by-frame — this is what makes the spacer technique look smooth instead of janky, but it does not create a true swap; it's an insets-observer used to synchronize your own view's height/transition with the keyboard's animation.
- `adjustResize` implication (already in project memory, `research_android_keyboard_chat.md`): with edge-to-edge on (default/mandatory on SDK 54 / Android 15+), `adjustResize` behaves like `adjustNothing` — you must manage keyboard insets yourself regardless, which RNKC already does. This doesn't change the swap approach, but it does mean you must be on RNKC (or manual `WindowInsetsAnimation` handling) already for the composer to behave correctly at all — a prerequisite this project already satisfies (RNKC installed, per project memory `project_rnkc_upgrade_android_keyboard.md`, now upgraded to 1.21.13+).

## 4. What real apps actually do

- No credible native-code write-up found describing WhatsApp's/Telegram's/Signal's own iOS or Android internals for this (they're native codebases with proprietary custom keyboard-height-tracking view controllers — not RN, and not publicly documented in technical detail).
- The only concrete RN-community discussion found (`FaridSafi/react-native-gifted-chat` issue #1222, "how to make chatbox(like emoji panel) switch with keyboard smoothly") describes the exact same problem ("unendurable delay when switch") for a WeChat/QQ-style panel swap, but was closed **wontfix** by the maintainers with no technical solution documented in the issue body itself — confirms this is a known-hard, unsolved-in-public problem in the RN ecosystem, not something with an established recipe.
- Conclusion: there is no publicly documented, battle-tested open-source implementation of a true in-place swap for RN. Every real app doing this either (a) is native code, or (b) uses the spacer technique and accepts it's an illusion, not a real inputView swap.

## 5. The pragmatic "spacer" technique — recommended path

Mechanism: track the keyboard's last known height (via `useKeyboardState`/`useAnimatedKeyboard` from RNKC, which already gets frame-accurate height on both platforms), then on attachment-button tap: dismiss the keyboard **without animation** and simultaneously mount a same-height custom panel.

- **iOS does NOT necessarily animate the keyboard down** — as of RNKC v1.19, `KeyboardController.dismiss({ animated: false })` performs an instant, non-animated dismiss on both platforms (per official docs, no iOS-specific caveat found). This is the concrete trick that makes the swap look instant: dismiss instantly + mount the panel at the exact last-measured keyboard height, same frame, so there's no visible collapse-then-expand.
- Sequencing that avoids a flash/gap:
  1. On mount / focus, continuously store `keyboardHeight` (already available via RNKC's `useKeyboardState` — confirmed selector support added in v1.18.0).
  2. On "+" tap: call `KeyboardController.dismiss({ animated: false })` AND set panel-visible state in the same handler (same JS tick) so the fixed-height panel container renders before/with the dismiss, not after.
  3. Panel container should have `height: lastKeyboardHeight` (not flex/measured-on-mount) so there's no layout jump between "keyboard visible" and "panel visible."
  4. Optionally wrap the panel in `KeyboardBackgroundView` so if there's any 1-frame seam, it's colored to match the system keyboard background rather than showing app background/white flash.
- Reverse direction (panel → keyboard, e.g. tapping the text input while panel is open): call `KeyboardController.setFocusTo` / just focus the TextInput; since height is already reserved at the same value, this should also look seamless — but this direction has less documentation/community testing than dismiss-to-panel.
- This is NOT a true iOS `inputView` swap and NOT a true Android IME replacement — it's an application-level illusion (blur input, show view same height). Multiple production chat-clone tutorials (WhatsApp-clone, Instagram-clone RN tutorials) use exactly this pattern; it's the de facto community standard, just not documented in any single canonical source.

## Recommendation for Swellyo

1. Do NOT attempt a true native `inputView`/IME swap — no maintained library supports it (wix's is archived, RNKC's KeyboardExtender is the wrong shape), and hand-rolling it under Fabric is a multi-week native-Swift/Kotlin project with high New-Architecture-upgrade fragility risk, not proportionate to the payoff.
2. Do NOT use `KeyboardExtender` for this — it visually adds to the keyboard, doesn't replace it; wrong UX (system keyboard would remain visible under/behind the attachment icons).
3. Use the spacer technique on top of the RNKC version already in the project (confirm >= 1.19 for `dismiss({ animated: false })`; project memory says already upgraded to 1.21.13, which is well past 1.19 — feature should be available).
4. Verify `useKeyboardState` height availability and confirm `KeyboardController.dismiss({animated:false})` behavior empirically on-device on both platforms before committing to the UX — the "no iOS caveat documented" claim is from docs only, not verified against RN 0.81/Fabric/iOS 18 specifically in this research pass.

## Sources
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/views/keyboard-extender
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/components-overview
- https://kirillzyusko.github.io/react-native-keyboard-controller/blog/keyboard-extensions
- https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1345
- https://kirillzyusko.github.io/react-native-keyboard-controller/blog/compound-keyboard-toolbar (v1.19 instant dismiss)
- https://github.com/wix-incubator/react-native-keyboard-input (archived 2026-04-13)
- https://github.com/wix/react-native-keyboard-input/blob/master/lib/ios/RCTCustomInputController/RCTCustomInputController.m
- https://github.com/FaridSafi/react-native-gifted-chat/issues/1222 (wontfix, no solution)
- https://developer.android.com/develop/ui/views/layout/sw-keyboard
- https://blog.margelo.com/deep-dive-in-keyboard-handling
- Project memory: research_rnkc_chat_keyboard_sync.md, research_android_keyboard_chat.md, research_interactive_keyboard_dismiss_android.md
