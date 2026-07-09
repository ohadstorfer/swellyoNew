# Composer Attach Panel — In-Place Keyboard Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping `+` in the chat composer replaces the keyboard's rectangle with the attachment menu in place — the composer and message list do not move, in either direction.

**Architecture:** The chat container already reserves `paddingBottom = |kbHeight|` for the keyboard. The panel occupies that same rectangle: when it is open, that padding drops to `0` and an `AttachPanel` of exactly `lastKeyboardHeight` is mounted below the composer. Both totals are equal, so nothing shifts. The keyboard is hidden with `KeyboardController.dismiss({ animated: false })` in the same tick the panel mounts.

**Tech Stack:** React Native 0.81, Expo 54, `react-native-keyboard-controller` 1.21.13, Reanimated 3, Jest (`jest-expo`).

**Testing note:** `@testing-library/react-native` is **not installed** — every test in this repo exercises pure logic (`currency.test.ts`, `tripRole.test.ts`, `ProfileImage.resolveSource.test.ts`). This plan does not add it. Instead the panel's decision-making lives in a pure reducer (`attachPanelMachine.ts`) that is fully unit-tested, and the hook and components around it stay thin enough to be verified by `tsc` plus the on-device checklist.

**Spec:** `docs/superpowers/specs/2026-07-09-composer-attach-panel-keyboard-swap-design.md`

## Global Constraints

- Keyboard **height measurement** and the **"keyboard finished opening"** signal use React Native's own `Keyboard` listeners (`keyboardDidShow` / `keyboardDidHide`), which work in Expo Go. Only the *instant dismiss* needs `react-native-keyboard-controller`.
- `react-native-keyboard-controller`'s native module is **absent in Expo Go**. Any use of `KeyboardController` must sit behind `isExpoGo` from `src/utils/keyboardAvoidingView.ts` and fall back to RN's `Keyboard.dismiss()`.
- Panel height must be a fixed `height` taken from the persisted value. **Never `flex`, never measured on mount** — the panel would collapse and re-expand.
- Seed heights before the keyboard has ever been shown: **iOS `291`, Android `260`**.
- Do **not** modify `src/components/BottomSheetShell.tsx`. Other sheets depend on it.
- `src/components/AttachSheet.tsx`, `BottomSheetShell.tsx` and `ChatTextInput.tsx` have **uncommitted local changes**. Extract from the working tree, not from `HEAD`.
- Everything in `DirectMessageScreen.tsx` must be mirrored exactly in `DirectGroupChat.tsx`.
- This is JS-only. No native rebuild, no new dependency.

---

### Task 1: `dismissKeyboardNow()` — the only Expo-Go-sensitive call

**Files:**
- Create: `src/utils/keyboardDismiss.ts`
- Test: `src/utils/__tests__/keyboardDismiss.test.ts`

**Interfaces:**
- Produces: `dismissKeyboardNow(): void` — hides the keyboard without animation on dev/prod builds; falls back to RN's animated `Keyboard.dismiss()` in Expo Go.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/keyboardDismiss.test.ts
const mockRnDismiss = jest.fn();
const mockControllerDismiss = jest.fn();

jest.mock('react-native', () => ({
  Keyboard: { dismiss: mockRnDismiss },
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { dismiss: mockControllerDismiss },
}));

describe('dismissKeyboardNow', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRnDismiss.mockClear();
    mockControllerDismiss.mockClear();
  });

  it('dismisses without animation on a dev build', () => {
    jest.doMock('../keyboardAvoidingView', () => ({ isExpoGo: false }));
    const { dismissKeyboardNow } = require('../keyboardDismiss');
    dismissKeyboardNow();
    expect(mockControllerDismiss).toHaveBeenCalledWith({ animated: false, keepFocus: false });
    expect(mockRnDismiss).not.toHaveBeenCalled();
  });

  it('falls back to RN Keyboard.dismiss in Expo Go', () => {
    jest.doMock('../keyboardAvoidingView', () => ({ isExpoGo: true }));
    const { dismissKeyboardNow } = require('../keyboardDismiss');
    dismissKeyboardNow();
    expect(mockRnDismiss).toHaveBeenCalled();
    expect(mockControllerDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/utils/__tests__/keyboardDismiss.test.ts`
Expected: FAIL — `Cannot find module '../keyboardDismiss'`.

- [ ] **Step 3: Implement**

```ts
// src/utils/keyboardDismiss.ts
/**
 * Hide the keyboard with no animation, so a panel mounted in its place in the
 * same tick reads as an in-place swap rather than a dismiss-then-open.
 *
 * `KeyboardController` comes from react-native-keyboard-controller, whose native
 * module is not present in Expo Go — the same reason keyboardAvoidingView.ts gates
 * that library's views. There we fall back to RN's Keyboard.dismiss(), which always
 * animates: the swap degrades to a slide in Expo Go only.
 */
import { Keyboard } from 'react-native';
import { isExpoGo } from './keyboardAvoidingView';

export function dismissKeyboardNow(): void {
  if (isExpoGo) {
    Keyboard.dismiss();
    return;
  }
  const { KeyboardController } = require('react-native-keyboard-controller');
  KeyboardController.dismiss({ animated: false, keepFocus: false });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx jest src/utils/__tests__/keyboardDismiss.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/keyboardDismiss.ts src/utils/__tests__/keyboardDismiss.test.ts
git commit -m "feat(chat): dismissKeyboardNow() — instant hide, Expo Go fallback"
```

---

### Task 2: `attachPanelMachine` — the pure reducer

**Files:**
- Create: `src/hooks/attachPanelMachine.ts`
- Test: `src/hooks/__tests__/attachPanelMachine.test.ts`

**Interfaces:**
- Produces:

```ts
export const SEED_KEYBOARD_HEIGHT: number;   // 291 on iOS, 260 on Android
export interface PanelState { open: boolean; height: number }
export type PanelAction =
  | { type: 'TOGGLE' }
  | { type: 'CLOSE' }
  | { type: 'KEYBOARD_SHOWN'; height: number };
export const initialPanelState: PanelState;
export function attachPanelReducer(state: PanelState, action: PanelAction): PanelState;
```

The rules, all of them pure:
- `KEYBOARD_SHOWN` adopts `height` when `> 0` (iPad's floating keyboard reports `0`; keep the last real value), and **always closes the panel**. That is the deferred unmount: the keyboard has *finished* rising over a panel of identical height, so removing it now costs no layout change. Closing on focus instead would leave a hole for the length of the open animation and drop the composer.
- `TOGGLE` flips `open`. The side effect of dismissing the keyboard belongs to the hook, not the reducer.
- `CLOSE` closes. Idempotent.

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/__tests__/attachPanelMachine.test.ts
import {
  attachPanelReducer,
  initialPanelState,
  SEED_KEYBOARD_HEIGHT,
  type PanelState,
} from '../attachPanelMachine';

const open = (s: PanelState = initialPanelState) => attachPanelReducer(s, { type: 'TOGGLE' });

describe('attachPanelReducer', () => {
  it('starts closed at the seed height', () => {
    expect(initialPanelState).toEqual({ open: false, height: SEED_KEYBOARD_HEIGHT });
  });

  it('TOGGLE opens, then closes', () => {
    const opened = open();
    expect(opened.open).toBe(true);
    expect(attachPanelReducer(opened, { type: 'TOGGLE' }).open).toBe(false);
  });

  it('CLOSE is idempotent', () => {
    const closed = attachPanelReducer(open(), { type: 'CLOSE' });
    expect(closed.open).toBe(false);
    expect(attachPanelReducer(closed, { type: 'CLOSE' }).open).toBe(false);
  });

  it('KEYBOARD_SHOWN adopts a real height', () => {
    const s = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_SHOWN', height: 336 });
    expect(s.height).toBe(336);
  });

  it('KEYBOARD_SHOWN ignores a zero height (iPad floating keyboard)', () => {
    const measured = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_SHOWN', height: 336 });
    const zeroed = attachPanelReducer(measured, { type: 'KEYBOARD_SHOWN', height: 0 });
    expect(zeroed.height).toBe(336);
  });

  it('KEYBOARD_SHOWN closes the panel — the deferred unmount', () => {
    const s = attachPanelReducer(open(), { type: 'KEYBOARD_SHOWN', height: 336 });
    expect(s.open).toBe(false);
    expect(s.height).toBe(336);
  });

  it('TOGGLE preserves the measured height', () => {
    const measured = attachPanelReducer(initialPanelState, { type: 'KEYBOARD_SHOWN', height: 336 });
    expect(open(measured).height).toBe(336);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/hooks/__tests__/attachPanelMachine.test.ts`
Expected: FAIL — `Cannot find module '../attachPanelMachine'`.

- [ ] **Step 3: Implement**

```ts
// src/hooks/attachPanelMachine.ts
/**
 * Pure state machine for the composer's attachment panel, which occupies the exact
 * rectangle the keyboard occupies (see the chat container's animatedKeyboardPadding).
 *
 * The panel's height is the LAST MEASURED keyboard height, so opening it while the
 * keyboard is up swaps one for the other with no layout change.
 */
import { Platform } from 'react-native';

/** Typical portrait-phone keyboard height, used until the real one is measured. */
export const SEED_KEYBOARD_HEIGHT = Platform.OS === 'ios' ? 291 : 260;

export interface PanelState {
  open: boolean;
  height: number;
}

export type PanelAction =
  | { type: 'TOGGLE' }
  | { type: 'CLOSE' }
  | { type: 'KEYBOARD_SHOWN'; height: number };

export const initialPanelState: PanelState = {
  open: false,
  height: SEED_KEYBOARD_HEIGHT,
};

export function attachPanelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'TOGGLE':
      return { ...state, open: !state.open };
    case 'CLOSE':
      return state.open ? { ...state, open: false } : state;
    case 'KEYBOARD_SHOWN':
      return {
        // iPad's floating/split keyboard reports 0 — keep the last real value.
        height: action.height > 0 ? action.height : state.height,
        // The keyboard has FINISHED rising. If the panel is still mounted the user
        // tapped the input, and the keyboard came up over a panel of identical
        // height — so removing it now costs no layout change.
        open: false,
      };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx jest src/hooks/__tests__/attachPanelMachine.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/attachPanelMachine.ts src/hooks/__tests__/attachPanelMachine.test.ts
git commit -m "feat(chat): pure reducer for the composer attach panel"
```

---

### Task 2b: `useAttachPanel` — the glue

**Files:**
- Create: `src/hooks/useAttachPanel.ts`

**Interfaces:**
- Consumes: `dismissKeyboardNow()` (Task 1), `attachPanelReducer` / `initialPanelState` (Task 2).
- Produces:

```ts
export interface AttachPanelApi {
  panelOpen: boolean;
  panelHeight: number;
  togglePanel: () => void;   // the "+" button
  closePanel: () => void;    // tiles
}
export function useAttachPanel(): AttachPanelApi;
```

No unit test: every decision lives in the reducer, already tested. What remains is subscription wiring, verified by `tsc` and the device checklist.

- [ ] **Step 1: Implement**

```ts
// src/hooks/useAttachPanel.ts
/**
 * Wires the pure attach-panel reducer to the keyboard and the Android back button.
 *
 * Keyboard heights and the "keyboard has finished opening" signal come from RN's own
 * Keyboard events, which work in Expo Go. Only the instant dismiss needs
 * react-native-keyboard-controller — see dismissKeyboardNow().
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { dismissKeyboardNow } from '../utils/keyboardDismiss';
import { attachPanelReducer, initialPanelState } from './attachPanelMachine';

export interface AttachPanelApi {
  panelOpen: boolean;
  panelHeight: number;
  togglePanel: () => void;
  closePanel: () => void;
}

export function useAttachPanel(): AttachPanelApi {
  const [state, dispatch] = useReducer(attachPanelReducer, initialPanelState);

  // Let the listeners read `open` without re-subscribing on every toggle.
  const openRef = useRef(state.open);
  openRef.current = state.open;

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      dispatch({ type: 'KEYBOARD_SHOWN', height: e?.endCoordinates?.height ?? 0 });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!openRef.current) return false;
      dispatch({ type: 'CLOSE' });
      return true;
    });
    return () => sub.remove();
  }, []);

  const togglePanel = useCallback(() => {
    // Read the ref, not `state`, so the callback identity stays stable.
    // Opening hides the keyboard in the SAME tick the panel mounts — that
    // simultaneity is what makes it read as a swap rather than a close-then-open.
    if (!openRef.current) dismissKeyboardNow();
    dispatch({ type: 'TOGGLE' });
  }, []);

  const closePanel = useCallback(() => dispatch({ type: 'CLOSE' }), []);

  return {
    panelOpen: state.open,
    panelHeight: state.height,
    togglePanel,
    closePanel,
  };
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit 2>&1 | grep -cE '^(src|App)/'   # expect 38
git add src/hooks/useAttachPanel.ts
git commit -m "feat(chat): useAttachPanel — keyboard + back-button wiring"
```

---

### Task 3: `AttachMenuGrid` + `AttachPanel`

**Files:**
- Create: `src/components/AttachMenuGrid.tsx`
- Create: `src/components/AttachPanel.tsx`
- Read first (uncommitted!): `src/components/AttachSheet.tsx`

No unit test: rendering these needs `@testing-library/react-native`, which this repo does not have. Both components are declarative pass-throughs with no branching. `tsc` covers the wiring; acceptance criteria 1–6 cover the behaviour.

**Interfaces:**
- Produces:

```tsx
export interface AttachMenuActions {
  onPhotos: () => void;
  onCamera: () => void;
  onDocument: () => void;
  onContact: () => void;
}
export function AttachMenuGrid(props: AttachMenuActions): JSX.Element;
export function AttachPanel(props: AttachMenuActions & { height: number }): JSX.Element;
```

Lift the `tiles` array, `styles.grid`, `styles.tile`, `styles.iconCircle` and `styles.tileLabel` **verbatim** from the working-tree `AttachSheet.tsx` into `AttachMenuGrid`. Drop `styles.grabber` (a panel is not draggable) and the `paddingBottom: insets.bottom` (the panel sits where the keyboard sat — there is no home-indicator gap to clear).

**Do not carry over `pendingAction` / `onClose` / the `choose()` wrapper.** They exist only because a tile's handler could not run while iOS tore down the `Modal`'s `UIViewController` — PHPicker (out-of-process) hung the main thread and the OS killed the app. `AttachPanel` has no `Modal`, so tiles call their handlers directly. Closing the panel is the screen's job (Task 4).

- [ ] **Step 1: Implement `AttachMenuGrid`**

```tsx
// src/components/AttachMenuGrid.tsx
/**
 * The 4-tile attachment menu. Lifted out of AttachSheet so it can be hosted by
 * AttachPanel (inline, in the keyboard's rectangle) rather than a bottom sheet.
 *
 * Tiles call their handlers directly. The old `pendingAction`/`onDismissed` dance
 * existed only because a handler firing while iOS tore down the sheet's Modal could
 * hang the main thread on PHPicker. There is no Modal here.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff, fs } from '../theme/fonts';

export interface AttachMenuActions {
  onPhotos: () => void;
  onCamera: () => void;
  onDocument: () => void;
  onContact: () => void;
}

type Tile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  hidden?: boolean;
};

export function AttachMenuGrid({ onPhotos, onCamera, onDocument, onContact }: AttachMenuActions) {
  const tiles: Tile[] = [
    { key: 'photos', label: 'Photos', icon: 'images', color: '#2E6FF2', onPress: onPhotos },
    { key: 'camera', label: 'Camera', icon: 'camera', color: '#3C4043', onPress: onCamera, hidden: Platform.OS === 'web' },
    { key: 'document', label: 'Document', icon: 'document-text', color: '#4E9BFF', onPress: onDocument },
    { key: 'contact', label: 'Contact', icon: 'person', color: '#5A616B', onPress: onContact },
  ];

  return (
    <View style={styles.grid}>
      {tiles.filter(t => !t.hidden).map(t => (
        <Pressable
          key={t.key}
          style={styles.tile}
          onPress={t.onPress}
          android_ripple={{ color: 'rgba(0,0,0,0.06)', borderless: false }}
          hitSlop={6}
        >
          <View style={styles.iconCircle}>
            <Ionicons name={t.icon} size={26} color={t.color} />
          </View>
          <Text style={styles.tileLabel}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

Copy `grid`, `tile`, `iconCircle` and `tileLabel` from the working-tree `AttachSheet.tsx` `StyleSheet.create` block verbatim into a `StyleSheet.create` here.

- [ ] **Step 2: Implement `AttachPanel`**

```tsx
// src/components/AttachPanel.tsx
/**
 * The attachment menu rendered inline, filling the exact rectangle the keyboard
 * occupies. Its height is passed in (the last measured keyboard height) and is a
 * FIXED height on purpose: `flex` or measure-on-mount would collapse the panel and
 * re-expand it, which is the jump this whole design exists to avoid.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AttachMenuGrid, type AttachMenuActions } from './AttachMenuGrid';

export function AttachPanel({ height, ...actions }: AttachMenuActions & { height: number }) {
  return (
    <View testID="attach-panel" style={[styles.panel, { height }]}>
      <AttachMenuGrid {...actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#D9D9D9',
    paddingTop: 22,
    paddingHorizontal: 20,
  },
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -cE '^(src|App)/'`
Expected: `38` — the baseline. Neither file may add an error.

- [ ] **Step 4: Commit**

```bash
git add src/components/AttachMenuGrid.tsx src/components/AttachPanel.tsx
git commit -m "feat(chat): AttachPanel — the attach menu as a keyboard-sized inline panel"
```

---

### Task 4: Wire it into `DirectMessageScreen`

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx`

**Interfaces:**
- Consumes: `useAttachPanel()` (Task 2), `AttachPanel` (Task 3).

There is no unit test here — the screen is a 5,000-line component with live Supabase subscriptions. Correctness is enforced by the hook's tests plus the on-device acceptance criteria. Verify with `npx tsc --noEmit` (the `src/` error count must stay at its **38-error baseline**).

- [ ] **Step 1: Replace the `attachSheetVisible` state**

Delete `const [attachSheetVisible, setAttachSheetVisible] = useState(false);` (line ~547) and add, next to the other keyboard state (near line 575):

```tsx
const { panelOpen, panelHeight, togglePanel, closePanel } = useAttachPanel();
```

Add the imports:

```tsx
import { useAttachPanel } from '../hooks/useAttachPanel';
import { AttachPanel } from '../components/AttachPanel';
```

Remove `import { AttachSheet } from '../components/AttachSheet';`.

- [ ] **Step 2: Make the container yield its padding to the panel**

The panel occupies the keyboard's rectangle, so the container must not also reserve it. Change `animatedKeyboardPadding` (line ~576):

```tsx
// The panel occupies the keyboard's rectangle. When it's mounted it supplies that
// height itself, so the container must not reserve it too — or the composer jumps
// by a full keyboard height.
const animatedKeyboardPadding = useAnimatedStyle(() => ({
  paddingBottom: panelOpen ? 0 : Math.round(Math.abs(kbHeight.value)),
}), [panelOpen]);
```

- [ ] **Step 3: Keep the composer flush against the panel**

`animatedComposerPadding` shrinks the composer's own bottom padding to 0 as the keyboard arrives, driven by `kbProgress`. With the keyboard gone but the panel up, `kbProgress` is 0 and `insets.bottom` would reappear *between the composer and the panel*. Treat an open panel as a fully-open keyboard (line ~584):

```tsx
const animatedComposerPadding = useAnimatedStyle(() => {
  // An open panel stands in for a fully-open keyboard: same rectangle, same rule.
  const p = panelOpen ? 1 : Math.min(1, Math.max(0, kbProgress.value));
  return { paddingBottom: Math.round(composerRestPadding * (1 - p)) };
}, [panelOpen]);
```

- [ ] **Step 4: Point `+` at the toggle**

At line ~5168, replace `onPress={() => setAttachSheetVisible(true)}` with:

```tsx
onPress={togglePanel}
```

- [ ] **Step 5: Mount the panel under the composer**

In the `inner` tree (line ~5169), immediately after `{composer}` and still inside the `Reanimated.View` that carries `animatedKeyboardPadding`:

```tsx
{composer}
{panelOpen && (
  <AttachPanel
    height={panelHeight}
    onPhotos={() => { closePanel(); handleAttachPhotos(); }}
    onCamera={() => { closePanel(); handleAttachCamera(); }}
    onDocument={() => { closePanel(); handleAttachDocument(); }}
    onContact={() => { closePanel(); handleAttachContact(); }}
  />
)}
```

Use whatever handler names the deleted `<AttachSheet>` element (line ~5242) passed to `onPhotos` / `onCamera` / `onDocument` / `onContact` — copy them across verbatim, then delete the `<AttachSheet>` element.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -cE '^(src|App)/'`
Expected: `38` — unchanged from baseline. Any other number means this task introduced an error.

Run: `npx tsc --noEmit 2>&1 | grep DirectMessageScreen`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/screens/DirectMessageScreen.tsx
git commit -m "feat(chat): swap the keyboard for the attach panel in 1:1 chats"
```

---

### Task 5: Mirror it in `DirectGroupChat`

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx`

**Interfaces:**
- Consumes: `useAttachPanel()` (Task 2), `AttachPanel` (Task 3).

`DirectGroupChat` carries the same composer, the same `animatedKeyboardPadding` / `animatedComposerPadding` pair, and the same `attachSheetVisible` state (line ~495). Apply **every step of Task 4** to it, at the group-chat line numbers: `+` button at ~5023, `<AttachSheet>` element at ~5081.

- [ ] **Step 1: Apply Task 4 Steps 1–5 to `DirectGroupChat.tsx`**

Same imports, same `useAttachPanel()` call, same two `useAnimatedStyle` edits, same `onPress={togglePanel}`, same `{panelOpen && <AttachPanel .../>}` placed right after `{composer}` inside the `animatedKeyboardPadding` view. Copy the four handler names from the group chat's own `<AttachSheet>` element, then delete it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -cE '^(src|App)/'`
Expected: `38`.

Run: `npx tsc --noEmit 2>&1 | grep DirectGroupChat`
Expected: no output.

- [ ] **Step 3: Confirm the two screens really match**

Run: `grep -c "useAttachPanel\|AttachPanel\|panelOpen" src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx`
Expected: the same count for both files.

- [ ] **Step 4: Commit**

```bash
git add src/screens/DirectGroupChat.tsx
git commit -m "feat(chat): swap the keyboard for the attach panel in group chats"
```

---

### Task 6: Delete `AttachSheet`

**Files:**
- Delete: `src/components/AttachSheet.tsx`

`BottomSheetShell.tsx` keeps its `onDismissed` prop — the spec puts it out of scope, and it is a sound escape hatch for any other sheet that presents native UI.

- [ ] **Step 1: Prove nothing imports it**

Run: `grep -rn "AttachSheet" src/`
Expected: no output. If anything remains, fix that call site before deleting.

- [ ] **Step 2: Delete and verify**

```bash
git rm src/components/AttachSheet.tsx
npx tsc --noEmit 2>&1 | grep -cE '^(src|App)/'   # expect 38
npx jest --silent                                 # expect only the pre-existing tripsListRealtime failures
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(chat): drop AttachSheet, superseded by AttachPanel"
```

---

## Device verification (the part no test covers)

Run through the spec's acceptance criteria on a **dev build** (Expo Go can't do the instant dismiss):

1. Keyboard open → `+` → menu appears with **zero** movement of the composer or the last bubble.
2. Panel open → tap the input → keyboard rises with zero movement of the composer.
3. `+` again → panel closes, `insets.bottom` returns.
4. Android back with the panel open → panel closes, chat stays.
5. Photos → PHPicker opens, no crash.
6. Same on both 1:1 and group chats.
7. Then Expo Go: `+` must not crash (the keyboard will slide — that's expected there).

**If iOS animates the keyboard down anyway** (the spec flags `dismiss({animated:false})` as documented-but-unverified on RN 0.81 / Fabric / iOS 18), the result degrades to a ~250 ms slide revealing the panel. Not a regression — report it, don't chase it.
