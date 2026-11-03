import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  pushNotificationService,
  type NotificationPermissionState,
} from '../../services/notifications/pushNotificationService';
import {
  subscribeToNotificationAsks,
  type NotificationAskContext,
} from '../../services/notifications/notificationAsks';
import { logEvent } from '../../services/analytics/eventLogger';

const DISMISSED_AT_KEY = '@swellyo_notification_prompt_dismissed_at';
/** Per-context "last shown" — `${prefix}${context}`. */
const CONTEXT_SHOWN_AT_PREFIX = '@swellyo_notification_prompt_shown_at:';
/** Timestamps of every popup shown, for the daily cap. */
const SHOWN_LOG_KEY = '@swellyo_notification_prompt_shown_log';

/**
 * How long after the main app appears the popup shows. The user lands on the
 * Explore tab (RootNavigator's initialRouteName is Trips, and TripsScreen opens
 * on 'explore'), so this is "a beat after Explore has painted" — long enough to
 * see where they are, short enough that it still reads as part of arriving.
 */
const PROMPT_DELAY_MS = 2500;

/**
 * A contextual ask waits a beat after the moment that triggered it, so the
 * popup follows the user's action instead of landing on top of it.
 */
const CONTEXT_DELAY_MS = 700;

/**
 * After any "no" — Maybe later, the backdrop, or a refused OS prompt — leave it
 * alone for a week. Without this the popup would greet every cold start, which
 * is how a permission ask turns into something people learn to swat away.
 */
const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Each contextual moment asks at most once per week, whatever the answer. */
const CONTEXT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * At most this many popups per rolling day, all contexts together, and never
 * two within a minute — a join request that is auto-approved fires both
 * trip_request and trip_approved back to back.
 */
const MAX_SHOWN_PER_DAY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;

interface NotificationPermissionPrompt {
  visible: boolean;
  /** Which moment the popup is for — picks its title and subtitle. */
  context: NotificationAskContext;
  /** The OS will not prompt again; the CTA goes to Settings. */
  blocked: boolean;
  onTurnOn: () => void;
  onDismiss: () => void;
  /**
   * Open the popup on demand, ignoring the cooldown and the once-per-session
   * rule. For the LOCAL_MODE dev menu — pass `active: false` alongside it so the
   * automatic timer never runs and only the manual trigger does.
   */
  show: () => void;
}

async function readShownLog(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(SHOWN_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is number => typeof t === 'number') : [];
  } catch {
    return [];
  }
}

/** True when the daily cap and the minimum gap both allow another popup. */
async function withinShowBudget(now: number): Promise<boolean> {
  const recent = (await readShownLog()).filter(t => now - t < DAY_MS);
  if (recent.length >= MAX_SHOWN_PER_DAY) return false;
  return !recent.some(t => now - t < MIN_GAP_MS);
}

async function recordShown(now: number, context: NotificationAskContext): Promise<void> {
  const recent = (await readShownLog()).filter(t => now - t < DAY_MS);
  await AsyncStorage.setItem(SHOWN_LOG_KEY, JSON.stringify([...recent, now]));
  if (context !== 'arrival') {
    await AsyncStorage.setItem(`${CONTEXT_SHOWN_AT_PREFIX}${context}`, String(now));
  }
}

/**
 * Owns when the "Stay in the loop" popup appears and what its CTA does.
 *
 * The OS permission prompt is one-shot per install on iOS, and nothing else in
 * the app asks for it any more (pushNotificationService.registerForPushNotifications
 * only registers a token once permission already exists) — so this is the single
 * place that spends it.
 *
 * Two ways in:
 *  - `arrival` — a few seconds after reaching the main app, once per session,
 *    with a week's cooldown after any "no".
 *  - contextual — askForNotifications() from the moment it matters (a join
 *    request, an approval, a sent message). Once per week per moment, skipped
 *    when permission is blocked (that route is Settings, and the arrival popup
 *    and the Settings row already offer it).
 * Both share a cap of two popups a day.
 *
 * Every show and answer is logged (notification_prompt_*), so the funnel can be
 * read from analytics_events.
 *
 * @param active true once the user is in the main app (post-onboarding, no
 *               overlay covering it). Starts the timer; contextual asks that
 *               arrive while it is false wait until it turns true.
 */
export function useNotificationPermissionPrompt(active: boolean): NotificationPermissionPrompt {
  const [visible, setVisible] = useState(false);
  const [context, setContext] = useState<NotificationAskContext>('arrival');
  const [blocked, setBlocked] = useState(false);
  /** Whether the OS will actually prompt, or Settings is the only route left. */
  const stateRef = useRef<NotificationPermissionState>('unavailable');
  const contextRef = useRef<NotificationAskContext>('arrival');
  const shownThisSession = useRef(false);
  /** True while the popup is up because show() opened it, not the timer. */
  const openedManually = useRef(false);
  /** Set when the CTA sent the user to Settings — read on the way back. */
  const sentToSettings = useRef(false);
  /** A contextual ask waiting for the main app to be clear. Latest wins. */
  const [pendingContext, setPendingContext] = useState<NotificationAskContext | null>(null);
  const visibleRef = useRef(false);
  visibleRef.current = visible;

  const open = useCallback(
    (ctx: NotificationAskContext, state: NotificationPermissionState, manual: boolean) => {
      stateRef.current = state;
      contextRef.current = ctx;
      openedManually.current = manual;
      setContext(ctx);
      setBlocked(state === 'blocked');
      // A contextual ask can land right after typing (message_sent) — the
      // keyboard would otherwise sit on top of the popup's CTA.
      Keyboard.dismiss();
      setVisible(true);
      if (!manual) {
        logEvent('notification_prompt_shown', { properties: { context: ctx, state } });
      }
    },
    []
  );

  // ── arrival ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || shownThisSession.current) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const state = await pushNotificationService.getPermissionState();
        // Nothing to ask for: already on, or web / simulator.
        if (cancelled || state === 'granted' || state === 'unavailable') return;

        const dismissedAt = Number(await AsyncStorage.getItem(DISMISSED_AT_KEY)) || 0;
        const now = Date.now();
        if (cancelled || now - dismissedAt < PROMPT_COOLDOWN_MS) return;
        if (!(await withinShowBudget(now)) || cancelled || visibleRef.current) return;

        shownThisSession.current = true;
        await recordShown(now, 'arrival');
        open('arrival', state, false);
      } catch (err) {
        console.warn('[useNotificationPermissionPrompt] Permission check failed:', err);
      }
    }, PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, open]);

  // ── contextual ─────────────────────────────────────────────────────────
  useEffect(() => subscribeToNotificationAsks(ctx => setPendingContext(ctx)), []);

  useEffect(() => {
    if (!active || !pendingContext || visible) return;
    const ctx = pendingContext;

    let cancelled = false;
    const timer = setTimeout(async () => {
      // Cleared at the end, not here: changing pendingContext re-runs this
      // effect, and its cleanup would cancel the check mid-flight.
      try {
        const state = await pushNotificationService.getPermissionState();
        if (cancelled) return;
        if (state === 'granted' || state === 'unavailable' || state === 'blocked') return;

        const now = Date.now();
        const lastShown = Number(await AsyncStorage.getItem(`${CONTEXT_SHOWN_AT_PREFIX}${ctx}`)) || 0;
        if (cancelled || now - lastShown < CONTEXT_COOLDOWN_MS) return;
        if (!(await withinShowBudget(now)) || cancelled || visibleRef.current) return;

        // Counts as this session's popup too, so the arrival timer does not
        // stack a second one behind it.
        shownThisSession.current = true;
        await recordShown(now, ctx);
        open(ctx, state, false);
      } catch (err) {
        console.warn('[useNotificationPermissionPrompt] Contextual ask failed:', err);
      } finally {
        // A cancelled check (the main app got covered) keeps the ask for later.
        if (!cancelled) setPendingContext(prev => (prev === ctx ? null : prev));
      }
    }, CONTEXT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, pendingContext, visible, open]);

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
      if (sentToSettings.current) {
        sentToSettings.current = false;
        pushNotificationService
          .getPermissionState()
          .then(state =>
            logEvent('notification_permission_result', {
              properties: { context: contextRef.current, source: 'settings', result: state },
            })
          )
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [active]);

  const show = useCallback(() => {
    // Read the live state first so the CTA still does the right thing — the OS
    // prompt when it can still appear, Settings once it can't.
    pushNotificationService
      .getPermissionState()
      .then(state => open('arrival', state, true))
      .catch(() => open('arrival', 'undetermined', true));
  }, [open]);

  const snooze = useCallback(() => {
    // A dev-menu preview must not start the cooldown — that would silence the
    // real popup for a week just because someone looked at it. Contextual asks
    // have their own per-moment cooldown, set when they were shown.
    if (openedManually.current || contextRef.current !== 'arrival') return;
    AsyncStorage.setItem(DISMISSED_AT_KEY, String(Date.now())).catch(() => {});
  }, []);

  const onDismiss = useCallback(() => {
    setVisible(false);
    snooze();
    if (!openedManually.current) {
      logEvent('notification_prompt_dismissed', {
        properties: { context: contextRef.current, state: stateRef.current },
      });
    }
  }, [snooze]);

  const onTurnOn = useCallback(() => {
    setVisible(false);
    const ctx = contextRef.current;
    const track = !openedManually.current;
    if (track) {
      logEvent('notification_prompt_accepted', {
        properties: { context: ctx, state: stateRef.current },
      });
    }

    // Already refused once: iOS will not show the prompt again, so the switch
    // lives in Settings and that is the only place this button can go.
    if (stateRef.current === 'blocked') {
      snooze();
      if (track) sentToSettings.current = true;
      Linking.openSettings().catch(err =>
        console.warn('[useNotificationPermissionPrompt] Could not open Settings:', err)
      );
      return;
    }

    pushNotificationService
      .requestPermission()
      .then(result => {
        if (track) {
          logEvent('notification_permission_result', {
            properties: { context: ctx, source: 'os_prompt', result },
          });
        }
        // Refused at the OS prompt — back off for the cooldown like any other no.
        if (result !== 'granted') snooze();
      })
      .catch(err => {
        console.warn('[useNotificationPermissionPrompt] Permission request failed:', err);
        snooze();
      });
  }, [snooze]);

  return { visible, context, blocked, onTurnOn, onDismiss, show };
}
