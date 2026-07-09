/**
 * Wires the pure attach-panel reducer to the keyboard and the Android back button.
 *
 * The keyboard is measured with react-native-keyboard-controller, NOT RN's
 * `keyboardDidShow`. It has to be the same ruler the chat container's padding uses
 * (`useReanimatedKeyboardAnimation`), or the panel ends up a few pixels shy of the
 * keyboard and the composer steps down when they swap. RN's own measurement is also
 * the wrong one on Android: under SDK 54's mandatory edge-to-edge, `adjustResize`
 * behaves like `adjustNothing`, which is the reason this project uses rnkc at all.
 *
 * `useGenericKeyboardHandler`, not `useKeyboardHandler`: the latter claims Android's
 * soft-input mode on mount and restores it on unmount, and the screens' own
 * `useReanimatedKeyboardAnimation` already owns that. Two owners, one setting.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';
import { attachPanelReducer, initialPanelState } from './attachPanelMachine';

export interface AttachPanelApi {
  /** Whether AttachPanel is mounted. */
  panelOpen: boolean;
  panelHeight: number;
  /**
   * Whether the composer button should read "keyboard" rather than "+".
   *
   * NOT the same as `panelOpen`. The panel outlives the tap that dismisses it — it
   * has to stay mounted until the keyboard has finished rising over it — but the
   * button must answer the moment it is pressed.
   */
  showKeyboardIcon: boolean;
  togglePanel: () => void;
  closePanel: () => void;
  /** The user asked for the keyboard back. Pair with focusing the input. */
  requestKeyboard: () => void;
}

export function useAttachPanel(): AttachPanelApi {
  const [state, dispatch] = useReducer(attachPanelReducer, initialPanelState);

  // Let the listeners read `open` without re-subscribing on every toggle.
  const openRef = useRef(state.open);
  openRef.current = state.open;

  // Rounded to match the container's `Math.round(Math.abs(kbHeight.value))` exactly.
  // A sub-pixel disagreement between the two is a visible step in the composer.
  const onKeyboardShown = useCallback((height: number) => {
    dispatch({ type: 'KEYBOARD_SHOWN', height });
  }, []);

  useGenericKeyboardHandler(
    {
      onEnd: (e) => {
        'worklet';
        // Fires at the end of every keyboard transition, `height: 0` on the way out.
        // Only an arrival tells us anything: the real height, and that a panel still
        // mounted behind it can now be removed for free.
        if (e.height > 0) runOnJS(onKeyboardShown)(Math.round(e.height));
      },
    },
    [onKeyboardShown],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!openRef.current) return false;
      dispatch({ type: 'CLOSE' });
      return true;
    });
    return () => sub.remove();
  }, []);

  // Hide the keyboard only AFTER React has committed the panel.
  //
  // The keyboard is an OS window ABOVE the app, so a panel mounted while it is still
  // up sits hidden behind it, with the layout already in its final shape. Nothing our
  // side of the glass can move: the whole transition IS the keyboard's own slide.
  //
  //   opening the panel  → the keyboard slides DOWN, uncovering it
  //   leaving the panel  → the keyboard slides UP, covering it again
  //
  // Two halves of one motion, both animated by the OS, with the panel stationary
  // throughout. So the dismiss is deliberately ANIMATED — an instant one cuts the
  // downward half and reads as a hard flick against a perfectly smooth return.
  //
  // Ordering is the other half of this. dismiss() is synchronous: called from the
  // "+" handler it takes the keyboard away a frame before React paints the panel,
  // and that empty frame is a flash of bare chat background.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (state.open && !wasOpen.current) Keyboard.dismiss();
    wasOpen.current = state.open;
  }, [state.open]);

  const togglePanel = useCallback(() => dispatch({ type: 'TOGGLE' }), []);

  const closePanel = useCallback(() => dispatch({ type: 'CLOSE' }), []);

  const requestKeyboard = useCallback(() => dispatch({ type: 'KEYBOARD_REQUESTED' }), []);

  return {
    panelOpen: state.open,
    panelHeight: state.height,
    showKeyboardIcon: state.open && !state.returningToKeyboard,
    togglePanel,
    closePanel,
    requestKeyboard,
  };
}
