import Constants from 'expo-constants';
import { KeyboardAvoidingView as RNKeyboardAvoidingView } from 'react-native';

export const isExpoGo = Constants.appOwnership === 'expo';

// On dev builds, use keyboard-controller's KAV (supports `translate-with-padding`,
// animates on the UI thread in lockstep with the keyboard). On Expo Go the
// native module isn't loaded — fall back to RN's built-in KAV.
export const KeyboardAvoidingView = isExpoGo
  ? RNKeyboardAvoidingView
  : require('react-native-keyboard-controller').KeyboardAvoidingView;

// Enables iOS-style interactive keyboard dismiss on both platforms (dev builds).
// `null` on Expo Go (native module not available) — callers must handle it.
export const KeyboardGestureArea = isExpoGo
  ? null
  : require('react-native-keyboard-controller').KeyboardGestureArea;

// Sticky view that translates its child up by keyboard height using Reanimated
// worklets. Unlike KAV, it does NOT measure its Y position — so ancestor
// transforms (e.g. from react-native-screen-transitions) don't affect it.
// `null` on Expo Go — callers must handle it.
export const KeyboardStickyView = isExpoGo
  ? null
  : require('react-native-keyboard-controller').KeyboardStickyView;
