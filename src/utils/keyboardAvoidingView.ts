import Constants from 'expo-constants';
import { KeyboardAvoidingView as RNKeyboardAvoidingView } from 'react-native';

export const isExpoGo = Constants.appOwnership === 'expo';

// On dev builds, use keyboard-controller's KAV (better iOS handling)
// On Expo Go, fall back to RN's built-in KAV
export const KeyboardAvoidingView = isExpoGo
  ? RNKeyboardAvoidingView
  : require('react-native-keyboard-controller').KeyboardAvoidingView;
