/**
 * Wires the pure attach-panel reducer to the keyboard and the Android back button.
 *
 * Keyboard heights and the "keyboard has finished opening" signal come from RN's own
 * Keyboard events, which work in Expo Go. Only the instant dismiss needs
 * react-native-keyboard-controller — see dismissKeyboardNow().
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
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

  // Hide the keyboard only AFTER React has committed the panel.
  //
  // The keyboard lives in a window above the app, so a panel mounted while it is
  // still up is simply hidden behind it — the layout is already its final shape,
  // nothing moves. Dismissing then does not "open" the panel; it uncovers one that
  // was always there.
  //
  // Calling dismiss() inside togglePanel() instead — a synchronous native call —
  // took the keyboard away a frame before React painted the panel. That one empty
  // frame is the "flick": close, gap, open.
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (state.open && !wasOpen.current) dismissKeyboardNow();
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
