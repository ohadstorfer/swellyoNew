import ExpoModulesCore
import UIKit

/**
 Reports the active keyboard's writing direction to JS.

 Listens to `UITextInputMode.currentInputModeDidChangeNotification` and caches
 the direction of the last REAL keyboard: the "emoji" and "dictation" input
 modes carry no direction, so they are skipped and the previous value is kept.
 That skip is load-bearing — the emoji keyboard is exactly what is open when
 the user inserts an emoji, which is the case this module exists to fix.

 `UITextInputMode.current` is read fresh inside the handler (never a cached
 reference to a specific text view's `textInputMode`): with a modal composer
 open over a chat composer, a cached view reference reads the wrong field.
 */
public class KeyboardDirectionModule: Module {
  private var cachedDirection: String?
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("KeyboardDirection")
    Events("onChange")

    OnCreate {
      // UIKit access — main thread only. OnCreate has no such guarantee.
      DispatchQueue.main.async { self.readCurrentMode(emit: false) }
      self.observer = NotificationCenter.default.addObserver(
        forName: UITextInputMode.currentInputModeDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.readCurrentMode(emit: true)
      }
    }

    OnDestroy {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    Function("getDirection") { () -> String? in
      return self.cachedDirection
    }
  }

  private func readCurrentMode(emit: Bool) {
    guard let lang = UITextInputMode.current?.primaryLanguage,
          lang != "emoji", lang != "dictation" else {
      return // keep last real keyboard's direction
    }
    let direction =
      NSLocale.characterDirection(forLanguage: lang) == .rightToLeft ? "rtl" : "ltr"
    guard direction != cachedDirection else { return }
    cachedDirection = direction
    if emit {
      sendEvent("onChange", ["direction": direction])
    }
  }
}
