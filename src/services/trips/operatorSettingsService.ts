/**
 * An operator's own defaults: the currency they price in, and the cancellation
 * policy new trips start from.
 *
 * Reads and writes `public.operator_settings`, which is RLS'd to the owner —
 * there is no way to read anyone else's from here, and no need to pass a user
 * id around.
 *
 * The row is created lazily. Most operators will never have one until they open
 * settings, so every read has to treat "no row" as "the defaults", not as an
 * error. That is why `fetchOperatorSettings` never returns null.
 */
import { supabase } from '../../config/supabase';
import {
  DEFAULT_POLICY,
  rulesFromWire,
  rulesToWire,
  type CancellationPolicy,
  type CancellationPreset,
} from './cancellationPolicy';

export interface OperatorSettings {
  /** null means "follow my profile country", same as display_currency's Auto. */
  defaultCurrency: string | null;
  policy: CancellationPolicy;
}

export const EMPTY_OPERATOR_SETTINGS: OperatorSettings = {
  defaultCurrency: null,
  policy: DEFAULT_POLICY,
};

/**
 * Is the signed-in account an operator?
 *
 * Read fresh rather than taken from the cached profile: `surfers.operator` can
 * be turned on by a Swellyo admin while the app is open, and the cached profile
 * blob predates the column entirely for anyone who has not refreshed. Mirrors
 * how `isCurrentUserAdmin` is used on the same screen.
 *
 * Fails CLOSED — an error is "not an operator", never "show them the section".
 */
export async function fetchIsOperator(): Promise<boolean> {
  try {
    // getSession, not getUser: getUser has no timeout and has hung long enough
    // to blank a screen, and this runs on Settings mount.
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return false;

    const { data: row, error } = await supabase
      .from('surfers')
      .select('operator')
      .eq('user_id', uid)
      .maybeSingle();

    if (error) {
      console.warn('[operatorSettings] operator flag read failed:', error.message);
      return false;
    }
    return Boolean((row as any)?.operator);
  } catch (e) {
    console.warn('[operatorSettings] operator flag read threw:', e);
    return false;
  }
}

export async function fetchOperatorSettings(): Promise<OperatorSettings> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return EMPTY_OPERATOR_SETTINGS;

  const { data, error } = await supabase
    .from('operator_settings')
    .select('default_currency, cancellation_preset, cancellation_rules, cancellation_notes')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return EMPTY_OPERATOR_SETTINGS;

  const row = data as any;
  return {
    defaultCurrency: row.default_currency ?? null,
    policy: {
      preset: (row.cancellation_preset ?? 'standard') as CancellationPreset,
      rules: rulesFromWire(row.cancellation_rules),
      notes: row.cancellation_notes ?? null,
    },
  };
}

/**
 * Upsert the caller's row.
 *
 * A partial patch on purpose: the currency sheet and the policy sheet save
 * independently, and sending the whole object from either would let a stale
 * copy of the other overwrite a change made seconds earlier.
 */
export async function saveOperatorSettings(patch: {
  defaultCurrency?: string | null;
  policy?: CancellationPolicy;
}): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('Not signed in');

  const row: Record<string, unknown> = { user_id: uid };

  if ('defaultCurrency' in patch) {
    row.default_currency = patch.defaultCurrency ?? null;
  }
  if (patch.policy) {
    row.cancellation_preset = patch.policy.preset;
    // Sent even for a non-custom preset. The trigger clears it, but sending
    // the real value keeps the client honest if the trigger is ever relaxed.
    row.cancellation_rules = rulesToWire(patch.policy.rules);
    row.cancellation_notes = patch.policy.notes?.trim() || null;
  }

  const { error } = await supabase
    .from('operator_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (error) throw error;
}
