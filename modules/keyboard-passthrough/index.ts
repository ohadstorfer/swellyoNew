/**
 * JS face of the keyboard-passthrough PROTOTYPE.
 *
 * Hands the focused text input a transparent `inputView` of the keyboard's exact
 * height. The keyboard window stays open but draws nothing, so the attach panel
 * already mounted behind it shows through — with no slide to animate and nothing to
 * synchronise. See the Swift file for why this is the only shape of the WhatsApp
 * swap available to a React Native app.
 *
 * Every export degrades to `false` when the native side is absent (Expo Go, web,
 * Android, a build that predates the module). `requireOptionalNativeModule` returns
 * null instead of throwing, so callers never need a try/catch.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeKeyboardPassthrough = {
  activate(height: number): Promise<boolean>;
  deactivate(): Promise<boolean>;
};

const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<NativeKeyboardPassthrough>('KeyboardPassthrough')
  : null;

/** True when the native module is present and this platform can do the swap. */
export const isKeyboardPassthroughAvailable = native != null;

/**
 * Blank the keyboard in place, keeping it open and the field focused.
 *
 * `height` MUST be the keyboard's current height. A mismatch makes UIKit animate
 * the keyboard's frame, which moves the composer — the jump the panel exists to
 * avoid.
 *
 * Resolves false when nothing is focused, or the module is absent.
 */
export async function activateKeyboardPassthrough(height: number): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.activate(height);
  } catch {
    return false;
  }
}

/** Give the system keyboard back. The field keeps focus, so it slides up itself. */
export async function deactivateKeyboardPassthrough(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.deactivate();
  } catch {
    return false;
  }
}
