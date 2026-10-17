import { Platform, StatusBar } from 'react-native';

/**
 * Re-send the current status-bar style (from RN's StatusBar stack) to iOS.
 *
 * RN only calls the native setStyle when it thinks the value CHANGED
 * (`_updatePropsStack` diffs against `_currentValues`). Native UI that RN does not
 * own — system permission prompts, pickers, share sheets — can reset the real bar
 * to the Info.plist default (`UIStatusBarStyleDefault` = black icons) without RN
 * knowing. RN then still believes the bar is white and never repaints it, so the
 * icons stay black until a reload. Seen right after sign-up + onboarding.
 *
 * Clearing `_currentValues` makes the next stack update push every value again.
 * Private RN API — guarded, so a future RN that drops it just makes this a no-op.
 */
export function resyncStatusBar(): void {
  if (Platform.OS !== 'ios') return;
  const sb = StatusBar as unknown as {
    _currentValues?: unknown;
    _updatePropsStack?: () => void;
  };
  if (typeof sb._updatePropsStack !== 'function') return;
  sb._currentValues = null;
  sb._updatePropsStack();
}
