# Composer attach panel — in-place keyboard swap

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan
**Screens:** `src/screens/DirectMessageScreen.tsx`, `src/screens/DirectGroupChat.tsx`

## Problem

Tapping `+` in the composer while the keyboard is open dismisses the keyboard and
opens `AttachSheet` as a bottom-sheet `Modal`. The composer travels down with the
keyboard, then the sheet slides up over it. WhatsApp instead swaps the keyboard's
content area for the attachment menu in place: nothing moves.

## What we're building

The attachment menu becomes an inline panel that occupies the exact rectangle the
keyboard occupies. `+` toggles between keyboard and panel. Neither the composer nor
the message list moves during the swap, in either direction.

## Approach (and what we rejected)

A true OS-level swap — assigning a custom `inputView` to the first responder — is
**not achievable in this stack**:

- The iOS `inputView` / `reloadInputViews()` mechanism still works under Fabric, but
  hosting a Fabric-managed React subtree inside it has no public implementation. The
  only reference (`wix/react-native-keyboard-input`, `RCTCustomInputController.m`)
  wires an old-bridge `RCTRootView` and was **archived read-only on 2026-04-13**.
- Android has **no equivalent of `inputView`**. `InputMethodService` builds a
  system-wide keyboard app; it cannot embed a view in-app. The persisted-height
  technique is the only option there regardless.
- `KeyboardExtender` (rnkc) is not this API — it *increases* keyboard height, adding
  a row above the still-visible system keyboard, and carries an open iOS crash
  (kirillzyusko/react-native-keyboard-controller#1345). Do not reach for it.
- `gifted-chat#1222` asked for exactly this and was closed **wontfix**.

We use the **persisted-height spacer**, made instant by
`KeyboardController.dismiss({ animated: false })` (rnkc ≥ 1.19; project is on
**1.21.13**, verified in `node_modules`). The keyboard is hidden without animation
while a panel of identical height is already mounted, so the swap is imperceptible.
This is an illusion, not a real swap — but it is JS-only, needs no rebuild, and
degrades safely.

## State model

Per chat screen:

| State | Source | Purpose |
|---|---|---|
| `lastKeyboardHeight` | `useKeyboardHandler({ onEnd })`, recorded when `height > 0` | The panel's height. Persists across keyboard open/close. |
| `panelOpen` | `useState` | Whether `AttachPanel` is mounted. |

`lastKeyboardHeight` seeds from a constant (`iOS 291`, `Android 260` — typical
portrait-phone keyboard heights) so the first `+` of a cold session, before the
keyboard has ever been shown, still opens a correctly-sized panel. Once the real
keyboard has appeared once, the measured value is used forever after.

The chat container already carries `paddingBottom = |kbHeight|`
(`animatedKeyboardPadding`, `DirectMessageScreen.tsx:5188`) — the hole the keyboard
sits in. The panel occupies **that same hole**, never a new one.

`paddingBottom = max(|kbHeight|, panelOpen ? panelHeight : 0)`, and the panel is
**absolutely positioned** (`bottom: 0`, `height: panelHeight`) so it *fills* that
padding rather than adding to the column.

Both facts exist to kill the same class of bug. A `panelOpen ? 0 : |kbHeight|`
branch plus a panel in normal flow would be correct only if React's mount and
Reanimated's UI-thread padding update landed in the same frame; when they don't, the
panel's height and the keyboard's padding both apply and the composer leaps a
keyboard's height. With `max()`, the reserved space is `panelHeight` *throughout* the
swap — while the panel mounts under the still-visible keyboard, and after the
keyboard goes. **The value never changes, so no frame can catch the two threads
disagreeing.**

### Order matters: mount, then dismiss

The keyboard lives in a window **above** the app. A panel mounted while the keyboard
is still up is simply hidden behind it, and the layout is already in its final shape.
Dismissing afterwards does not open the panel — it uncovers one that was always
there.

So the dismiss must run **after** React has committed the panel (a `useLayoutEffect`
keyed on `open`), never inside the `+` handler. `dismissKeyboardNow()` is a
synchronous native call: from the tap handler it takes the keyboard away a frame
before the panel paints, and that one empty frame is a visible flick — close, gap,
open.

### The composer padding override

`animatedComposerPadding` derives `paddingBottom` from `kbProgress`, which falls to
0 as the keyboard leaves. Left alone, `insets.bottom` would reappear between the
composer and the panel. **While `panelOpen`, treat `progress` as 1.**

## Interactions

**`+` with keyboard open.** `setPanelOpen(true)`. React commits the panel behind the
still-visible keyboard; a `useLayoutEffect` then calls
`KeyboardController.dismiss({ animated: false, keepFocus: false })`, uncovering it.

**`+` with keyboard closed.** `setPanelOpen(true)`. Composer padding goes to 0, the
panel takes `lastKeyboardHeight`.

**`+` with panel open.** `setPanelOpen(false)`. `insets.bottom` returns to the
composer.

**Tapping the text input with panel open.** The input focuses and the keyboard
animates up. The panel **stays mounted** and only unmounts once the keyboard has
fully opened (`useKeyboardHandler` `onEnd`, `height > 0`). Unmounting it on focus
would leave a hole for the duration of the keyboard's open animation and drop the
composer. Because the heights match, the keyboard simply rises over the panel.

**Tapping a tile.** Close the panel, then run the handler.

**Android hardware back with panel open.** Close the panel; do not leave the screen.

## Components

`AttachSheet` today mixes the 4-tile grid with the `BottomSheetShell` that wraps it.
Split:

- **`AttachMenuGrid`** — the grid and its tile handlers, lifted verbatim.
- **`AttachPanel`** — a plain `View` with a fixed `height` hosting the grid. No
  `Modal`, no `BottomSheetShell`.

`AttachSheet` and its `BottomSheetShell` usage are removed from both chat screens.

### The `onDismissed` workaround goes away

`AttachSheet` defers each tile's handler to the shell's `onDismissed` because a timer
once raced the slide-out and fired while iOS was still tearing down the `Modal`'s
`UIViewController`. Camera and document pickers survived (in-process); the photo
library — PHPicker, another process — blocked the main thread and the OS killed the
app. **With no `Modal` there is no teardown to wait for**, so `pendingAction` /
`onDismissed` are deleted and tiles call their handlers directly. This removal is a
consequence of the redesign, not an unrelated cleanup.

## Expo Go

`KeyboardController` comes from `react-native-keyboard-controller`, whose native
module **is not present in Expo Go** — the reason `src/utils/keyboardAvoidingView.ts`
already gates rnkc's views behind `isExpoGo`. `AttachPanel` must fall back to RN's
`Keyboard.dismiss()` behind that same guard. Expo Go then shows the keyboard's slide;
dev and production builds do not. Without the guard, `+` crashes in Expo Go.

## Risks

- **`dismiss({ animated: false })` on iOS is documented but unverified** against RN
  0.81 / Fabric / iOS 18. If iOS animates anyway, the swap degrades to a ~250ms
  slide revealing the panel — visually acceptable, not a regression. Verify on device
  first.
- **The panel's height must be a fixed `height` from `lastKeyboardHeight`**, never
  `flex` and never measured on mount, or the panel collapses and re-expands.
- **Split keyboard / floating keyboard on iPad** reports height 0. Out of scope; the
  panel falls back to its seed constant.

## Acceptance criteria

1. With the keyboard open, `+` shows the menu with **zero** movement of the composer
   or the last message bubble.
2. With the panel open, tapping the input raises the keyboard with zero movement of
   the composer.
3. `+` toggles the panel closed; `insets.bottom` returns.
4. Android back closes the panel instead of leaving the chat.
5. Choosing Photos does not crash (the PHPicker regression the `Modal` caused).
6. `+` works in Expo Go without crashing.
7. Behaviour is identical in `DirectMessageScreen` and `DirectGroupChat`.

## Note for the implementer

`src/components/AttachSheet.tsx` and `src/components/BottomSheetShell.tsx` have
**uncommitted local changes** at the time of writing. Read them before extracting
`AttachMenuGrid` — do not extract from `HEAD`.

## Out of scope

- A real native `inputView` swap.
- Animating the panel's own entry/exit. It appears and disappears with the keyboard.
- Any change to `BottomSheetShell`, which other sheets still use.
