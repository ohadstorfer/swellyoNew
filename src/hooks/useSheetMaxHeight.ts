// useSheetMaxHeight — the ONE height cap every bottom sheet shares.
//
// WHY: a bottom sheet is pinned to the bottom of a full-screen box. If its content
// is taller than that box (long body, or the keyboard lifting it), it grows UP past
// the status bar: the grabber and header disappear under the clock, and with no
// scrim left above it there is nothing to tap to close it. Reported on the
// "Add an update" sheet with the keyboard open.
//
// The cap keeps a strip of scrim above every sheet (status bar + TOP_GAP), so the
// grabber stays visible and a tap above the sheet always closes it.
//
// `keyboardAware`: pass true when the sheet RISES with the keyboard (avoidKeyboard /
// a KeyboardAvoidingView around it). The keyboard then eats that much of the box,
// so the cap shrinks by the keyboard height. Sheets the keyboard just covers keep
// the full cap.

import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Scrim left visible above the tallest sheet, below the status bar. */
export const SHEET_TOP_GAP = 24;

function useKeyboardHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') {
      setHeight(0);
      return;
    }
    const subs =
      Platform.OS === 'ios'
        ? [
            // Derived from where the keyboard's top edge lands, like BottomSheetShell's
            // own inset: an off-screen keyboard reads 0, so nothing goes stale.
            Keyboard.addListener('keyboardWillChangeFrame', e =>
              setHeight(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY)),
            ),
            Keyboard.addListener('keyboardWillHide', () => setHeight(0)),
            Keyboard.addListener('keyboardDidHide', () => setHeight(0)),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', e => setHeight(Math.max(0, e.endCoordinates.height))),
            Keyboard.addListener('keyboardDidHide', () => setHeight(0)),
          ];
    return () => subs.forEach(s => s.remove());
  }, [enabled]);

  return height;
}

export function useSheetMaxHeight(keyboardAware = false): number {
  const { height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardH = useKeyboardHeight(keyboardAware);
  // Never collapse to nothing on a tiny window — 200 still shows grabber + header.
  return Math.max(200, windowH - insets.top - SHEET_TOP_GAP - keyboardH);
}
