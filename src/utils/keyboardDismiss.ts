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
