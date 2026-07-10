---
name: research-ios-current-keyboard-language-direction
description: How to read the currently active iOS keyboard's language/writing direction (LTR/RTL) from a native module; UITextInputMode.current is Swift-unavailable, use first responder's textInputMode
metadata:
  type: project
---

Reading the CURRENT keyboard's primary language on iOS 15+ (Swift) for a native RTL/LTR module.

**Why:** an Expo native module (ExpoModulesCore) read `UITextInputMode.current?.primaryLanguage` to derive writing direction; Swift compiler rejects it: "'current' is unavailable in iOS: APIs deprecated as of iOS 7 and earlier are unavailable in Swift". `currentInputMode`/`current` was deprecated iOS 7 and is hard-unavailable in Swift (Obj-C only).

**How to apply:**
- There is NO clean "give me the current keyboard" public API. `.current` under the hood returned the first responder's input mode. The Swift-legal equivalent is reading `textInputMode?.primaryLanguage` off the CURRENT FIRST RESPONDER (UIResponder.textInputMode). This preserves the module's design intent (never cache a specific text view; a modal composer over the chat composer makes a cached ref read the wrong field — that concern is REAL and correct).
- `UITextInputMode.activeInputModes` is WRONG for this — it returns the list of keyboards the user ENABLED in Settings, not the active one.
- TIMING BUG is real: mattneub's book example prints `textField.textInputMode?.primaryLanguage` = wrong inside `textFieldDidBeginEditing`, correct inside `shouldChangeCharactersIn` (one run-loop later). So inside `currentInputModeDidChangeNotification` handler, `DispatchQueue.main.async` before reading, or read the mode from the notification payload.
- notification.userInfo key `"UITextInputFromInputModeKey"` carries the switched-to UITextInputMode (used by MemojiView), but this key is UNDOCUMENTED — don't rely on it as the only path; use it as a hint and fall back to first-responder read.
- Skip these primaryLanguage values: `"emoji"`, `"dictation"` (both confirmed literals; RN core checks `"dictation"` in prod), and nil.
- Map to direction with `Locale.characterDirection(forLanguage:) == .rightToLeft` (NOT deprecated, fine on iOS 15). iOS 16+ alt: `Locale.Language(identifier:).characterDirection`.
- Finding first responder without deprecated keyWindow: `UIApplication.sendAction(_:to:nil,from:nil,for:)` trick is public API / App-Store-safe; recursive `window.subviews` isFirstResponder scan also works but misses non-view responders. Prefer sendAction. Never use `window.value(forKey:"firstResponder")` (KVC private → rejection).
- No existing RN/Expo module reports keyboard writing direction to JS; RN core only reads primaryLanguage internally to guard dictation. rtl-detect/I18nManager operate on locale strings, not the live keyboard.

Sources: mattneub Programming-iOS-Book-Examples ch23p810textFieldDelegate; facebook/react-native commit 892212b (dictation check); emrearmagan/MemojiView (notification userInfo pattern); Apple docs UITextInputMode / UIResponder.textInputMode.
