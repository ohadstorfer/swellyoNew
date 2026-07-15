import { Platform } from 'react-native';

// Safe wrapper around expo-haptics. The module ships in Expo Go, but older
// production binaries built before it was added don't have the native side —
// the lazy require + try/catch keeps an OTA onto those builds from crashing.
// Web is a no-op.
let Haptics: typeof import('expo-haptics') | null = null;
if (Platform.OS !== 'web') {
  try {
    Haptics = require('expo-haptics');
  } catch {
    Haptics = null;
  }
}

const safe = (run: (h: typeof import('expo-haptics')) => Promise<unknown>) => {
  if (!Haptics) return;
  try {
    run(Haptics).catch(() => {});
  } catch {}
};

/** Subtle tick — sending a message, swipe-to-reply trigger, minor confirmations. */
export const hapticLight = () =>
  safe(h => h.impactAsync(h.ImpactFeedbackStyle.Light));

/** Firmer tap — long-press menus opening, consequential CTAs (join/withdraw). */
export const hapticMedium = () =>
  safe(h => h.impactAsync(h.ImpactFeedbackStyle.Medium));

/** Picker-style tick — choosing a reaction, toggling a selection. */
export const hapticSelection = () => safe(h => h.selectionAsync());

/** Positive outcome — request approved, commitment sent, upload finished. */
export const hapticSuccess = () =>
  safe(h => h.notificationAsync(h.NotificationFeedbackType.Success));

/** Something went wrong — failed send/save surfaced to the user. */
export const hapticError = () =>
  safe(h => h.notificationAsync(h.NotificationFeedbackType.Error));
