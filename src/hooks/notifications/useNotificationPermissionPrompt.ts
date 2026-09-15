import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  pushNotificationService,
  type NotificationPermissionState,
} from '../../services/notifications/pushNotificationService';

const DISMISSED_AT_KEY = '@swellyo_notification_prompt_dismissed_at';

/**
 * How long after the main app appears the popup shows. The user lands on the
 * Explore tab (RootNavigator's initialRouteName is Trips, and TripsScreen opens
 * on 'explore'), so this is "a beat after Explore has painted" — long enough to
 * see where they are, short enough that it still reads as part of arriving.
 */
const PROMPT_DELAY_MS = 2500;

/**
 * After any "no" — Maybe later, the backdrop, or a refused OS prompt — leave it
 * alone for a week. Without this the popup would greet every cold start, which
 * is how a permission ask turns into something people learn to swat away.
 */
const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

interface NotificationPermissionPrompt {
  visible: boolean;
  onTurnOn: () => void;
  onDismiss: () => void;
  /**
   * Open the popup on demand, ignoring the cooldown and the once-per-session
   * rule. For the LOCAL_MODE dev menu — pass `active: false` alongside it so the
   * automatic timer never runs and only the manual trigger does.
   */
  show: () => void;
}

/**
 * Owns when the "Stay in the loop" popup appears and what its CTA does.
 *
 * The OS permission prompt is one-shot per install on iOS, and nothing else in
 * the app asks for it any more (pushNotificationService.registerForPushNotifications
 * only registers a token once permission already exists) — so this is the single
 * place that spends it.
 *
 * @param active true once the user is in the main app (post-onboarding, no
 *               overlay covering it). Starts the timer; the popup shows at most
 *               once per session.
 */
export function useNotificationPermissionPrompt(active: boolean): NotificationPermissionPrompt {
  const [visible, setVisible] = useState(false);
  /** Whether the OS will actually prompt, or Settings is the only route left. */
  const stateRef = useRef<NotificationPermissionState>('unavailable');
  const shownThisSession = useRef(false);
  /** True while the popup is up because show() opened it, not the timer. */
  const openedManually = useRef(false);

  useEffect(() => {
    if (!active || shownThisSession.current) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const state = await pushNotificationService.getPermissionState();
        // Nothing to ask for: already on, or web / simulator.
        if (cancelled || state === 'granted' || state === 'unavailable') return;

        const dismissedAt = Number(await AsyncStorage.getItem(DISMISSED_AT_KEY)) || 0;
        if (cancelled || Date.now() - dismissedAt < PROMPT_COOLDOWN_MS) return;

        stateRef.current = state;
        shownThisSession.current = true;
        openedManually.current = false;
        setVisible(true);
      } catch (err) {
        console.warn('[useNotificationPermissionPrompt] Permission check failed:', err);
      }
    }, PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active]);

  // Coming back from the system Settings screen with notifications switched on
  // leaves us granted but tokenless until the next cold start. Pick the token up
  // as soon as the app is foregrounded again.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      pushNotificationService
        .registerForPushNotifications()
        .catch(err =>
          console.warn('[useNotificationPermissionPrompt] Registration failed (non-blocking):', err)
        );
    });
    return () => sub.remove();
  }, [active]);

  const show = useCallback(() => {
    // Read the live state first so the CTA still does the right thing — the OS
    // prompt when it can still appear, Settings once it can't.
    pushNotificationService
      .getPermissionState()
      .then(state => {
        stateRef.current = state;
        openedManually.current = true;
        setVisible(true);
      })
      .catch(() => {
        openedManually.current = true;
        setVisible(true);
      });
  }, []);

  const snooze = useCallback(() => {
    // A dev-menu preview must not start the cooldown — that would silence the
    // real popup for a week just because someone looked at it.
    if (openedManually.current) return;
    AsyncStorage.setItem(DISMISSED_AT_KEY, String(Date.now())).catch(() => {});
  }, []);

  const onDismiss = useCallback(() => {
    setVisible(false);
    snooze();
  }, [snooze]);

  const onTurnOn = useCallback(() => {
    setVisible(false);

    // Already refused once: iOS will not show the prompt again, so the switch
    // lives in Settings and that is the only place this button can go.
    if (stateRef.current === 'blocked') {
      snooze();
      Linking.openSettings().catch(err =>
        console.warn('[useNotificationPermissionPrompt] Could not open Settings:', err)
      );
      return;
    }

    pushNotificationService
      .requestPermission()
      .then(result => {
        // Refused at the OS prompt — back off for the cooldown like any other no.
        if (result !== 'granted') snooze();
      })
      .catch(err => {
        console.warn('[useNotificationPermissionPrompt] Permission request failed:', err);
        snooze();
      });
  }, [snooze]);

  return { visible, onTurnOn, onDismiss, show };
}
