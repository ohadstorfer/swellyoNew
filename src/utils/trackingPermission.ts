import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

// App Tracking Transparency prompt (iOS only).
//
// Swellyo does NOT track users: no ad or attribution SDKs, no IDFA. The prompt
// exists only because App Store Connect still holds a "Device ID used to track
// you" record on our privacy label that Apple's server refuses to delete (409).
// While that record is there, App Review rejects any build without an ATT
// request (Guideline 5.1.2(i)). Remove this once Apple clears the record.
//
// The answer changes nothing in the app — there is no tracking to turn on.

// iOS ignores the request unless the app is active, so wait for 'active'.
export function requestTrackingPermissionWhenActive(): () => void {
  if (Platform.OS !== 'ios' || Constants.appOwnership === 'expo') return () => {};

  let done = false;
  const ask = async () => {
    if (done) return;
    done = true;
    try {
      const ATT = await import('expo-tracking-transparency');
      const current = await ATT.getTrackingPermissionsAsync();
      if (current.status === 'undetermined' && current.canAskAgain) {
        await ATT.requestTrackingPermissionsAsync();
      }
    } catch (err) {
      console.warn('[ATT] Tracking permission request failed (non-blocking):', err);
    }
  };

  if (AppState.currentState === 'active') {
    ask();
    return () => {};
  }
  const sub = AppState.addEventListener('change', status => {
    if (status === 'active') {
      sub.remove();
      ask();
    }
  });
  return () => sub.remove();
}
