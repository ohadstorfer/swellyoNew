import { supabase } from '../../config/supabase';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

/**
 * Best-effort: write the device's IANA timezone (e.g. 'America/Sao_Paulo') to
 * surfers.timezone for the current user. Cheap, idempotent, never throws.
 *
 * Uses expo-localization (native layer) rather than Intl.DateTimeFormat, which
 * Hermes caches stale after the device timezone changes. Powers per-user quiet
 * hours: the enqueue trigger picks each user's next 8am-local from this value.
 *
 * In Expo Go the ExpoLocalization native module isn't available — even a
 * top-level import crashes the bundle — so gate on isExpoGo and fall back to
 * Intl there (stale-cache caveat is acceptable in a dev-only client).
 */
function getDeviceTimezone(): string | null {
  if (isExpoGo) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }
  const Localization = require('expo-localization');
  return Localization.getCalendars?.()[0]?.timeZone || null; // IANA string, or null on web
}

export async function syncDeviceTimezone(userId: string): Promise<void> {
  try {
    const tz = getDeviceTimezone();
    if (!tz) return;
    const { data } = await supabase
      .from('surfers')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();
    if (data?.timezone === tz) return;
    await supabase.from('surfers').update({ timezone: tz }).eq('user_id', userId);
  } catch (e) {
    console.warn('[deviceTimezone] sync failed (non-fatal):', e);
  }
}
