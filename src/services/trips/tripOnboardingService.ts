import { supabase } from '../../config/supabase';
import {
  fetchMyRequirements,
  REQUIREMENT_CATALOG,
  actionForRequirement,
  type RequirementKind,
  type RequirementAction,
  type TripRequirement,
} from './tripDocumentsService';
import type { ParticipantStatus } from './groupTripsService';

/**
 * Traveler onboarding on operator trips.
 *
 * Being approved for an operator trip does not put anyone in it. It grants
 * access to this flow and nothing else: no seat, no place in
 * `participant_count`, none of the member UI. Finishing every must-have
 * requirement is what makes someone a member.
 *
 * Spec: docs/specs/operator-trips/traveler-onboarding.md
 * Screens: docs/traveler-onboarding-flow.html
 *
 * Two things here are load-bearing:
 *
 * 1. THE CLIENT NEVER DECIDES WHO IS IN. `activateTripMembership` asks the
 *    database, which re-derives every must-have requirement from the evidence
 *    tables. This module cannot grant membership by getting its own arithmetic
 *    wrong, and a tampered client cannot grant it at all.
 * 2. STEP ORDER IS NOT COSMETIC. Must-haves come first, and the waiver leads
 *    them (see ONBOARDING_KIND_ORDER). Nobody is charged before they sign.
 */

/**
 * The order the runner plays the steps in, within each half of the flow.
 *
 * AGREE, THEN PAY, THEN TELL US ABOUT YOU. Waiver → deposit → medical.
 * Settled 23 Aug 2026 after two turns:
 *
 *   · It was waiver → medical → deposit (money last, so nobody who balks at
 *     the waiver has been charged).
 *   · The Product Specs doc (§4, "Travelers") lists payment first, and that
 *     was taken; for a few hours this file read deposit → waiver → medical.
 *   · Then: the waiver has to come first, or ride along with the payment the
 *     way a terms-and-conditions tick does.
 *
 * It cannot ride along, and that is not a UI decision. The waiver is a PDF the
 * traveler READS and signs by name (`WaiverStepInline`, written to
 * `group_trip_acknowledgements` against that exact document). A release of the
 * right to sue over injury is not a checkbox next to a Pay button — bundling
 * it there is the fact pattern that gets consent argued away later. Any honest
 * version of "together with the payment" puts the document on screen before
 * the pay button works, which is this order with extra steps.
 *
 * So the waiver leads, and the deposit follows it immediately — as early as
 * money can go while consent still comes first. That also keeps the doc's
 * intent: the cancellation policy IS ticked inside the pay step
 * (`useTripPolicyConsent`, before checkout opens), so "payment + agree to the
 * terms" is exactly what step 2 is.
 *
 * The medical form moves last of the three. It is information, not consent and
 * not money, and it is the only one with no third party in it. ⚠️ It does
 * leave a small window the old order did not have: someone can pay and then
 * stall on the medical form, which means paid and still not a member. The
 * stalled-onboarding nudges already chase exactly that person.
 *
 * The skippable half is ordered by how likely a traveler is to have the thing
 * on them right now — insurance and passport are usually already bought, while
 * flights and visas often are not booked yet at the moment of joining. Front-
 * loading the answerable ones means the flow ends on a run of Skips rather
 * than starting on one.
 *
 * `balance` is deliberately absent: it is the rest of the money, due long
 * after joining, and it lives in the Plan tab. Custom requirements are absent
 * for the same reason — v1 never gates the trip on an item we have no UI for.
 */
const ONBOARDING_KIND_ORDER: RequirementKind[] = [
  'waiver',
  'deposit',
  'medical',
  'insurance',
  'passport',
  'flights',
  'visa',
];

export type OnboardingStep = {
  requirement: TripRequirement;
  /** Which sheet the runner opens. */
  action: RequirementAction;
  kind: RequirementKind;
  /** False = blocks membership. Drives whether a Skip button is drawn. */
  skippable: boolean;
  /** Nothing left to do here — the runner walks past it on resume. */
  done: boolean;
};

export type OnboardingPlan = {
  steps: OnboardingStep[];
  /** Steps still outstanding, in play order. Empty = ready to activate. */
  remaining: OnboardingStep[];
  /** Outstanding must-haves. Non-empty = still not a member. */
  blocking: OnboardingStep[];
  /** For "Step 3 of 7" — counts every step, done or not. */
  total: number;
};

/**
 * A requirement is settled when there is nothing for the traveler left to do.
 *
 * `submitted` counts. An upload waiting on the operator to review it is the
 * traveler's job finished, and making membership wait on a human being awake
 * would strand people for days. (Only reachable when an operator overrides an
 * upload kind to must-have — the default must-have set is waiver, medical and
 * deposit, none of which can ever be 'submitted'.)
 *
 * This mirrors `activate_trip_membership` in the database, which treats
 * anything outside ('not_started', 'rejected') as satisfied. If you change one,
 * change the other — a client that thinks the flow is over while the server
 * disagrees leaves the traveler on a Done screen that will not let them in.
 */
function isSettled(r: TripRequirement): boolean {
  return r.state !== 'not_started' && r.state !== 'rejected';
}

/**
 * Turn this trip's requirements into an ordered flow.
 *
 * Requirements the runner has no UI for are dropped rather than shown as dead
 * steps — but note they are dropped from the FLOW, not from the gate. If an
 * operator somehow makes such a row must-have, the server will keep refusing
 * to activate and the traveler would be stuck on a flow with nothing left to
 * do. `buildOnboardingPlan` therefore keeps any must-have it recognises even
 * when it is out of the canonical order, and only ever drops skippable ones.
 */
export function buildOnboardingPlan(requirements: TripRequirement[]): OnboardingPlan {
  const steps: OnboardingStep[] = [];

  for (const requirement of requirements) {
    const kind = requirement.kind as RequirementKind;
    if (!REQUIREMENT_CATALOG[kind]) continue; // custom item — Plan tab only
    if (kind === 'balance') continue; // due long after joining

    const action = actionForRequirement({
      kind: requirement.kind,
      reqType: requirement.reqType,
    });
    if (!action) continue; // no UI can satisfy it

    const inFlow = ONBOARDING_KIND_ORDER.includes(kind);
    if (!inFlow && requirement.skippable) continue;

    steps.push({
      requirement,
      action,
      kind,
      skippable: requirement.skippable,
      done: isSettled(requirement),
    });
  }

  steps.sort((a, b) => {
    // Must-haves first, always. A traveler should hit the wall while they still
    // have the energy for it, not after four optional uploads.
    if (a.skippable !== b.skippable) return a.skippable ? 1 : -1;
    const ai = ONBOARDING_KIND_ORDER.indexOf(a.kind);
    const bi = ONBOARDING_KIND_ORDER.indexOf(b.kind);
    // An unrecognised must-have sorts to the end of its half rather than to the
    // front, where a -1 index would otherwise put it.
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) -
           (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });

  const remaining = steps.filter(s => !s.done);
  return {
    steps,
    remaining,
    blocking: remaining.filter(s => !s.skippable),
    total: steps.length,
  };
}

/** The plan for this trip, freshly derived from the server. */
export async function fetchOnboardingPlan(tripId: string): Promise<OnboardingPlan> {
  return buildOnboardingPlan(await fetchMyRequirements(tripId));
}

/**
 * My participant status on this trip, or null when I am not on it at all.
 *
 * Reads the row directly rather than through the trip-detail cache, because
 * the two callers that matter — right after a deposit clears, and on opening a
 * trip — both need to know the CURRENT truth, not what was true when the
 * screen mounted.
 */
export async function fetchMyParticipantStatus(
  tripId: string,
  userId: string,
): Promise<ParticipantStatus | null> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('status')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[tripOnboardingService] status read failed:', error);
    return null;
  }
  if (!data) return null;
  // Pre-migration databases have no column; those rows are all real members.
  return ((data as any).status as ParticipantStatus) ?? 'active';
}

/**
 * DEV ONLY — wipe my own onboarding evidence on this trip so the flow replays.
 *
 * Storage files go FIRST, rows second. Same order `operator_reject_document`
 * uses, and for the same reason: a failure half-way leaves orphaned bytes in a
 * bucket, which a later purge sweeps up, rather than a row pointing at a file
 * that no longer exists — which the viewer would render as a permanent error.
 *
 * The RPC refuses unless the caller is the trip's operator of record, and
 * refuses outright if any LIVE payment exists. See migration
 * 20260810000100_dev_reset_my_onboarding.sql.
 *
 * Participant status is deliberately untouched: the person running this is the
 * host, and demoting their own row to 'onboarding' would drop them out of the
 * member list and the participant count.
 */
export async function devResetOnboarding(
  tripId: string,
  userId: string,
): Promise<{ documents: number; acknowledgements: number; medical: number; payments: number }> {
  // 1. The files. Best-effort — an orphaned object is harmless and the purge
  //    job collects it; a failure here must not block clearing the rows.
  const { data: docs } = await supabase
    .from('organized_trip_travelers_documents')
    .select('storage_path')
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  const paths = (docs ?? [])
    .map((d: any) => d.storage_path as string | null)
    .filter((p): p is string => !!p);

  if (paths.length > 0) {
    const { error } = await supabase.storage.from('group-trip-documents').remove(paths);
    if (error) console.warn('[tripOnboardingService] dev reset: storage remove failed:', error);
  }

  // 2. The rows.
  const { data, error } = await supabase.rpc('dev_reset_my_onboarding', {
    p_trip_id: tripId,
  });
  if (error) throw error;
  return (data ?? {}) as any;
}

export type ActivationResult =
  | { status: 'active' }
  | { status: 'onboarding' }
  /** The trip filled up while they were onboarding. Nothing they can do. */
  | { status: 'full' }
  | { status: 'error'; error: unknown };

/**
 * Ask the server to turn an onboarding traveler into a member.
 *
 * Safe to call at any time, including on a trip that is already active or on a
 * peer trip — it is idempotent, one-way, and cheap. That is deliberate: the
 * runner calls it after the deposit clears, and the trip screen calls it on
 * open, so a traveler whose Stripe webhook landed while the app was closed is
 * healed the next time they look at the trip rather than being stranded.
 *
 * Never throws. Every caller is on a UI path where the honest response to "we
 * could not check" is to leave the traveler where they are and let them try
 * again — not to crash a screen.
 */
export async function activateTripMembership(tripId: string): Promise<ActivationResult> {
  const { data, error } = await supabase.rpc('activate_trip_membership', {
    p_trip_id: tripId,
  });

  if (error) {
    // The capacity trigger raises this when the last spot went to someone else
    // mid-onboarding. It is a real, expected outcome — not a bug — and the
    // traveler needs to be told plainly, so it gets its own result rather than
    // being lumped in with "something went wrong".
    const message = `${(error as any)?.message ?? ''}`.toLowerCase();
    if (message.includes('trip is full')) return { status: 'full' };
    console.warn('[tripOnboardingService] activation failed:', error);
    return { status: 'error', error };
  }

  return data === 'active' ? { status: 'active' } : { status: 'onboarding' };
}
