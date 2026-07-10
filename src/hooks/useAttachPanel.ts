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
import {
  activateKeyboardPassthrough,
  deactivateKeyboardPassthrough,
  isKeyboardPassthroughAvailable,
} from '../../modules/keyboard-passthrough';
import { attachPanelReducer, initialPanelState } from './attachPanelMachine';

/**
 * PROTOTYPE FLAG. When true and the native module is present (iOS dev build), the
 * keyboard is not dismissed to reveal the panel — it is left open with a transparent
 * `inputView`, so it draws nothing and the panel behind it shows through. No slide,
 * nothing to synchronise. Flip to false to fall back to the shipped behaviour.
 *
 * The whole prototype hangs on ONE unverified assumption: that UIKit paints no
 * opaque backdrop behind a custom inputView. If it does, you will see grey and this
 * flag comes back out.
 */
const KEYBOARD_PASSTHROUGH_PROTOTYPE = true;

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
  /**
   * Dismiss the panel without summoning the keyboard. For taps that land on the
   * chat's background — the same gesture that dismisses the keyboard — and for
   * Android's back button.
   */
  closePanel: () => void;
  /** The user asked for the keyboard back. Pair with focusing the input. */
  requestKeyboard: () => void;
}

export function useAttachPanel(): AttachPanelApi {
  const [state, dispatch] = useReducer(attachPanelReducer, initialPanelState);

  // Let the listeners read `open` without re-subscribing on every toggle.
  const openRef = useRef(state.open);
  openRef.current = state.open;

  /** True while the keyboard is open but blanked by a transparent inputView. */
  const passthroughActive = useRef(false);
  const usePassthrough = KEYBOARD_PASSTHROUGH_PROTOTYPE && isKeyboardPassthroughAvailable;

  // Rounded to match the container's `Math.round(Math.abs(kbHeight.value))` exactly.
  // A sub-pixel disagreement between the two is a visible step in the composer.
  const onKeyboardShown = useCallback((height: number) => {
    // In passthrough the keyboard never left, so an arrival event here would be the
    // transparent inputView settling — not the user asking for the keyboard back.
    // Acting on it would tear the panel down while it is still the visible surface.
    if (passthroughActive.current) return;
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
    if (state.open && !wasOpen.current) {
      if (usePassthrough) {
        // Blank the keyboard in place. It stays open, so there is no slide at all.
        activateKeyboardPassthrough(state.height).then((applied) => {
          passthroughActive.current = applied;
          // `false` means nothing was focused — the keyboard was already gone, and
          // dismissing is the no-op that keeps the two paths identical.
          if (!applied) Keyboard.dismiss();
        });
      } else {
        Keyboard.dismiss();
      }
    }
    wasOpen.current = state.open;
    // `state.height` is read, not tracked: re-running on a height change would
    // re-activate mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, usePassthrough]);

  const togglePanel = useCallback(() => dispatch({ type: 'TOGGLE' }), []);

  const closePanel = useCallback(() => {
    if (passthroughActive.current) {
      passthroughActive.current = false;
      // Restore the real keyboard BEFORE dismissing. Once the field resigns first
      // responder we can no longer find it to clear the transparent inputView, and
      // the next focus would raise a blank keyboard.
      deactivateKeyboardPassthrough().then(() => Keyboard.dismiss());
    }
    dispatch({ type: 'CLOSE' });
  }, []);

  const requestKeyboard = useCallback(() => {
    if (passthroughActive.current) {
      passthroughActive.current = false;
      // The keyboard never left; clearing the inputView brings it straight back.
      // Nothing to defer — there is no open animation to cover, so close now.
      deactivateKeyboardPassthrough();
      dispatch({ type: 'CLOSE' });
      return;
    }
    dispatch({ type: 'KEYBOARD_REQUESTED' });
  }, []);

  return {
    panelOpen: state.open,
    panelHeight: state.height,
    showKeyboardIcon: state.open && !state.returningToKeyboard,
    togglePanel,
    closePanel,
    requestKeyboard,
  };
}
