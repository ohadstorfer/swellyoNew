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
  toPreset,
  type CancellationPolicy,
} from './cancellationPolicy';

/** The operator's reusable waiver PDF. A template — see `defaultWaiver` below. */
export interface DefaultWaiver {
  path: string;
  name: string;
  hash: string;
  sizeBytes: number | null;
  uploadedAt: string;
}

/**
 * The operator's insurance certificate.
 *
 * No hash, unlike {@link DefaultWaiver}: the waiver is copied onto every trip
 * and a traveler agrees to that exact file, so its hash proves what they
 * agreed to. This is a certificate Swellyo holds ABOUT the operator — nothing
 * is derived from it and nobody agrees to it.
 */
export interface OperatorInsurance {
  path: string;
  name: string;
  mime: string;
  sizeBytes: number | null;
  uploadedAt: string;
}

export interface OperatorSettings {
  /** null means "follow my profile country", same as display_currency's Auto. */
  defaultCurrency: string | null;
  policy: CancellationPolicy;
  /**
   * When the operator explicitly accepted each of these.
   *
   * NOT the same question as "is there a value". Both settings have working
   * defaults, so both always have a value — these record that a human looked,
   * which is what operator setup is actually asking. See `operatorSetup.ts`.
   */
  currencyConfirmedAt: string | null;
  policyConfirmedAt: string | null;
  /**
   * The default waiver, or null.
   *
   * A TEMPLATE, never the document a traveler agrees to: it is copied into
   * `<trip_id>/operator/<uuid>.pdf` at publish. See `copyDefaultWaiverToTrip`.
   */
  defaultWaiver: DefaultWaiver | null;
  insurance: OperatorInsurance | null;
  /** When they accepted, and WHICH version — a stale version is not accepted. */
  termsAcceptedAt: string | null;
  termsVersion: string | null;
}

export const EMPTY_OPERATOR_SETTINGS: OperatorSettings = {
  defaultCurrency: null,
  policy: DEFAULT_POLICY,
  currencyConfirmedAt: null,
  policyConfirmedAt: null,
  defaultWaiver: null,
  insurance: null,
  termsAcceptedAt: null,
  termsVersion: null,
};

const SETTINGS_COLUMNS =
  'default_currency, cancellation_preset, cancellation_rules, cancellation_notes, ' +
  'currency_confirmed_at, policy_confirmed_at, default_waiver_path, ' +
  'default_waiver_name, default_waiver_hash, default_waiver_size_bytes, ' +
  'default_waiver_uploaded_at, insurance_path, insurance_name, insurance_mime, ' +
  'insurance_size_bytes, insurance_uploaded_at, terms_accepted_at, terms_version';

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
    .select(SETTINGS_COLUMNS)
    .eq('user_id', uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return EMPTY_OPERATOR_SETTINGS;

  const row = data as any;
  return {
    defaultCurrency: row.default_currency ?? null,
    policy: {
      // toPreset, not a cast: the CHECK still allows a value the type no longer
      // has ('flexible'), and a cast would let it through to crash explain().
      preset: toPreset(row.cancellation_preset),
      rules: rulesFromWire(row.cancellation_rules),
      notes: row.cancellation_notes ?? null,
    },
    currencyConfirmedAt: row.currency_confirmed_at ?? null,
    policyConfirmedAt: row.policy_confirmed_at ?? null,
    // Gated on path AND hash. The CHECK constraint enforces the same pairing,
    // but a half-row read as a whole waiver would publish a trip whose document
    // cannot be proven — the one thing the hash exists to prevent.
    defaultWaiver:
      row.default_waiver_path && row.default_waiver_hash
        ? {
            path: row.default_waiver_path,
            name: row.default_waiver_name ?? 'waiver.pdf',
            hash: row.default_waiver_hash,
            sizeBytes: row.default_waiver_size_bytes ?? null,
            uploadedAt: row.default_waiver_uploaded_at,
          }
        : null,
    insurance: row.insurance_path
      ? {
          path: row.insurance_path,
          name: row.insurance_name ?? 'insurance',
          mime: row.insurance_mime ?? 'application/pdf',
          sizeBytes: row.insurance_size_bytes ?? null,
          uploadedAt: row.insurance_uploaded_at,
        }
      : null,
    termsAcceptedAt: row.terms_accepted_at ?? null,
    termsVersion: row.terms_version ?? null,
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
  /**
   * Stamp the matching `*_confirmed_at`. Setting a value and confirming it are
   * separate on purpose: the Settings screen lets an operator change their
   * currency without that being an onboarding event, and the setup flow
   * confirms the DEFAULT without changing anything.
   */
  confirmCurrency?: boolean;
  confirmPolicy?: boolean;
  defaultWaiver?: DefaultWaiver | null;
  insurance?: OperatorInsurance | null;
  /** Stamps `terms_accepted_at` AND the version that was accepted. */
  acceptTermsVersion?: string;
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
  // now(), not a client clock. These stamps decide whether an operator may
  // sell, and a phone with the wrong date should not get a say in that.
  if (patch.confirmCurrency) row.currency_confirmed_at = new Date().toISOString();
  if (patch.confirmPolicy) row.policy_confirmed_at = new Date().toISOString();

  if ('defaultWaiver' in patch) {
    const w = patch.defaultWaiver;
    row.default_waiver_path = w?.path ?? null;
    row.default_waiver_name = w?.name ?? null;
    row.default_waiver_hash = w?.hash ?? null;
    row.default_waiver_size_bytes = w?.sizeBytes ?? null;
    row.default_waiver_uploaded_at = w?.uploadedAt ?? null;
  }

  if ('insurance' in patch) {
    const i = patch.insurance;
    row.insurance_path = i?.path ?? null;
    row.insurance_name = i?.name ?? null;
    row.insurance_mime = i?.mime ?? null;
    row.insurance_size_bytes = i?.sizeBytes ?? null;
    row.insurance_uploaded_at = i?.uploadedAt ?? null;
  }

  if (patch.acceptTermsVersion) {
    // Both together. The CHECK refuses a timestamp with no version, and a
    // version with no timestamp could never answer "when".
    row.terms_accepted_at = new Date().toISOString();
    row.terms_version = patch.acceptTermsVersion;
  }

  const { error } = await supabase
    .from('operator_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (error) throw error;
}
