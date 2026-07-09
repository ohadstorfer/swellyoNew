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
  /** Whether AttachPanel is mounted. */
  open: boolean;
  height: number;
  /**
   * The user asked for the keyboard back, but it hasn't finished rising yet.
   *
   * The panel must stay mounted for that whole animation (see KEYBOARD_SHOWN), yet
   * the composer button has to stop saying "keyboard" the instant it is pressed —
   * a button should answer to the intent, not to the end of an animation. So the
   * two are tracked apart: `open` drives the panel, `!returningToKeyboard` drives
   * the icon.
   */
  returningToKeyboard: boolean;
}

export type PanelAction =
  | { type: 'TOGGLE' }
  | { type: 'CLOSE' }
  | { type: 'KEYBOARD_REQUESTED' }
  | { type: 'KEYBOARD_SHOWN'; height: number };

export const initialPanelState: PanelState = {
  open: false,
  height: SEED_KEYBOARD_HEIGHT,
  returningToKeyboard: false,
};

export function attachPanelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'TOGGLE':
      return { ...state, open: !state.open, returningToKeyboard: false };
    case 'CLOSE':
      return state.open ? { ...state, open: false, returningToKeyboard: false } : state;
    case 'KEYBOARD_REQUESTED':
      // Nothing to return to if the panel isn't up.
      return state.open ? { ...state, returningToKeyboard: true } : state;
    case 'KEYBOARD_SHOWN':
      return {
        // iPad's floating/split keyboard reports 0 — keep the last real value.
        height: action.height > 0 ? action.height : state.height,
        // The keyboard has FINISHED rising. If the panel is still mounted the user
        // tapped the input, and the keyboard came up over a panel of identical
        // height — so removing it now costs no layout change.
        open: false,
        returningToKeyboard: false,
      };
    default:
      return state;
  }
}
