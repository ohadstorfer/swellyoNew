# KeyboardDirectionModule iOS API Fix — Implementation Plan

**Goal:** Make `KeyboardDirectionModule.swift` compile against Swift, without weakening the design constraint it was built around, and fix the timing bug the compile error was hiding.

**Architecture:** Replace the Objective-C-only `UITextInputMode.current` with a read of the current first responder's `textInputMode`, found via the public `sendAction` responder-chain trick, deferred one run-loop tick so the value has settled. Add a `keyboardDidShowNotification` observer to cover the first keyboard of a session, which the switch notification never reports.

**Tech Stack:** Swift 5.9, UIKit, ExpoModulesCore, iOS 15+ deployment target.

**Spec:** `docs/superpowers/specs/2026-07-09-keyboard-direction-ios-api-design.md`

## Global Constraints

- **No private API.** No `value(forKey: "firstResponder")`, no undocumented `userInfo` keys, no deprecated `keyWindow`.
- **Never cache a specific text view's `textInputMode`.** Always read whichever responder holds focus at that moment. A modal composer over the chat composer makes a cached reference read the wrong field. This is the module's founding constraint.
- **`Locale.characterDirection(forLanguage:)`**, not `Locale.Language.characterDirection` (iOS 16+).
- Skip `"emoji"`, `"dictation"`, and `nil` — keep the last real direction.
- One file only: `modules/keyboard-direction/ios/KeyboardDirectionModule.swift`. No JS, no config, no `pod install` changes.
- This is a native change. It requires a rebuild and cannot ship over the air.

---

### Task 1: Add a public-API first-responder finder

**Files:**
- Modify: `modules/keyboard-direction/ios/KeyboardDirectionModule.swift`

**Produces:** `UIResponder.swellyoCurrentFirstResponder() -> UIResponder?`

A Swift extension cannot hold a stored property, so the captured responder lives in a file-scope `weak var`. The selector is prefixed to avoid colliding with anything else in the responder chain.

- [ ] **Step 1: Add the finder above the module class**

```swift
/// Captured by `swellyoCurrentFirstResponder()`. File-scope because a Swift
/// extension cannot hold a stored property. `weak` so a torn-down responder
/// cannot be resurrected here.
private weak var capturedResponder: UIResponder?

private extension UIResponder {
  @objc func swellyoCaptureFirstResponder(_ sender: Any?) {
    capturedResponder = self
  }

  /// The responder holding focus right now, or nil when nothing is focused.
  ///
  /// Sending an action with `to: nil` walks the responder chain and lands on the
  /// first responder — the same public mechanism UIControl uses for target-action.
  /// The `value(forKey: "firstResponder")` alternative reads a private ivar and is
  /// a known App Store rejection risk.
  static func swellyoCurrentFirstResponder() -> UIResponder? {
    capturedResponder = nil
    UIApplication.shared.sendAction(
      #selector(UIResponder.swellyoCaptureFirstResponder(_:)),
      to: nil,
      from: nil,
      for: nil
    )
    return capturedResponder
  }
}
```

- [ ] **Step 2: Verify it compiles in isolation**

Run: `cd /Users/ohadstorfer/swellyoNative && npx expo run:ios`
Expected: FAIL, but now only on `readCurrentMode`'s `UITextInputMode.current` — the extension itself must produce no error. If the error mentions `swellyoCaptureFirstResponder` or `capturedResponder`, fix before continuing.

---

### Task 2: Rewrite `readCurrentMode` and the observers

**Files:**
- Modify: `modules/keyboard-direction/ios/KeyboardDirectionModule.swift`

**Consumes:** `swellyoCurrentFirstResponder()` from Task 1.

Three changes, all load-bearing:
1. Read the first responder instead of `UITextInputMode.current`.
2. Defer one run-loop tick — on `currentInputModeDidChangeNotification` the responder's `textInputMode` still reports the **previous** keyboard.
3. Observe `keyboardDidShowNotification` too. The switch notification never fires for the first keyboard of a session, and with nothing focused there is no responder to read. Without this, a cold start never reports a direction until the user switches keyboards.

The `emit:` parameter disappears: the old `OnCreate` read passed `emit: false`, but that read is now impossible (no responder exists before a keyboard appears), so every remaining call site emits.

- [ ] **Step 1: Replace the module body**

```swift
public class KeyboardDirectionModule: Module {
  private var cachedDirection: String?
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("KeyboardDirection")
    Events("onChange")

    OnCreate {
      let center = NotificationCenter.default

      // The user switched keyboards while a field was focused.
      self.observers.append(center.addObserver(
        forName: UITextInputMode.currentInputModeDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.readCurrentMode() })

      // A keyboard appeared. currentInputModeDidChangeNotification does NOT fire
      // for the first keyboard of a session, and before one appears there is no
      // first responder to read — so without this the direction stays nil until
      // the user happens to switch keyboards.
      self.observers.append(center.addObserver(
        forName: UIResponder.keyboardDidShowNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.readCurrentMode() })
    }

    OnDestroy {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.observers.removeAll()
    }

    Function("getDirection") { () -> String? in
      return self.cachedDirection
    }
  }

  /// Reads the direction of the keyboard that is active RIGHT NOW.
  ///
  /// Deferred one run-loop tick on purpose: when currentInputModeDidChangeNotification
  /// fires, the responder's textInputMode has not settled and still reports the
  /// PREVIOUS keyboard. (The notification's userInfo carries the new mode under an
  /// undocumented key; we take the documented path instead.)
  ///
  /// Always reads whatever is first responder now, never a cached text view: with a
  /// modal composer open over the chat composer, a cached reference reads the wrong
  /// field. This is the same semantics the deprecated UITextInputMode.current had.
  private func readCurrentMode() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard
        let lang = UIResponder.swellyoCurrentFirstResponder()?.textInputMode?.primaryLanguage,
        lang != "emoji", lang != "dictation"
      else {
        return // nothing focused, or a mode with no direction — keep the last real one
      }

      let direction = Locale.characterDirection(forLanguage: lang) == .rightToLeft ? "rtl" : "ltr"
      guard direction != self.cachedDirection else { return }
      self.cachedDirection = direction
      self.sendEvent("onChange", ["direction": direction])
    }
  }
}
```

- [ ] **Step 2: Update the file's doc comment**

The header still claims `UITextInputMode.current` is read fresh. Replace that paragraph so it describes what the code now does, and keep the reason — the constraint survives, only the mechanism changed.

- [ ] **Step 3: Build**

Run: `cd /Users/ohadstorfer/swellyoNative && npx expo run:ios`
Expected: `BUILD SUCCEEDED`, Metro starts, the app launches in the simulator.

Watch for: an error on `#selector` (the method must be `@objc`), or on `guard let self` (needs Swift 5.7+, which Xcode 15 has).

- [ ] **Step 4: Confirm the JS side still matches**

Run: `grep -rn "getDirection\|onChange" src/hooks/useKeyboardDirection.ts`
Expected: `getDirection()` still called with no arguments and treated as nullable; the `onChange` payload still read as `{ direction }`. The native signature did not change, so this is a confirmation, not a change.

---

## Verification

- [ ] `npx expo run:ios` → `BUILD SUCCEEDED`, app launches.
- [ ] `grep -n "value(forKey" modules/keyboard-direction/ios/` → no match (no private-ivar KVC).
- [ ] `grep -n "keyWindow" modules/keyboard-direction/ios/` → no match.
- [ ] `grep -n "UITextInputFromInputModeKey" modules/keyboard-direction/ios/` → no match (no undocumented userInfo key).

**On-device / simulator, by Ohad** — none of these can be unit-tested:

1. Cold start → focus the chat composer with a Hebrew keyboard → direction reports `rtl` without switching keyboards first.
2. Focused, switch English → Hebrew → `onChange` fires with `rtl` **on that switch**, not one switch late.
3. Open the emoji keyboard → direction does not change.
4. Open a modal composer over the chat composer, switch keyboards there → the modal's keyboard is reported.
5. Before any keyboard has appeared, `getDirection()` returns `nil` and nothing crashes.
