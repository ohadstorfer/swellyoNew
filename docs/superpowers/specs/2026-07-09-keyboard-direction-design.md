# Keyboard-direction-aware chat composer

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Problem

A user with an RTL keyboard (Hebrew, Arabic) types a single emoji into the chat
composer. The emoji sits at the left edge. It should sit at the right edge, the
way it does in WhatsApp and iMessage.

The cause is not a bug in our code. When `textAlign` is unset, both iOS and
Android resolve alignment with the Unicode Bidi Algorithm's first-strong-
character rule, applied to the string, falling back to the app's layout
direction when the string contains no strong character. An emoji is
directionally neutral. There is no strong character to key off, so the fallback
wins and the emoji goes left.

No amount of JavaScript can fix this, because the information is not in the
string. The only source of truth is the active keyboard, and React Native
exposes nothing about it — not on `TextInput`, not on `Keyboard`, not on
`onKeyPress`. This is a known, unaddressed gap
([facebook/react-native#29593](https://github.com/facebook/react-native/issues/29593)).

Native platform APIs do expose it:

- iOS: `UITextInputMode.current.primaryLanguage`, plus
  `UITextInputMode.currentInputModeDidChangeNotification`
- Android: `InputMethodManager.getCurrentInputMethodSubtype()`

## Goal

The chat composer aligns neutral content by the active keyboard's direction.
Nothing else the user can see changes.

That second sentence is a hard constraint, and it shapes the whole design.

## Alignment rule

Content decides; the keyboard only breaks ties. This matches WhatsApp, and it
guarantees that real text is never rendered against its own direction.

| Content       | Keyboard | Result | Path                    |
|---------------|----------|--------|-------------------------|
| `""` (empty)  | Hebrew   | left   | unchanged — placeholder always sits left (revised 2026-07-10) |
| `""` (empty)  | English  | left   | unchanged (RN resolves) |
| `"😋"`        | Hebrew   | right  | **new** — the fix       |
| `"😋"`        | English  | left   | unchanged (RN resolves) |
| `"123 😋"`    | Hebrew   | right  | **new**                 |
| `"hello"`     | Hebrew   | left   | unchanged (RN resolves) |
| `"שלום"`      | English  | right  | unchanged (RN resolves) |

When the emoji keyboard is open, iOS reports `primaryLanguage == "emoji"`. That
carries no direction, so we discard it and keep the last real keyboard's
direction. Without this the reported case does not get fixed at all, since the
emoji keyboard is precisely what is open when the user inserts an emoji.

## Architecture

Three layers, each independently testable.

### 1. `modules/keyboard-direction/` — native module

A local Expo module. Autolinks, because the project is bare workflow with
`ios/` and `android/` committed. Its only job is to answer *"is the active
keyboard RTL?"*. It knows nothing about `TextInput`.

```ts
getDirection(): 'ltr' | 'rtl' | null    // null = not yet known
addListener('onChange', { direction })  // iOS only
```

**iOS — `KeyboardDirectionModule.swift`**

Observes `UITextInputMode.currentInputModeDidChangeNotification`. On each fire,
reads `UITextInputMode.current?.primaryLanguage`:

- `nil`, `"emoji"`, or `"dictation"` → discard, keep the cached value
- otherwise → `NSLocale.characterDirection(forLanguage:)`, cache, emit

Using `characterDirection(forLanguage:)` rather than a hand-rolled table of
Unicode ranges means Apple's full language list is covered.

Read `UITextInputMode.current` inside the notification handler. Do not cache a
reference to a specific text view's `textInputMode` — with a modal composer
open over a chat composer, that reads the wrong field.

**Android — `KeyboardDirectionModule.kt`**

`InputMethodManager.getCurrentInputMethodSubtype()` → `languageTag` (API 24+,
falling back to `locale`) → `TextUtils.getLayoutDirectionFromLocale()`. Returns
`null` when the subtype is `null`. No events.

### 2. `src/hooks/useKeyboardDirection.ts`

Wraps the module and hides the push/pull difference between platforms.

JS calls `getDirection()` at the same three moments on both platforms: on input
focus, on `keyboardDidShow`, and on every `onChangeText`. On iOS it additionally
subscribes to `onChange`. `getDirection()` reads a cached field, so calling it
on every keystroke is free.

This is what lets Android work without the broken broadcast. Android does not
reliably fire `ACTION_INPUT_METHOD_CHANGED` when the user switches language
*within* one keyboard app (Gboard EN → Gboard HE); it fires only when switching
between keyboard apps. But the moment the user inserts the emoji, `onChangeText`
fires, we poll, and the emoji lands already aligned right. The only stale window
on Android is an untouched empty composer, where the sole visible artifact is
which side the caret sits on.

Guards: returns `'ltr'` and never calls native when `isExpoGo` (imported from
`src/utils/keyboardAvoidingView`, not a `require()` in a `try`/`catch` — see
`project_ohad_tests_in_expo_go`), on web, or if the module is absent.

### 3. `src/utils/textDirection.ts` + `ChatTextInput`

```ts
getStrongDirection(text): 'ltr' | 'rtl' | null   // null = neutral
```

Pure function. Returns `null` when the text holds no strong directional
character — empty, emoji-only, digits, punctuation.

In `ChatTextInput`:

```ts
const neutral = getStrongDirection(value) === null;
const forceRtl = neutral && keyboardDirection === 'rtl';
```

**When the content has a strong character, we set no alignment props at all.**

This is the load-bearing decision, and it is what makes the "nothing else
changes" constraint hold by construction rather than by inspection. Writing our
own Unicode range table to align *all* text would swap the platform's complete
bidi implementation for an incomplete list. Hebrew and Arabic are easy to
remember; Syriac, Thaana, N'Ko and Adlam are also RTL and would get silently
forced left. Leaving the strong-content case untouched removes that entire class
of regression.

So the only new code path is the intersection of two conditions: **neutral
content** ∧ **RTL keyboard**. There we set `textAlign: 'right'` and
`writingDirection: 'rtl'`. Everything else — including neutral content with an
LTR keyboard, which is the overwhelming majority of use — passes exactly the
props it passes today, with none added.

## Scope

`ChatTextInput` gains the behavior, so all seven of its consumers get it:
`DirectMessageScreen`, `DirectGroupChat`, `ChatScreen`,
`TripPlanningChatScreen`, `SwellyShaperScreen`, `ImagePreviewModal`,
`VideoPreviewModal`. No other `TextInput` in the app is touched, because nothing
else consumes the hook.

## Failure modes

There is no user-visible error state. Every failure degrades to today's
behavior.

| Failure                    | Result                                    |
|----------------------------|-------------------------------------------|
| Module absent (Expo Go)     | `'ltr'` → `forceRtl` false → unchanged   |
| Module absent (web)         | `'ltr'` → `forceRtl` false → unchanged   |
| Autolinking fails           | `'ltr'` → `forceRtl` false → unchanged   |
| iOS `current` is `nil`      | last cached direction; `'ltr'` initially |
| Android subtype is `null`   | last cached direction; `'ltr'` initially |

## Testing

- `getStrongDirection()` — Jest, using the alignment-rule table above.
- `useKeyboardDirection()` — Jest with the native module mocked; assert the
  Expo Go and web guards never call native.
- Native — on-device, by hand. **This cannot be tested in Expo Go.** Expo Go
  loads only the native modules compiled into the SDK, so no JS change can make
  the behavior appear there. A dev build is required to iterate at all.

## Out of scope

- Message bubbles. They already use `getBodyTextAlign`, unchanged.
- Any `TextInput` outside `ChatTextInput`.
- Android's `ACTION_INPUT_METHOD_CHANGED` broadcast receiver. The polling path
  covers the case that matters; the receiver adds manifest surface for a window
  where nothing is visible but the caret.
