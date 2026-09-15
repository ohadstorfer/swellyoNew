/**
 * The document review as somebody WITHOUT `medical.view` is allowed to see it.
 *
 * A Manager has no `medical.view` (since 24 Aug, 20260824000000), and RLS
 * refuses them `organized_trip_medical_forms`. `fetchTripReview` therefore
 * reads every traveler's medical form as not filled in — a FALSE ZERO, not a
 * hidden row. On 9 Sep 2026 the web dashboard showed a Manager "Medical form
 * 0/1" on a trip where it was 1/1, and "1/6 approved" on a traveler at 2/6.
 * This app's review screen prints the same number ("0 of 1 filled in"), so the
 * same rule lives here.
 *
 * The medical items are removed outright and every count is recomputed, rather
 * than the one line hidden: anything downstream then cannot show a medical
 * number to a viewer who may not see one. The Dashboard tab's Medical flags
 * block was already hidden on this capability for exactly this reason.
 *
 * Mirrors `withoutMedical` in operator-dashboard/src/domain/visibleReview.ts.
 * This app's TripReview has no `requirements` array, so this one keys on the
 * item's `kind` alone.
 */
import type { TripReview } from './tripDocumentsService';

export function withoutMedicalReview(review: TripReview): TripReview {
  if (!review.travelers.some(t => t.items.some(i => i.kind === 'medical'))) return review;

  const travelers = review.travelers.map(t => {
    const items = t.items.filter(i => i.kind !== 'medical');
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
    travelers,
    totalToReview: travelers.reduce((n, t) => n + t.toReview, 0),
  };
}
