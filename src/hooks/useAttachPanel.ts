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
