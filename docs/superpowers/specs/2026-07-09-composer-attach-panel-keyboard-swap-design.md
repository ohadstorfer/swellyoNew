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

We use the **persisted-height spacer**: a panel of exactly the keyboard's height,
mounted behind the keyboard, uncovered when the keyboard leaves. Plain
`Keyboard.dismiss()` — RN's own, animated. No `react-native-keyboard-controller`, so
no Expo Go caveat and no version floor.

An earlier revision forced `KeyboardController.dismiss({ animated: false })`, reasoning
that an instant hide would make the swap imperceptible. That was wrong. The panel is
stationary and the keyboard is an OS window sliding over it; the keyboard's animation
*is* the transition. Killing it produced a hard cut in one direction against a smooth
OS slide in the other. See "The motion" below.

This is an illusion, not a real swap — but it is JS-only, needs no rebuild, and runs
the same everywhere.

## State model

Per chat screen:

| State | Source | Purpose |
|---|---|---|
| `lastKeyboardHeight` | rnkc's `useGenericKeyboardHandler` `onEnd`, when `height > 0` | The panel's height. Persists across keyboard open/close. |
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

### The motion

The keyboard lives in a window **above** the app. A panel mounted while the keyboard
is still up is hidden behind it, with the layout already in its final shape. Nothing
on our side of the glass ever moves:

- **Opening the panel** — the keyboard slides *down*, uncovering it.
- **Leaving the panel** (tapping the input) — the keyboard slides *up*, covering it.

Two halves of one motion, both animated by the OS, panel stationary throughout. The
dismiss is therefore **animated on purpose**. An instant dismiss cuts the downward
half and reads as a hard flick against a perfectly smooth return.

### Order matters: mount, then dismiss

The dismiss must run **after** React has committed the panel — a `useLayoutEffect`
keyed on `open`, never the `+` handler. `Keyboard.dismiss()` is synchronous: from the
tap handler it starts the keyboard's exit a frame before the panel paints, and that
empty frame flashes bare chat background.

### The composer padding override

`animatedComposerPadding` derives `paddingBottom` from `kbProgress`, which falls to
0 as the keyboard leaves. Left alone, `insets.bottom` would reappear between the
composer and the panel. **While `panelOpen`, treat `progress` as 1.**

## Interactions

**`+` with keyboard open.** `setPanelOpen(true)`. React commits the panel behind the
still-visible keyboard; a `useLayoutEffect` then calls `Keyboard.dismiss()`, and the
keyboard slides down off it.

**`+` with keyboard closed.** `setPanelOpen(true)`. Composer padding goes to 0, the
panel takes `lastKeyboardHeight`.

**`+` with panel open.** The button is no longer a `+` — it renders a keyboard glyph
(`MaterialCommunityIcons` `keyboard-outline`; Ionicons has only `keypad`, a dialpad).
So it gives you the keyboard: it focuses the input, the keyboard rises over the panel,
and `keyboardDidShow` unmounts the panel behind it. It does **not** merely close the
panel — that would leave neither, which the icon does not promise.

The button always names where it takes you: the attachment menu, or the keyboard it
replaced. Its glyph is driven by `showKeyboardIcon`, **not** `panelOpen` — the panel
outlives the tap (it must stay mounted until the keyboard has risen over it), but a
button has to answer the moment it is pressed. `KEYBOARD_REQUESTED` splits the two.

**Tapping the text input with panel open.** The input focuses and the keyboard
animates up. The panel **stays mounted** and only unmounts once the keyboard has
fully opened (rnkc's `onEnd`). Unmounting it on focus
would leave a hole for the duration of the keyboard's open animation and drop the
composer. Because the heights match, the keyboard simply rises over the panel.

**Tapping a tile.** Close the panel, then run the handler.

**Android hardware back with panel open.** Close the panel; do not leave the screen.

## Components

`AttachSheet` today mixes the 4-tile grid with the `BottomSheetShell` that wraps it.
Split:

- **`AttachMenuGrid`** — the grid and its tile handlers, lifted verbatim.
- **`AttachPanel`** — an absolutely-positioned `View` pinned to the container's
  bottom with a fixed `height`, hosting the grid. No `Modal`, no `BottomSheetShell`.

`AttachSheet` and its `BottomSheetShell` usage are removed from both chat screens.

### The `onDismissed` workaround goes away

`AttachSheet` defers each tile's handler to the shell's `onDismissed` because a timer
once raced the slide-out and fired while iOS was still tearing down the `Modal`'s
`UIViewController`. Camera and document pickers survived (in-process); the photo
library — PHPicker, another process — blocked the main thread and the OS killed the
app. **With no `Modal` there is no teardown to wait for**, so `pendingAction` /
`onDismissed` are deleted and tiles call their handlers directly. This removal is a
consequence of the redesign, not an unrelated cleanup.

## One ruler, not two

The panel is measured with `react-native-keyboard-controller`
(`useGenericKeyboardHandler`'s `onEnd`), **not** RN's `keyboardDidShow`. It must be
the same ruler the container's padding uses (`useReanimatedKeyboardAnimation`). Mix
them and the panel lands a few pixels shy of the keyboard: with the keyboard up,
`max()` yields `kbHeight`; once it leaves, `panelHeight` — and the composer steps down
by the difference.

RN's measurement is also the wrong one on **Android**. Under SDK 54's mandatory
edge-to-edge, `adjustResize` behaves like `adjustNothing`, so RN's keyboard events
misreport. That is why this project depends on rnkc in the first place.

`useGenericKeyboardHandler`, not `useKeyboardHandler`: the latter claims Android's
soft-input mode on mount and restores it on unmount, and the screens'
`useReanimatedKeyboardAnimation` already owns that setting.

**Expo Go.** `App.tsx` skips `KeyboardProvider` there, so rnkc's default context makes
`setKeyboardHandlers` a no-op — no crash, but no measurement either, and the panel
falls back to its seed height. The container's padding is equally inert in Expo Go
(the shared value never leaves 0), so chat keyboard behaviour is already degraded
there. The panel opens; it just isn't keyboard-matched. Dev and production builds are
unaffected.

## Risks

- **The panel's height must be a fixed `height` from `lastKeyboardHeight`**, never
  `flex` and never measured on mount, or the panel collapses and re-expands.
- **The container's `paddingBottom` must be `max(|kbHeight|, panelHeight)`, not a
  branch on `panelOpen`.** A branch is correct only if React's mount and Reanimated's
  UI-thread padding update land in the same frame; when they don't, the panel's height
  and the keyboard's padding both apply and the composer leaps a keyboard's height.
  `max()` holds one value across the whole swap.
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
6. `+` works in Expo Go, identically (no library gate to trip).
7. Behaviour is identical in `DirectMessageScreen` and `DirectGroupChat`.

## Note for the implementer

`src/components/AttachSheet.tsx` and `src/components/BottomSheetShell.tsx` have
**uncommitted local changes** at the time of writing. Read them before extracting
`AttachMenuGrid` — do not extract from `HEAD`.

## Out of scope

- A real native `inputView` swap.
- Animating the panel's own entry/exit. It appears and disappears with the keyboard.
- Any change to `BottomSheetShell`, which other sheets still use.
