import * as Localization from 'expo-localization';
import { supabase } from '../../config/supabase';

/**
 * Best-effort: write the device's IANA timezone (e.g. 'America/Sao_Paulo') to
 * surfers.timezone for the current user. Cheap, idempotent, never throws.
 *
 * Uses expo-localization (native layer) rather than Intl.DateTimeFormat, which
 * Hermes caches stale after the device timezone changes. Powers per-user quiet
 * hours: the enqueue trigger picks each user's next 8am-local from this value.
 */
export async function syncDeviceTimezone(userId: string): Promise<void> {
  try {
    const tz = Localization.getCalendars?.()[0]?.timeZone || null; // IANA string, or null on web
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
