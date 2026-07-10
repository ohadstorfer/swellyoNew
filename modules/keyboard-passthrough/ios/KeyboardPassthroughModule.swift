import ExpoModulesCore
import UIKit

/**
 PROTOTYPE. Answers exactly one question: if the focused text view's `inputView`
 is a transparent `UIView`, does the app show through where the keyboard was?

 The keyboard is an OS window ABOVE the app. Nothing we draw can cover it, which
 is why the attach panel is mounted *behind* it and only becomes visible once the
 keyboard slides away. WhatsApp's iOS app dodges that slide because it is UIKit:
 it hands its own `UIView` to `inputView` and calls `reloadInputViews()`, and the
 keyboard window redraws in place with no animation.

 We cannot hand it our menu — that is a Fabric-managed React subtree, and hosting
 one inside an `inputView` has no public implementation (Wix's `RCTCustomInputController`
 is bridge-era and archived read-only since 2026-04-13).

 But we may not have to. If we hand `inputView` a transparent view of the exact
 keyboard height, the keyboard never closes — so there is no slide, nothing to
 synchronise — yet its window draws nothing, and the panel already mounted in the
 app's own window below shows through.

 THE UNVERIFIED ASSUMPTION: that UIKit does not paint an opaque backdrop behind a
 custom `inputView`. If it does, this returns true and you still see grey. That is
 the whole point of the prototype: `activate()` tells you it applied, your eyes
 tell you whether it worked.

 Android has no `inputView` at all, so this module is Apple-only by construction.
 */

/// Captured by `swellyoPassthroughFirstResponder()`. File-scope because a Swift
/// extension cannot hold a stored property. `weak` so a torn-down responder cannot
/// be resurrected through it.
private weak var capturedResponder: UIResponder?

private extension UIResponder {
  @objc func swellyoPassthroughCapture(_ sender: Any?) {
    capturedResponder = self
  }

  /// The responder holding focus right now, or nil when nothing is focused.
  ///
  /// Sending an action with `to: nil` walks the responder chain and lands on the
  /// first responder — the same public mechanism UIControl uses for target-action.
  /// `value(forKey: "firstResponder")` reads a private ivar and is a known App
  /// Store rejection risk. (Same technique as KeyboardDirectionModule; kept local
  /// so the two modules stay independent.)
  static func swellyoPassthroughFirstResponder() -> UIResponder? {
    capturedResponder = nil
    UIApplication.shared.sendAction(
      #selector(UIResponder.swellyoPassthroughCapture(_:)),
      to: nil,
      from: nil,
      for: nil
    )
    return capturedResponder
  }
}

public class KeyboardPassthroughModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardPassthrough")

    /// Replace the focused field's keyboard with a transparent view `height` points
    /// tall. Resolves false when nothing is focused, or when the focused responder is
    /// not a text view/field (only those redeclare `inputView` as settable).
    ///
    /// Height must match the keyboard's, or UIKit animates the frame change and the
    /// composer moves — the exact jump this whole design exists to avoid.
    ///
    /// Promise + DispatchQueue.main, not an `async` closure: UIKit demands the main
    /// thread, and this is the shape of concurrency the Expo Modules API documents.
    AsyncFunction("activate") { (height: Double, promise: Promise) in
      DispatchQueue.main.async {
        guard let responder = UIResponder.swellyoPassthroughFirstResponder() else {
          promise.resolve(false)
          return
        }
        let passthrough = UIView(
          frame: CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: CGFloat(height))
        )
        passthrough.backgroundColor = .clear
        passthrough.isOpaque = false
        // Width follows the window; height is fixed and load-bearing.
        passthrough.autoresizingMask = [.flexibleWidth]
        promise.resolve(Self.setInputView(passthrough, on: responder))
      }
    }

    /// Give the system keyboard back. The field keeps focus, so the keys simply
    /// reappear in the window that never closed.
    AsyncFunction("deactivate") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let responder = UIResponder.swellyoPassthroughFirstResponder() else {
          promise.resolve(false)
          return
        }
        promise.resolve(Self.setInputView(nil, on: responder))
      }
    }
  }

  /// `inputView` is read-only on `UIResponder`; `UITextView` and `UITextField`
  /// redeclare it as settable. RN's text inputs are backed by both (multiline →
  /// `RCTUITextView: UITextView`, single-line → `RCTUITextField: UITextField`).
  private static func setInputView(_ view: UIView?, on responder: UIResponder) -> Bool {
    if let textView = responder as? UITextView {
      textView.inputView = view
      textView.reloadInputViews()
      return true
    }
    if let textField = responder as? UITextField {
      textField.inputView = view
      textField.reloadInputViews()
      return true
    }
    return false
  }
}
