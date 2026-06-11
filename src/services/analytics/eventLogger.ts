import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../config/supabase';
import { analyticsService } from './analyticsService';

/**
 * Names of events that should only fire once per user. The DB enforces this
 * via a UNIQUE partial index, so subsequent inserts with the same
 * (user_id, event_name) are silently dropped via ON CONFLICT DO NOTHING.
 *
 * Events NOT in this set (app_opened, swelly_search_clicked, swelly_connect_clicked)
 * write a new row every time — the dashboard counts distinct users in the date range.
 */
const ONE_SHOT_EVENTS = new Set<string>([
  'user_signed_up',
  'onboarding_step_1',
  'onboarding_step_2',
  'onboarding_step_3',
  'onboarding_step_4',
  'onboarding_step_5',
  'onboarding_step_6',
  'onboarding_step_7',
  'onboarding_finalized',
  // first_message_sent is also one-shot but it's written by a DB trigger, not the client.
]);

export interface LogEventOptions {
  userId?: string;
  conversationId?: string;
  tripId?: string;
  properties?: Record<string, unknown>;
}

/**
 * Write an analytics event to Supabase.
 *
 * - Respects the user's analytics opt-out (skips silently if opted out).
 * - For one-shot events, duplicate writes are ignored at the DB level.
 * - For repeatable events, every call creates a new row.
 * - `is_demo_user` and `is_admin` are NOT passed from the client —
 *   a BEFORE INSERT trigger sets them from the surfers row, so a malicious
 *   client can't mark itself as demo to evade dashboard exclusion.
 *
 * Fire-and-forget by design: failures are logged but do not throw or block the UI.
 */
export async function logEvent(
  eventName: string,
  opts: LogEventOptions = {}
): Promise<void> {
  if (analyticsService.getIsOptedOut()) {
    console.log(`[analytics][DEBUG] logEvent(${eventName}) SKIPPED — user opted out`);
    return;
  }

  // RLS requires user_id = auth.uid(), so derive it when the caller didn't
  // pass one (most service-layer call sites don't have it handy).
  let userId = opts.userId ?? null;
  if (!userId) {
    try {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch {
      // fall through — insert will fail RLS and be swallowed below
    }
  }

  const row = {
    event_name: eventName,
    user_id: userId,
    conversation_id: opts.conversationId ?? null,
    trip_id: opts.tripId ?? null,
    occurred_at: new Date().toISOString(),
    properties: opts.properties ?? null,
  };

  // TEMP DEBUG — remove once swelly_search_clicked logging is confirmed.
  try {
    const { data: authData } = await supabase.auth.getUser();
    console.log(`[analytics][DEBUG] logEvent(${eventName}) attempt`, {
      passedUserId: row.user_id,
      authUid: authData?.user?.id ?? null,
      uidMatch: row.user_id === (authData?.user?.id ?? null),
    });
  } catch (e) {
    console.log(`[analytics][DEBUG] logEvent(${eventName}) — could not read auth user`, e);
  }

  try {
    // Always plain INSERT. The DB's UNIQUE partial index enforces "one row per user"
    // for one-shot events; duplicate inserts get rejected at the constraint level
    // (Postgres code 23505), which we silently swallow — that's the expected
    // "already recorded" path for one-shot events. We can't use PostgREST upsert
    // here because partial unique indexes aren't supported as ON CONFLICT targets.
    const { error } = await supabase.from('analytics_events').insert(row);
    if (error) {
      const code = (error as { code?: string }).code;
      const isExpectedDuplicate = code === '23505' && ONE_SHOT_EVENTS.has(eventName);
      if (!isExpectedDuplicate) {
        console.warn(`[analytics] logEvent(${eventName}) error:`, error.message);
        // TEMP DEBUG — full error so we can see RLS / permission failures.
        console.warn(`[analytics][DEBUG] logEvent(${eventName}) FAILED — full error:`, JSON.stringify(error));
      }
    } else {
      // TEMP DEBUG — remove once confirmed.
      console.log(`[analytics][DEBUG] logEvent(${eventName}) INSERT OK ✅`);
    }
  } catch (err) {
    console.warn(`[analytics] logEvent(${eventName}) threw:`, err);
  }
}

const THROTTLE_KEY_PREFIX = 'analytics_throttle_';
const DEFAULT_THROTTLE_MS = 30 * 60 * 1000; // mirrors app_opened's 30-min window

/**
 * logEvent, but at most once per 30 min per (event, trip, user) on this device.
 * For high-frequency "presence" events (trip_opened, trip_chat_opened) where
 * the dashboard only cares about "was active that day", not how many times.
 */
export async function logEventThrottled(
  eventName: string,
  opts: LogEventOptions = {},
  throttleMs: number = DEFAULT_THROTTLE_MS
): Promise<void> {
  try {
    let userId = opts.userId ?? null;
    if (!userId) {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    }
    if (!userId) return; // not signed in — nothing to log

    const key = `${THROTTLE_KEY_PREFIX}${eventName}_${opts.tripId ?? 'global'}_${userId}`;
    const last = await AsyncStorage.getItem(key);
    const now = Date.now();
    if (last && now - parseInt(last, 10) <= throttleMs) return;
    await AsyncStorage.setItem(key, String(now));
    await logEvent(eventName, { ...opts, userId });
  } catch (err) {
    console.warn(`[analytics] logEventThrottled(${eventName}) threw:`, err);
  }
}
