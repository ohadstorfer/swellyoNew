/**
 * JS face of the keyboard-direction native module. Every export degrades to
 * an inert value when the native side is absent (Expo Go, web, autolinking
 * failure) — requireOptionalNativeModule returns null instead of throwing, so
 * callers never need a try/catch and the app behaves exactly as before the
 * module existed.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export type KeyboardDirection = 'ltr' | 'rtl';

type NativeKeyboardDirection = {
  getDirection(): KeyboardDirection | null;
  addListener(
    eventName: 'onChange',
    listener: (event: { direction: KeyboardDirection }) => void
  ): { remove(): void };
};

const native = requireOptionalNativeModule<NativeKeyboardDirection>('KeyboardDirection');

/** Cached native read. Null = module absent or direction not yet known. */
export function getKeyboardDirection(): KeyboardDirection | null {
  if (!native) return null;
  try {
    return native.getDirection() ?? null;
  } catch {
    return null;
  }
}

/** iOS-only push events (Android modules emit nothing). Null where unsupported. */
export function addKeyboardDirectionListener(
  listener: (direction: KeyboardDirection) => void
): { remove(): void } | null {
  if (!native || typeof native.addListener !== 'function') return null;
  return native.addListener('onChange', (event) => {
    if (event?.direction === 'ltr' || event?.direction === 'rtl') {
      listener(event.direction);
    }
  });
}
