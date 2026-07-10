import ExpoModulesCore
import UIKit

/**
 Reports the active keyboard's writing direction to JS.

 Listens to `UITextInputMode.currentInputModeDidChangeNotification` and caches
 the direction of the last REAL keyboard: the "emoji" and "dictation" input
 modes carry no direction, so they are skipped and the previous value is kept.
 That skip is load-bearing — the emoji keyboard is exactly what is open when
 the user inserts an emoji, which is the case this module exists to fix.

 The mode is read off whatever holds focus RIGHT NOW (never a cached reference
 to a specific text view's `textInputMode`): with a modal composer open over a
 chat composer, a cached view reference reads the wrong field. `UITextInputMode
 .current` gave exactly these semantics but is Objective-C only — Swift refuses
 it as "deprecated as of iOS 7" — so we walk the responder chain instead.
 */

/// Captured by `swellyoCurrentFirstResponder()`. File-scope because a Swift
/// extension cannot hold a stored property. `weak` so a torn-down responder
/// cannot be resurrected through it.
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
