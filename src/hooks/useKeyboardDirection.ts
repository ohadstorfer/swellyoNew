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
