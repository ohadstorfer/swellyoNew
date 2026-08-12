/**
 * The traveler agreeing to a trip's cancellation policy, before they pay.
 *
 * Phase 4d of docs/specs/operator-trips/refunds-and-merchant-of-record.md.
 *
 * ── Why this exists when the Stripe page already shows the policy ──────────
 * `payments-checkout` puts the policy above Stripe's Pay button
 * (`custom_text[submit][message]`). That DISPLAYS it and records nothing.
 * Stripe's own recorded tick — `consent_collection[terms_of_service]` — can
 * only point at ONE global terms URL set in the Dashboard, so it can never be
 * about the policy frozen on THIS trip.
 *
 * A chargeback is won or lost on "was the buyer shown these terms, and did
 * they accept them". That evidence therefore has to be ours: our tick, our
 * record, taken before the Checkout Session exists.
 *
 * ── What is compared ───────────────────────────────────────────────────────
 * Consent is matched on the exact TEXT that was on screen, not on a policy
 * object or a version number. `consentText()` builds it and the sheet renders
 * from the same function, so what the traveler read, what we store, and what
 * we hash are one string by construction. If the operator's frozen policy ever
 * changes, the text changes, the match fails and they are asked again — which
 * is the correct behaviour and needed no version column to get.
 */
import { supabase } from '../../config/supabase';
import {
  explain,
  policyFromTrip,
  type CancellationPolicy,
} from './cancellationPolicy';

/** The policy as four pieces of copy, so the sheet can lay them out. */
export interface ConsentCopy {
  title: string;
  /** One line per refund step, in reading order. */
  steps: string[];
  /** The operator's own words, when they wrote any. */
  notes: string | null;
  footer: string;
}

/**
 * What the traveler is shown, broken up for layout.
 *
 * The sheet renders THESE fields and `consentText` joins THESE fields. That is
 * the only reason the stored record can be trusted to be what was on screen:
 * a sheet that built its own sentences would drift from the evidence the first
 * time somebody improved one of them.
 *
 * The footer is not decoration. On an operator trip the money sits in the
 * operator's Stripe account and Swellyo has no refund path of its own, so a
 * record of the traveler accepting terms must not read as Swellyo promising to
 * honour them.
 */
export function consentCopy(policy: CancellationPolicy): ConsentCopy {
  const notes = typeof policy.notes === 'string' ? policy.notes.trim() : '';
  return {
    title: 'Cancellation policy for this trip',
    steps: explain(policy),
    notes: notes || null,
    footer: 'Refunds are paid by the trip operator, not Swellyo.',
  };
}

/**
 * The exact words shown above the tick box, as one string — what gets stored
 * and hashed.
 *
 * ⚠️ Changing this invalidates every existing consent: every traveler on a
 * policy-carrying trip is asked again on their next payment. That is the
 * intended behaviour when the TERMS change, and a needless re-prompt when only
 * our own preamble is reworded. Change it deliberately.
 */
export function consentText(policy: CancellationPolicy): string {
  const c = consentCopy(policy);
  return [c.title, ...c.steps, ...(c.notes ? [c.notes] : []), c.footer].join('\n');
}

/**
 * The policy frozen on this trip, or null when it has none.
 *
 * Null is the common case and NOT an error: every type A and B trip has no
 * policy, as does every operator trip published before the columns existed.
 * Nothing is shown and nothing is asked in that case — inventing terms for a
 * trip that never stated any is the mistake this whole feature exists to
 * prevent.
 */
export async function fetchTripPolicy(tripId: string): Promise<CancellationPolicy | null> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('cancellation_preset, cancellation_rules, cancellation_notes')
    .eq('id', tripId)
    .maybeSingle();

  if (error) throw error;
  return policyFromTrip(data ?? null);
}

/**
 * Have I already agreed to exactly these words on this trip?
 *
 * ⚠️ The text is compared HERE, not in the query. Filtering on it server-side
 * (`.eq('shown_text', …)`) would put the whole policy into a URL query string,
 * and this string contains newlines and `%` signs — "100% back" is in every
 * standard policy. That is one escaping surprise away from a filter that
 * silently never matches, which shows as the sheet re-appearing on every
 * payment. Reading one row and comparing two strings in JS cannot fail that
 * way.
 *
 * Only the LATEST consent is considered: it is the one that reflects the terms
 * as they stand. An older row matching a policy that was changed and changed
 * back would be a curiosity, not a licence to skip the question.
 *
 * `user_id` is filtered explicitly even though RLS already scopes a traveler
 * to their own rows — staff on the trip can read everyone's under
 * `payments.view_status`, and an operator paying for their own seat would
 * otherwise match somebody else's consent.
 */
export async function hasConsentedToPolicy(
  tripId: string,
  userId: string,
  shownText: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('organized_trip_policy_consents')
    .select('shown_text')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0] as { shown_text?: string } | undefined)?.shown_text === shownText;
}

/**
 * Record the tick.
 *
 * The RPC re-reads the trip's frozen policy itself and hashes the text
 * server-side — the client supplies only the words it displayed. A hash or an
 * IP accepted from the party you may later be arguing with proves nothing.
 */
export async function recordPolicyConsent(
  tripId: string,
  shownText: string,
): Promise<void> {
  const { error } = await supabase.rpc('record_trip_policy_consent', {
    p_trip_id: tripId,
    p_shown_text: shownText,
  });
  if (error) throw error;
}
