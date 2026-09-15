/**
 * The review as somebody WITHOUT `medical.view` is allowed to see it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A Manager has no `medical.view` (lost it on 24 Aug, 20260824000000). RLS
 * refuses them `organized_trip_medical_forms`, so `fetchTripReview` reads every
 * traveler's medical form as not filled in. That is a FALSE ZERO, not a hidden
 * row — and on 9 Sep 2026 the web dashboard showed it in two places:
 *
 *   · "Medical form 0/1" under Documents, on a trip where it was 1/1;
 *   · "1/6 approved" on a traveler who was really at 2/6.
 *
 * The Medical flags card was already hidden on this capability, for exactly
 * this reason (see the comment on it in TripPage). The line and the counts next
 * to it were missed. A Manager reading "0/1" concludes nobody filled the form in.
 *
 * So the medical requirement is removed from the review ENTIRELY for these
 * viewers — requirement, items, and every count derived from them — rather than
 * patched line by line. Anything that reads the review then cannot show a
 * medical number at all, which is the only number a Manager may see there.
 *
 * `hiddenRequirementIds` lets a page that was reached by URL say "that is not
 * yours to see" instead of "that requirement no longer exists", which would be
 * a second false statement in place of the first.
 */
import type { TripReview } from '../services/review';

export function withoutMedical(review: TripReview): TripReview {
  const hidden = review.requirements.filter(r => r.kind === 'medical').map(r => r.id);
  if (hidden.length === 0) return review;

  const hiddenSet = new Set(hidden);
  const travelers = review.travelers.map(t => {
    // By id AND by kind: an item is keyed to its requirement, but a stray item
    // whose requirement row was not in this read must not survive either.
    const items = t.items.filter(i => !hiddenSet.has(i.requirementId) && i.kind !== 'medical');
    return {
      ...t,
      items,
      toReview: items.filter(i => i.state === 'submitted').length,
      done: items.filter(i => i.state === 'approved').length,
      total: items.length,
    };
  });

  return {
    ...review,
    requirements: review.requirements.filter(r => !hiddenSet.has(r.id)),
    travelers,
    totalToReview: travelers.reduce((n, t) => n + t.toReview, 0),
    hiddenRequirementIds: hidden,
  };
}
