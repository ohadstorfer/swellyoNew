/**
 * Wires the pure attach-panel reducer to the keyboard and the Android back button.
 *
 * Everything here rides on RN's own Keyboard API, so it behaves identically in Expo
 * Go and in dev/prod builds.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { BackHandler, Keyboard } from 'react-native';
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

  return {
    panelOpen: state.open,
    panelHeight: state.height,
    togglePanel,
    closePanel,
  };
}
