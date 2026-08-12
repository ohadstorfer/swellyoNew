/**
 * Swellyo's Terms of Service — accepting them, and keeping the proof.
 *
 * The tick on `WelcomeScreen` used to write `agreedToTerms` to AsyncStorage
 * and stop there. That is a note to ourselves on one device, not a record: a
 * reinstall erases it, a second device never had it, and it carries no
 * version, so "did this person accept the terms that were live when they
 * signed up?" has never been answerable. Stripe requires us to disclose who
 * the merchant of record is IN OUR TERMS, which makes the answer matter.
 *
 * See docs/specs/operator-trips/refunds-and-merchant-of-record.md §4c.
 *
 * ── The shape of the problem ────────────────────────────────────────────────
 * The tick happens BEFORE sign-in. There is no user to attach it to at the
 * moment it is made, so this cannot be a single call:
 *
 *   1. They tick        → `setTermsAgreed(true)` parks it on the device.
 *   2. They sign in     → `syncPendingTermsAcceptance()` sends it, and the
 *                         server stamps IP + user-agent from the request
 *                         itself. Clears the parked copy on success.
 *
 * Step 2 runs on every boot, not just the one after signup: sign-in on web is
 * a full page redirect, so the screen that took the tick is gone by the time
 * there is a session, and a failed send (offline, migration not applied yet)
 * must retry rather than lose the acceptance.
 *
 * ── What is deliberately NOT done ──────────────────────────────────────────
 * The legacy `agreedToTerms` flag is never converted into a server record.
 * It is DEVICE-wide, and `WelcomeScreen` hides the checkbox entirely once it
 * is set — so on a phone where somebody already signed up, the next person
 * through never sees the box and never ticks it. Turning that flag into a row
 * would file a consent for a user who was never asked, which is worse than
 * having no record at all. Existing users get a record the next time
 * PLATFORM_TERMS_VERSION changes and they are asked again for real.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../config/supabase';

export const TERMS_URL = 'https://www.swellyo.com/terms-and-conditions';
export const PRIVACY_URL = 'https://www.swellyo.com/privacy-policy';

/**
 * Which terms an acceptance was for.
 *
 * The hosted page is NOT versioned — there is one URL and it changes in place
 * — so this string cannot be read from the document. It records which
 * snapshot we believe was live, and it is the only thing that makes
 * "everybody must accept again" possible: bump it whenever the terms text
 * changes and every user is on an older version by definition.
 *
 * Same convention as `OPERATOR_TERMS_VERSION` in services/trips/operatorSetup.
 */
export const PLATFORM_TERMS_VERSION = 'web-2026-08-12';

/** The device-side tick. Still read by WelcomeScreen to decide whether to show
 *  the terms card at all, so it keeps its original key and meaning. */
const LEGACY_AGREED_KEY = 'agreedToTerms';

/** A tick that has not reached the server yet. JSON: `{ version, agreedAt }`. */
const PENDING_KEY = 'terms.pendingAcceptance';

type PendingAcceptance = {
  version: string;
  /** ISO, from the device clock. Null when we genuinely do not know. */
  agreedAt: string | null;
};

/**
 * Record — or revoke — the tick. Called from the checkbox itself, while there
 * is still no user.
 *
 * Both keys move together on purpose: the legacy flag is what the checkbox
 * reads back on the next mount, and the pending record is what eventually
 * becomes the evidence. Writing one without the other gives either a ticked
 * box that is never filed, or a filing with no ticked box.
 *
 * ⚠️ UNTICKING CLEARS BOTH, which the old code did not do — it only ever wrote
 * `true`. That was harmless while the flag was a note to ourselves. It is not
 * harmless now: a tick taken back and then followed by a sign-in would file a
 * consent the person had visibly withdrawn.
 */
export async function setTermsAgreed(agreed: boolean): Promise<void> {
  if (!agreed) {
    await AsyncStorage.multiRemove([LEGACY_AGREED_KEY, PENDING_KEY]);
    return;
  }
  const pending: PendingAcceptance = {
    version: PLATFORM_TERMS_VERSION,
    agreedAt: new Date().toISOString(),
  };
  await AsyncStorage.multiSet([
    [LEGACY_AGREED_KEY, 'true'],
    [PENDING_KEY, JSON.stringify(pending)],
  ]);
}

/**
 * Send a parked tick to the server, if there is one.
 *
 * Safe to call on every boot and cheap when there is nothing to do — one
 * AsyncStorage read and no network. Never throws: a user cannot be blocked
 * from using the app because we could not file paperwork.
 *
 * ⚠️ The caller MUST have a session. The RPC is `security definer` and reads
 * `auth.uid()`; called anonymously it raises 'not signed in', the pending
 * record is kept, and the next boot tries again.
 */
export async function syncPendingTermsAcceptance(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(PENDING_KEY);
  } catch {
    return; // storage unavailable — nothing sensible to do, and not fatal
  }
  if (!raw) return;

  let pending: PendingAcceptance | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'string' && parsed.version) {
      pending = {
        version: parsed.version,
        agreedAt: typeof parsed.agreedAt === 'string' ? parsed.agreedAt : null,
      };
    }
  } catch {
    /* corrupt — handled below */
  }

  // Unparseable is not retryable: it would fail identically forever and log a
  // warning on every boot. Drop it and let the version bump ask again.
  if (!pending) {
    await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
    return;
  }

  const { error } = await supabase.rpc('record_terms_acceptance', {
    p_version: pending.version,
    p_document_url: TERMS_URL,
    p_agreed_at: pending.agreedAt,
  });

  if (error) {
    // Kept, not dropped. The two likely causes — offline, and the migration
    // not applied on this environment yet — both resolve by themselves, and
    // the RPC is idempotent per (user, version) so retrying costs nothing.
    console.warn('[termsService] could not record terms acceptance:', error.message);
    return;
  }

  await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
}

/**
 * Has this user accepted the CURRENT version, server-side?
 *
 * Nothing gates on this yet — the signup checkbox is still the gate, and it is
 * device-side. It exists for the screen that will ask an existing user to
 * re-accept after a version bump, and so that the read is written once rather
 * than three times when that lands.
 */
export async function hasAcceptedCurrentTerms(): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_terms_acceptances')
    .select('id')
    .eq('document', 'platform_terms')
    .eq('version', PLATFORM_TERMS_VERSION)
    .limit(1);

  // "We could not check" is not "they did not accept". Every caller of this
  // would use a false to put a legal wall in front of someone, so a failed
  // read must not be able to do that on its own.
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
