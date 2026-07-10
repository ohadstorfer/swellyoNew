# KeyboardDirectionModule — replacing the unavailable `UITextInputMode.current`

**Date:** 2026-07-09
**Status:** Ready for implementation
**Scope:** `modules/keyboard-direction/ios/KeyboardDirectionModule.swift` only. No JS, no TS, no Expo config.

## Problem

The module does not compile. It reads:

```swift
guard let lang = UITextInputMode.current?.primaryLanguage, ...
```

Swift rejects it: `'current' is unavailable in iOS: APIs deprecated as of iOS 7 and earlier are unavailable in Swift`. The property exists only in Objective-C. There is no Swift-callable form, with or without parentheses.

This blocks the entire iOS build, including work unrelated to this module.

## What the research established

1. **There is no first-class public API for "the current keyboard."** `UITextInputMode.current` returned the *first responder's* input mode. Its Swift-legal heir is `UIResponder.textInputMode`, read off whatever is first responder at that moment.

2. **`UITextInputMode.activeInputModes` is the wrong tool.** It lists every keyboard the user has *enabled in Settings*, not the active one.

3. **The module's existing design constraint is correct and must be preserved.** Its doc comment says never to cache a specific text view's `textInputMode`, because a modal composer over the chat composer would make the cached reference read the wrong field. That is exactly right — and it is exactly what "read the current first responder each time" gives us.

4. **A latent timing bug exists today, hidden behind the compile error.** When `currentInputModeDidChangeNotification` fires, the responder's `textInputMode` has *not yet* settled. Reading it synchronously returns the **previous** keyboard. The fix is one `DispatchQueue.main.async` hop.

5. `Locale.characterDirection(forLanguage:)` is current and correct on iOS 15+. (`Locale.Language.characterDirection` is iOS 16+, so it cannot be the baseline.)

6. `"emoji"`, `"dictation"`, and a `nil` `primaryLanguage` are the values to skip. The module already skips the first two; `nil` is skipped implicitly by the `guard let`.

7. No existing open-source RN/Expo module solves this. `I18nManager`, `react-native-localize`, and `rtl-detect` all read the *app locale*, not the live keyboard — they cannot tell you the user just switched to a Hebrew keyboard inside an English-locale app.

## Design

### Finding the first responder

Use the `sendAction(_:to:from:for:)` trick: dispatching a selector with `to: nil` walks the responder chain and lands on the first responder, which captures itself.

This is fully public API — it is the same mechanism `UIControl` uses for target-action — and carries no App Store risk.

Two alternatives were rejected:
- **Recursive `window.subviews` traversal.** Public and safe, but O(n) and blind to non-`UIView` responders (view controllers, custom responders).
- **`window.value(forKey: "firstResponder")`.** KVC into a private ivar. A known rejection risk. Never.

Windows are reached through `UIApplication.shared.connectedScenes` → `UIWindowScene`, not the deprecated `keyWindow`. (The `sendAction` trick needs no window reference at all, which is a further point in its favor.)

### Fixing the timing

`readCurrentMode` defers its read by one run-loop tick with `DispatchQueue.main.async`. This covers both call sites: the notification handler and the `OnCreate` startup read.

The notification's `userInfo["UITextInputFromInputModeKey"]` would hand us the new mode directly and skip the hop — but that key is undocumented. It is deliberately **not** used. The async read is documented behavior built on public API.

### The first-focus gap

`currentInputModeDidChangeNotification` fires when the user *switches* keyboards. It does not fire when a keyboard first appears. And with no field focused there is no first responder, so the `OnCreate` read returns `nil`.

The consequence: from a cold start, `getDirection()` returns `nil` until the user switches keyboards at least once. The common path — open a chat, tap the composer, type in Hebrew — would never report `rtl`.

The old code papered over this because `UITextInputMode.current` returned a value even with nothing focused. The first-responder read cannot.

**So the module must also observe `UIResponder.keyboardDidShowNotification`** and read the mode there. That is the moment a first responder exists and its `textInputMode` is settled.

This is the one behavioral addition beyond a mechanical port. It is not scope creep: without it, the ported module is strictly worse than the one it replaces.

### What stays exactly as it was

- The `emoji` / `dictation` skip, and its rationale (the emoji keyboard is open precisely when the user inserts an emoji — the case the module exists to fix).
- Caching the last real direction and emitting `onChange` only on a transition.
- `getDirection()` returning the cached value, `nil` before the first real read.
- `OnDestroy` removing observers.

## Files touched

- `modules/keyboard-direction/ios/KeyboardDirectionModule.swift` — the only file.

## Acceptance criteria

1. `npx expo run:ios` compiles the module and the app launches.
2. Focusing the chat composer with a Hebrew keyboard reports `rtl` without requiring a keyboard switch first.
3. Switching from an English to a Hebrew keyboard while focused emits `onChange` with `rtl` — on the switch itself, not one switch late.
4. Opening the emoji keyboard does not change the reported direction.
5. Opening a modal composer over the chat composer and switching keyboards there reports the modal's keyboard, not the chat composer's.
6. `getDirection()` returns `nil` before any keyboard has appeared, and never crashes.
7. No private API, no KVC into `firstResponder`, no deprecated `keyWindow`.

## Testing

Compile-verified by the iOS build. Behaviour is verified on-device/simulator by Ohad — criteria 2 through 5 each need a real keyboard switch, which no unit test can exercise.
