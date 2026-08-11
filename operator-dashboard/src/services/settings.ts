/**
 * The operator's own defaults.
 *
 * ⚠️ THE FIRST WRITES THIS SITE HAS EVER DONE. Every other service here reads.
 * They are confined to `operator_settings`, whose RLS allows the owner and
 * nobody else, so the widest possible blast radius is one operator's own
 * defaults. See Rule 1 in docs/SPEC.md, amended when this landed.
 *
 * The row is created lazily — an operator who has never opened this page has no
 * row — so "not found" is the defaults, not an error.
 */
import { supabase } from '../lib/supabase';
import {
  DEFAULT_POLICY,
  rulesFromWire,
  rulesToWire,
  type CancellationPolicy,
  type CancellationPreset,
} from '../domain/cancellation';

export interface OperatorSettings {
  /** null = follow the operator's profile country. */
  defaultCurrency: string | null;
  policy: CancellationPolicy;
}

export const EMPTY_SETTINGS: OperatorSettings = {
  defaultCurrency: null,
  policy: DEFAULT_POLICY,
};

export async function fetchOperatorSettings(userId: string): Promise<OperatorSettings> {
  const { data, error } = await supabase
    .from('operator_settings')
    .select('default_currency, cancellation_preset, cancellation_rules, cancellation_notes')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return EMPTY_SETTINGS;

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
 * Partial on purpose: currency and policy save separately, and sending the
 * whole object from one form would let it overwrite the other with whatever it
 * happened to load a minute ago.
 */
export async function saveOperatorSettings(
  userId: string,
  patch: { defaultCurrency?: string | null; policy?: CancellationPolicy },
): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId };

  if ('defaultCurrency' in patch) {
    row.default_currency = patch.defaultCurrency ?? null;
  }
  if (patch.policy) {
    row.cancellation_preset = patch.policy.preset;
    row.cancellation_rules = rulesToWire(patch.policy.rules);
    row.cancellation_notes = patch.policy.notes?.trim() || null;
  }

  const { error } = await supabase
    .from('operator_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (error) throw error;
}

/** The 14 currencies the database CHECK allows, in the app's order. */
export const CURRENCIES = [
  'USD', 'ILS', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD',
  'CHF', 'BRL', 'JPY', 'SEK', 'NOK', 'DKK', 'ZAR',
] as const;

// ── Stripe Connect ─────────────────────────────────────────────────────────
/**
 * Whether this operator can be paid, read straight off `operator_payout_accounts`.
 *
 * The site does NOT run Connect onboarding itself — that flow lives in the app,
 * behind an edge function that needs the Stripe secret key. Rebuilding it here
 * would mean a second onboarding path to keep in step with Stripe's six states.
 * So this reports the state and sends them to the app to finish it.
 */
export interface PayoutState {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export async function fetchPayoutState(userId: string): Promise<PayoutState> {
  const { data, error } = await supabase
    .from('operator_payout_accounts')
    .select('stripe_account_id, charges_enabled, payouts_enabled, details_submitted')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  const row = data as any;
  return {
    hasAccount: Boolean(row?.stripe_account_id),
    chargesEnabled: Boolean(row?.charges_enabled),
    payoutsEnabled: Boolean(row?.payouts_enabled),
    detailsSubmitted: Boolean(row?.details_submitted),
  };
}
