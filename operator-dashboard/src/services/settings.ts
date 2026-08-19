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
  deriveConnectState,
  type ConnectState,
  type ConnectStatus,
} from '../domain/connect';
import {
  DEFAULT_POLICY,
  rulesFromWire,
  rulesToWire,
  toPreset,
  type CancellationPolicy,
} from '../domain/cancellation';

/** The operator's reusable waiver PDF. A template — copied per trip by the app. */
export interface DefaultWaiver {
  path: string;
  name: string;
  hash: string;
  sizeBytes: number | null;
  uploadedAt: string;
}

export interface OperatorSettings {
  /** null = follow the operator's profile country. */
  defaultCurrency: string | null;
  policy: CancellationPolicy;
  /**
   * When the operator explicitly accepted each of these.
   *
   * NOT the same question as "is there a value". Both settings have working
   * defaults, so both always have one — these record that a human looked, which
   * is what setup actually asks. See `domain/operatorSetup.ts`.
   */
  currencyConfirmedAt: string | null;
  policyConfirmedAt: string | null;
  defaultWaiver: DefaultWaiver | null;
  insurance: OperatorInsurance | null;
  /** When they accepted, and WHICH version — a stale version is not accepted. */
  termsAcceptedAt: string | null;
  termsVersion: string | null;
}

/**
 * The operator's insurance certificate. No hash, unlike the waiver: nothing is
 * copied onto a trip and nobody agrees to this file, so there is nothing to
 * prove it against later.
 */
export interface OperatorInsurance {
  path: string;
  name: string;
  mime: string;
  sizeBytes: number | null;
  uploadedAt: string;
}

export const EMPTY_SETTINGS: OperatorSettings = {
  defaultCurrency: null,
  policy: DEFAULT_POLICY,
  currencyConfirmedAt: null,
  policyConfirmedAt: null,
  defaultWaiver: null,
  insurance: null,
  termsAcceptedAt: null,
  termsVersion: null,
};

// One literal, not a concatenation: supabase-js parses this at the type level.
const SETTINGS_COLUMNS =
  'default_currency, cancellation_preset, cancellation_rules, cancellation_notes, currency_confirmed_at, policy_confirmed_at, default_waiver_path, default_waiver_name, default_waiver_hash, default_waiver_size_bytes, default_waiver_uploaded_at, insurance_path, insurance_name, insurance_mime, insurance_size_bytes, insurance_uploaded_at, terms_accepted_at, terms_version';

export async function fetchOperatorSettings(userId: string): Promise<OperatorSettings> {
  const { data, error } = await supabase
    .from('operator_settings')
    .select(SETTINGS_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return EMPTY_SETTINGS;

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
    // Gated on path AND hash. A half-row read as a whole waiver would let a
    // trip publish a document that cannot be proven, which is the one thing the
    // hash exists for.
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
 * Partial on purpose: currency and policy save separately, and sending the
 * whole object from one form would let it overwrite the other with whatever it
 * happened to load a minute ago.
 */
export async function saveOperatorSettings(
  userId: string,
  patch: {
    defaultCurrency?: string | null;
    policy?: CancellationPolicy;
    /**
     * Stamp the matching `*_confirmed_at`. Setting a value and confirming it
     * are separate: Settings lets an operator change their currency without
     * that being an onboarding event, and the setup page confirms the DEFAULT
     * without changing anything.
     */
    confirmCurrency?: boolean;
    confirmPolicy?: boolean;
    defaultWaiver?: DefaultWaiver | null;
    insurance?: OperatorInsurance | null;
    /** Stamps `terms_accepted_at` AND the version that was accepted. */
    acceptTermsVersion?: string;
  },
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

/**
 * Upload (or replace) the operator's insurance certificate — photo OR PDF.
 *
 * An insurance certificate is a paper document at least as often as a file, so
 * refusing a photo would send an operator off to find a scanner. The storage
 * policy for `defaults/` was widened to the bucket's whole allowlist for this.
 *
 * The extension drives BOTH the object name and the content type: the policy
 * matches on the extension, the bucket's `allowed_mime_types` on the type, and
 * a mismatch is a 400 that reads like a permissions error.
 */
const INSURANCE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

export async function uploadOperatorInsurance(
  userId: string,
  file: File,
  previousPath?: string | null,
): Promise<OperatorInsurance> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const mime = INSURANCE_MIME[ext];
  if (!mime) throw new Error('Use a PDF or a photo (JPG, PNG or HEIC).');

  const path = `defaults/${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('group-trip-documents')
    .upload(path, file, { contentType: mime, upsert: false });
  if (upErr) throw upErr;

  if (previousPath && previousPath !== path) {
    const { error: rmErr } = await supabase.storage
      .from('group-trip-documents')
      .remove([previousPath]);
    if (rmErr) console.warn('[settings] old insurance not removed:', rmErr.message);
  }

  return {
    path,
    name: file.name || 'insurance',
    mime,
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Upload (or replace) the operator's default waiver template.
 *
 * ⚠️ THE SECOND THING THIS SITE WRITES, and the first outside a table. It is
 * confined to `defaults/<user_id>/` in the documents bucket, whose policies
 * (added by the app's `20260811000000_operator_onboarding.sql`) allow only the
 * owner to insert, read and delete. Same narrow boundary as
 * `operator_settings`: the worst a bug here reaches is one operator's own file.
 * Recorded in Rule 1 of docs/SPEC.md.
 *
 * The OLD object is deleted only AFTER the new one is up — a failed upload must
 * never leave an operator with no waiver at all, and an orphan is cheaper than
 * a gap. Nothing else points at the old object: trips hold their own copies.
 *
 * The hash is REQUIRED. This file is copied into every future trip, so an
 * unhashable template would quietly produce unprovable waivers on all of them.
 */
export async function uploadDefaultWaiver(
  userId: string,
  file: File,
  previousPath?: string | null,
): Promise<DefaultWaiver> {
  if (file.type !== 'application/pdf') {
    throw new Error('The waiver has to be a PDF.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Must match the storage policy regex exactly: ^defaults/<uuid>/<uuid>\.pdf$
  const path = `defaults/${userId}/${crypto.randomUUID()}.pdf`;

  const { error: upErr } = await supabase.storage
    .from('group-trip-documents')
    .upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw upErr;

  if (previousPath && previousPath !== path) {
    const { error: rmErr } = await supabase.storage
      .from('group-trip-documents')
      .remove([previousPath]);
    // An orphan template is invisible and owner-only. Failing the upload over
    // it would not be.
    if (rmErr) console.warn('[settings] old default waiver not removed:', rmErr.message);
  }

  return {
    path,
    name: file.name || 'waiver.pdf',
    hash,
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
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
  /** requirements.currently_due — Stripe is waiting on the operator. */
  currentlyDue: string[];
  /** requirements.past_due — the same, but a deadline has already passed. */
  pastDue: string[];
  /** requirements.disabled_reason. ⚠️ NOT a rejection flag on its own — see
   *  `deriveConnectState`, which is the only thing allowed to interpret it. */
  disabledReason: string | null;
}

/** Nothing known. Used when the row is missing or the read failed. */
export const NO_PAYOUT: PayoutState = {
  hasAccount: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  currentlyDue: [],
  pastDue: [],
  disabledReason: null,
};

export async function fetchPayoutState(userId: string): Promise<PayoutState> {
  const { data, error } = await supabase
    .from('operator_payout_accounts')
    .select(
      'stripe_account_id, charges_enabled, payouts_enabled, details_submitted, ' +
        // Added 2026-08-05 by the app side and never read here, which is why a
        // REFUSED account used to show up as "Stripe still needs information
        // from you". The Connect webhook and the daily sweep keep them fresh.
        'requirements_due, requirements_past_due, disabled_reason',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  const row = data as any;
  return {
    hasAccount: Boolean(row?.stripe_account_id),
    chargesEnabled: Boolean(row?.charges_enabled),
    payoutsEnabled: Boolean(row?.payouts_enabled),
    detailsSubmitted: Boolean(row?.details_submitted),
    currentlyDue: Array.isArray(row?.requirements_due) ? row.requirements_due : [],
    pastDue: Array.isArray(row?.requirements_past_due) ? row.requirements_past_due : [],
    disabledReason: row?.disabled_reason ?? null,
  };
}

/** The payout row as the shared Connect rule wants it. */
export function connectStatusOf(p: PayoutState): ConnectStatus {
  return {
    // The rule only asks whether an account exists, never which one, and this
    // site has no use for the id itself.
    accountId: p.hasAccount ? 'acct' : null,
    chargesEnabled: p.chargesEnabled,
    payoutsEnabled: p.payoutsEnabled,
    detailsSubmitted: p.detailsSubmitted,
    currentlyDue: p.currentlyDue,
    pastDue: p.pastDue,
    disabledReason: p.disabledReason,
  };
}

/** This operator's Connect state, in one call. */
export async function fetchConnectState(userId: string): Promise<{
  payout: PayoutState;
  status: ConnectStatus;
  state: ConnectState;
}> {
  const payout = await fetchPayoutState(userId);
  const status = connectStatusOf(payout);
  return { payout, status, state: deriveConnectState(status) };
}
