# Keyboard-Direction-Aware Chat Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat composer aligns direction-neutral content (empty, emoji-only, digits) to the right when the active keyboard is RTL, matching WhatsApp. Nothing else user-visible changes.

**Architecture:** A local Expo module (`modules/keyboard-direction/`) answers "is the active keyboard RTL?" — push notifications on iOS, polling on Android. A hook (`useKeyboardDirection`) hides the platform difference. `ChatTextInput` adds `textAlign: 'right'` + `writingDirection: 'rtl'` ONLY when content is neutral AND the keyboard is RTL; in every other state it passes exactly the props it passes today.

**Tech Stack:** Expo Modules API (Swift + Kotlin, expo-modules-core 3.0.24), React Native 0.81, jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-09-keyboard-direction-design.md`

## Global Constraints

- **No git commits.** Ohad reviews and commits manually. Every "commit" step in the normal template is replaced by "leave uncommitted".
- **This is a NATIVE change.** It requires a dev build to test and a new store build to ship. It must NEVER be OTA'd onto existing builds (see `PRE_BUILD_CHECKLIST.md`). Expo Go will show no behavior change no matter what.
- **When content has a strong directional character, set NO alignment props.** RN's built-in bidi resolution stays in charge. The only new code path is neutral content ∧ RTL keyboard.
- Expo Go / web guards use `isExpoGo` from `src/utils/keyboardAvoidingView` (a `try`/`catch` around `require()` is NOT sufficient — see memory `project_ohad_tests_in_expo_go`).
- iOS deployment target is 15.1 (`ios/Podfile`). Android minSdk comes from Expo defaults (24+), so `InputMethodSubtype.languageTag` (API 24) is always available, but keep the documented fallback.

---

### Task 1: `getStrongDirection` util + tests

**Files:**
- Create: `src/utils/textDirection.ts`
- Test: `src/utils/__tests__/textDirection.test.ts`

**Interfaces:**
- Produces: `getStrongDirection(text: string | null | undefined): 'ltr' | 'rtl' | null` and `type StrongDirection = 'ltr' | 'rtl'`. Task 4 imports both from `../utils/textDirection`.

This is NOT the same contract as the screens' `getBodyTextAlign` (which collapses neutral to `'left'`). Returning `null` for neutral is the whole point — it is the signal that lets the keyboard break the tie. Message bubbles are out of scope and keep their own helper.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/textDirection.test.ts
import { getStrongDirection } from '../textDirection';

describe('getStrongDirection', () => {
  // Neutral content — no strong directional character. These are the cases
  // where the keyboard direction gets to break the tie.
  it.each([
    ['empty string', ''],
    ['single emoji', '😋'],
    ['multiple emoji', '😋🤙🏼🌊'],
    ['ZWJ family emoji', '👨‍👩‍👧'],
    ['flag emoji', '🇮🇱'],
    ['digits only', '123'],
    ['digits + emoji', '123 😋'],
    ['punctuation', '?!.,:;'],
    ['whitespace', '   \n '],
  ])('returns null for neutral content: %s', (_label, text) => {
    expect(getStrongDirection(text)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(getStrongDirection(null)).toBeNull();
    expect(getStrongDirection(undefined)).toBeNull();
  });

  // Strong content — first strong character wins (Unicode bidi convention).
  it.each([
    ['plain English', 'hello', 'ltr'],
    ['accented Latin', 'café', 'ltr'],
    ['Hebrew', 'שלום', 'rtl'],
    ['Arabic', 'مرحبا', 'rtl'],
    ['emoji then English', '😋 hello', 'ltr'],
    ['emoji then Hebrew', '😋 שלום', 'rtl'],
    ['digits then Hebrew', '123 שלום', 'rtl'],
    ['English then Hebrew (first strong wins)', 'ok שלום', 'ltr'],
    ['Hebrew then English (first strong wins)', 'שלום ok', 'rtl'],
  ])('%s → %s', (_label, text, expected) => {
    expect(getStrongDirection(text)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/__tests__/textDirection.test.ts`
Expected: FAIL — `Cannot find module '../textDirection'`

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/textDirection.ts
/**
 * First-strong-character direction detection (Unicode bidi convention), with
 * one deliberate difference from the screens' getBodyTextAlign helper: neutral
 * content returns NULL instead of collapsing to 'left'. That null is the
 * signal that lets the active keyboard's direction break the tie in the chat
 * composer (spec: docs/superpowers/specs/2026-07-09-keyboard-direction-design.md).
 *
 * "Strong" here covers Hebrew/Arabic ranges (RTL) and Latin ranges (LTR) —
 * the same ranges the message-bubble helper uses. Scripts outside these
 * (Cyrillic, CJK, …) read as neutral; acceptable because typing them implies
 * an LTR keyboard, which resolves to left anyway.
 */
export type StrongDirection = 'ltr' | 'rtl';

const isStrongRtl = (code: number): boolean =>
  (code >= 0x0590 && code <= 0x05ff) || // Hebrew
  (code >= 0x0600 && code <= 0x06ff) || // Arabic
  (code >= 0x0750 && code <= 0x077f) || // Arabic Supplement
  (code >= 0x08a0 && code <= 0x08ff) || // Arabic Extended-A
  (code >= 0xfb50 && code <= 0xfdff) || // Arabic Presentation Forms-A
  (code >= 0xfe70 && code <= 0xfeff);   // Arabic Presentation Forms-B

const isStrongLtr = (code: number): boolean =>
  (code >= 0x0041 && code <= 0x005a) || // A-Z
  (code >= 0x0061 && code <= 0x007a) || // a-z
  (code >= 0x00c0 && code <= 0x00ff);   // Latin-1 letters

export function getStrongDirection(
  text: string | null | undefined
): StrongDirection | null {
  if (!text) return null;
  // for..of iterates code points (not UTF-16 units), so surrogate-pair emoji
  // never produce bogus half-codes that could land inside a strong range.
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isStrongRtl(code)) return 'rtl';
    if (isStrongLtr(code)) return 'ltr';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/__tests__/textDirection.test.ts`
Expected: PASS, all cases green

- [ ] **Step 5: Leave uncommitted** (Ohad commits manually)

---

### Task 2: Native module `modules/keyboard-direction/`

**Files:**
- Create: `modules/keyboard-direction/expo-module.config.json`
- Create: `modules/keyboard-direction/index.ts`
- Create: `modules/keyboard-direction/ios/KeyboardDirection.podspec`
- Create: `modules/keyboard-direction/ios/KeyboardDirectionModule.swift`
- Create: `modules/keyboard-direction/android/build.gradle`
- Create: `modules/keyboard-direction/android/src/main/AndroidManifest.xml`
- Create: `modules/keyboard-direction/android/src/main/java/expo/modules/keyboarddirection/KeyboardDirectionModule.kt`

**Interfaces:**
- Produces (JS, from `modules/keyboard-direction/index.ts`):
  - `type KeyboardDirection = 'ltr' | 'rtl'`
  - `getKeyboardDirection(): KeyboardDirection | null` — cached native read; `null` when the module is absent or direction unknown
  - `addKeyboardDirectionListener(listener: (d: KeyboardDirection) => void): { remove(): void } | null` — iOS push events; `null` where unsupported
- Task 3 imports all three from `../../modules/keyboard-direction`.

Expo autolinking scans the project-root `modules/` directory automatically in SDK 54 bare projects — no config change needed. iOS additionally needs `pod install` (done in Task 5).

- [ ] **Step 1: Module config**

```json
{
  "platforms": ["apple", "android"],
  "apple": {
    "modules": ["KeyboardDirectionModule"]
  },
  "android": {
    "modules": ["expo.modules.keyboarddirection.KeyboardDirectionModule"]
  }
}
```
→ `modules/keyboard-direction/expo-module.config.json`

- [ ] **Step 2: iOS podspec**

```ruby
Pod::Spec.new do |s|
  s.name           = 'KeyboardDirection'
  s.version        = '1.0.0'
  s.summary        = 'Active keyboard writing direction (ltr/rtl)'
  s.description    = 'Reports whether the active keyboard input mode is RTL or LTR.'
  s.author         = 'Swellyo'
  s.homepage       = 'https://github.com/ohadstorfer/swellyoNew'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
```
→ `modules/keyboard-direction/ios/KeyboardDirection.podspec`

- [ ] **Step 3: iOS module**

```swift
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
```
→ `modules/keyboard-direction/ios/KeyboardDirectionModule.swift`

- [ ] **Step 4: Android gradle + manifest**

```gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

group = 'expo.modules.keyboarddirection'
version = '1.0.0'

def expoModulesCorePlugin = new File(project(":expo-modules-core").projectDir.absolutePath, "ExpoModulesCorePlugin.gradle")
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()
useCoreDependencies()
useDefaultAndroidSdkVersions()

android {
  namespace "expo.modules.keyboarddirection"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
  }
  lintOptions {
    abortOnError false
  }
}
```
→ `modules/keyboard-direction/android/build.gradle`

```xml
<manifest />
```
→ `modules/keyboard-direction/android/src/main/AndroidManifest.xml`

- [ ] **Step 5: Android module**

```kotlin
package expo.modules.keyboarddirection

import android.content.Context
import android.os.Build
import android.text.TextUtils
import android.view.View
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * Pull-only counterpart of the iOS module. Android has no reliable broadcast
 * for language switches WITHIN one keyboard app (Gboard EN -> Gboard HE), so
 * there is no onChange event here — JS polls getDirection() on focus,
 * keyboardDidShow, and every keystroke instead (see useKeyboardDirection).
 */
class KeyboardDirectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeyboardDirection")

    Function("getDirection") {
      val context = appContext.reactContext ?: return@Function null
      val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        ?: return@Function null
      val subtype = imm.currentInputMethodSubtype ?: return@Function null
      val tag: String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && subtype.languageTag.isNotEmpty()) {
          subtype.languageTag
        } else {
          @Suppress("DEPRECATION")
          subtype.locale
        }
      if (tag.isNullOrEmpty()) return@Function null
      // Legacy subtype.locale uses underscores ("he_IL"); BCP-47 wants dashes.
      val locale = Locale.forLanguageTag(tag.replace('_', '-'))
      if (TextUtils.getLayoutDirectionFromLocale(locale) == View.LAYOUT_DIRECTION_RTL) "rtl" else "ltr"
    }
  }
}
```
→ `modules/keyboard-direction/android/src/main/java/expo/modules/keyboarddirection/KeyboardDirectionModule.kt`

- [ ] **Step 6: JS entry point**

```ts
// modules/keyboard-direction/index.ts
/**
 * JS face of the keyboard-direction native module. Every export degrades to
 * an inert value when the native side is absent (Expo Go, web, autolinking
 * failure) — requireOptionalNativeModule returns null instead of throwing, so
 * callers never need a try/catch and the app behaves exactly as before the
 * module existed.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export type KeyboardDirection = 'ltr' | 'rtl';

type NativeKeyboardDirection = {
  getDirection(): KeyboardDirection | null;
  addListener(
    eventName: 'onChange',
    listener: (event: { direction: KeyboardDirection }) => void
  ): { remove(): void };
};

const native = requireOptionalNativeModule<NativeKeyboardDirection>('KeyboardDirection');

/** Cached native read. Null = module absent or direction not yet known. */
export function getKeyboardDirection(): KeyboardDirection | null {
  if (!native) return null;
  try {
    return native.getDirection() ?? null;
  } catch {
    return null;
  }
}

/** iOS-only push events (Android modules emit nothing). Null where unsupported. */
export function addKeyboardDirectionListener(
  listener: (direction: KeyboardDirection) => void
): { remove(): void } | null {
  if (!native || typeof native.addListener !== 'function') return null;
  return native.addListener('onChange', (event) => {
    if (event?.direction === 'ltr' || event?.direction === 'rtl') {
      listener(event.direction);
    }
  });
}
```
→ `modules/keyboard-direction/index.ts`

- [ ] **Step 7: Verify autolinking discovers the module**

Run: `npx expo-modules-autolinking search 2>/dev/null | grep -i keyboard-direction`
Expected: one line naming the `modules/keyboard-direction` path. (If the command prints JSON, `grep` still matches the path string.)

- [ ] **Step 8: Leave uncommitted** (Ohad commits manually)

---

### Task 3: `useKeyboardDirection` hook

**Files:**
- Create: `src/hooks/useKeyboardDirection.ts`

**Interfaces:**
- Consumes: `getKeyboardDirection`, `addKeyboardDirectionListener`, `KeyboardDirection` from `../../modules/keyboard-direction` (Task 2); `isExpoGo` from `../utils/keyboardAvoidingView`.
- Produces: `useKeyboardDirection(): { direction: KeyboardDirection; refresh: () => void }`. Task 4 imports it from `../hooks/useKeyboardDirection`. `direction` starts `'ltr'` and only ever holds a real direction (never null). `refresh` is a stable-identity no-op where disabled.

No hook test — the project has jest-expo but no `@testing-library/react-native` (no `renderHook`). The hook is thin enough to verify by `tsc` + review; the policy logic it feeds is covered by Task 1's tests.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useKeyboardDirection.ts
import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

import { isExpoGo } from '../utils/keyboardAvoidingView';
import {
  addKeyboardDirectionListener,
  getKeyboardDirection,
  type KeyboardDirection,
} from '../../modules/keyboard-direction';

// The native module only exists on dev/prod builds. On web and Expo Go the
// hook is inert: direction stays 'ltr', refresh() is a no-op, and no native
// call is ever made — callers behave exactly as before this hook existed.
const ENABLED = Platform.OS !== 'web' && !isExpoGo;

/**
 * Direction of the active keyboard, bridging the platform gap:
 *  - iOS pushes changes (notification -> onChange event), so `direction`
 *    updates the moment the user switches keyboards.
 *  - Android has no reliable push for within-keyboard language switches, so
 *    callers must invoke `refresh()` from their poll points (focus + every
 *    keystroke); keyboardDidShow polling is built in here.
 * Both platforms use the same three poll points so the push/pull difference
 * never leaks past this hook.
 *
 * A null native read (no keyboard yet, unknown subtype) keeps the last known
 * direction instead of snapping back to LTR.
 */
export function useKeyboardDirection(): {
  direction: KeyboardDirection;
  refresh: () => void;
} {
  const [direction, setDirection] = useState<KeyboardDirection>('ltr');

  const refresh = useCallback(() => {
    if (!ENABLED) return;
    const d = getKeyboardDirection();
    if (d) setDirection(d);
  }, []);

  useEffect(() => {
    if (!ENABLED) return;
    refresh();
    const showSub = Keyboard.addListener('keyboardDidShow', refresh);
    const changeSub = addKeyboardDirectionListener(setDirection); // iOS push; null on Android
    return () => {
      showSub.remove();
      changeSub?.remove();
    };
  }, [refresh]);

  return { direction, refresh };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "useKeyboardDirection|keyboard-direction"`
Expected: no output (no errors in the new files)

- [ ] **Step 3: Leave uncommitted** (Ohad commits manually)

---

### Task 4: `ChatTextInput` integration

**Files:**
- Modify: `src/components/ChatTextInput.tsx` (imports ~line 26; component body near `isSendDisabled` ~line 281; the `<TextInput>` element ~lines 492-543)

**Interfaces:**
- Consumes: `useKeyboardDirection` (Task 3), `getStrongDirection` (Task 1).
- Produces: no new exports. All 7 consumers (DirectMessageScreen, DirectGroupChat, ChatScreen, TripPlanningChatScreen, SwellyShaperScreen, ImagePreviewModal, VideoPreviewModal) get the behavior with zero changes on their side.

The invariant to preserve (spec's load-bearing decision): when `forceRtl` is false, the `<TextInput>` receives EXACTLY the props it receives today — no `textAlign`, no `writingDirection`, no new always-on props. The spread must contribute nothing in that case.

- [ ] **Step 1: Add imports**

```ts
import { colors } from '../styles/theme';
import { getStrongDirection } from '../utils/textDirection';
import { useKeyboardDirection } from '../hooks/useKeyboardDirection';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
```
(replacing the current two-line `colors` + `useKeyboardVisible` import block)

- [ ] **Step 2: Compute `forceRtl` in the component body**

Insert right after `const isSendDisabled = ...`:

```ts
const { direction: keyboardDirection, refresh: refreshKeyboardDirection } =
  useKeyboardDirection();
// Keyboard direction only breaks ties. Content with a strong directional
// character keeps RN's own bidi resolution (NO alignment props set — that is
// what guarantees nothing else changes). Only neutral content (empty, emoji,
// digits) + an RTL keyboard forces right alignment, mirroring WhatsApp.
const forceRtl =
  getStrongDirection(value) === null && keyboardDirection === 'rtl';
```

- [ ] **Step 3: Apply to the TextInput**

In the `<TextInput>` style object, add ONE line after the `...(textColor ? { color: textColor } : null),` line:

```ts
                    ...(textColor ? { color: textColor } : null),
                    ...(forceRtl
                      ? { textAlign: 'right' as const, writingDirection: 'rtl' as const }
                      : null),
```

Replace `onChangeText={onChangeText}` with:

```ts
                onChangeText={(text) => {
                  // Keystrokes are the reliable poll point on Android (no
                  // native change event there) — see useKeyboardDirection.
                  refreshKeyboardDirection();
                  onChangeText(text);
                }}
```

Add an `onFocus` next to the existing `onBlur`:

```ts
                onFocus={refreshKeyboardDirection}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ChatTextInput|textDirection|useKeyboardDirection"`
Expected: no output

Run: `npx jest src/utils/__tests__/textDirection.test.ts`
Expected: PASS

- [ ] **Step 5: Leave uncommitted** (Ohad commits manually)

---

### Task 5: Full verification + native install

**Files:** none new

- [ ] **Step 1: Full type-check and test suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0

Run: `npx jest`
Expected: all suites pass (pre-existing suites unaffected)

- [ ] **Step 2: iOS pod install (links the new pod)**

Run: `cd ios && pod install && cd ..`
Expected: output includes `Installing KeyboardDirection (1.0.0)`; `ios/Podfile.lock` gains a `KeyboardDirection` entry. Android needs nothing — autolinking picks the module up at the next gradle build.

- [ ] **Step 3: Report to Ohad**

- All changed/created files, uncommitted, for manual review.
- On-device test plan (dev build, NOT Expo Go): open a DM → switch keyboard to Hebrew → type an emoji from the emoji keyboard → it must sit at the RIGHT edge; switch back to English keyboard → new emoji-only content sits LEFT; type "hello" with Hebrew keyboard active (paste) → stays LEFT; type Hebrew → sits RIGHT (unchanged native behavior).
- Remind: native change → next store build required, never OTA (PRE_BUILD_CHECKLIST).
