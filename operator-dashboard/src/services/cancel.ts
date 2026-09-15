import { supabase } from '../lib/supabase';
import type { RefundOutcome } from './removal';

/**
 * Cancel the whole trip and refund everybody in full.
 *
 * Product Specs §"Manage trip", Always: "cancel trip + refund all." The site's
 * own spec has recorded cancellation as app-only since 13 August; the product
 * spec's "all functions and views should exist in both the mobile and desktop
 * version" overturns that, and SPEC.md §2 is amended alongside this file.
 *
 * ── The same edge function this project already calls ──────────────────────
 * `removal.ts` invokes `trip-cancel` WITH a `userId` to refund one traveler.
 * Called without one it means the whole trip — the mode the app's
 * `cancelTripWithRefunds` uses. So this adds no new server surface and no new
 * permission: `trip.cancel` is checked inside the function, as it always was.
 *
 * ── The refund is not a parameter, and that is the product decision ────────
 * When the OPERATOR cancels, everyone gets 100% back and the trip's own
 * cancellation policy does not apply — that policy is about a traveler who
 * backs out. Anything else is a conversation held BEFORE cancelling, using the
 * per-traveler refund on the traveler's page.
 *
 * ── Safe to call twice ─────────────────────────────────────────────────────
 * The server re-asks Stripe what is left on each charge, so an already-refunded
 * payment is skipped rather than refunded again. That is what makes "Retry the
 * blocked refunds" honest rather than dangerous.
 *
 * A refund that was REFUSED is an answer, not an error: it comes back per
 * traveler, with the reason, and the operator has to read it. Only a failure to
 * cancel at all throws.
 */
export type CancelTripResult = {
  cancelled: boolean;
  /** The trip never collected through Stripe, so there was nothing to refund. */
  offline: boolean;
  refunds: RefundOutcome[];
  /** The trip IS cancelled but the refund sweep could not run at all. */
  error?: string;
};

export async function cancelTripWithRefunds(args: {
  tripId: string;
  reason?: string;
}): Promise<CancelTripResult> {
  const { data, error } = await supabase.functions.invoke('trip-cancel', {
    body: {
      tripId: args.tripId,
      ...(args.reason?.trim() ? { reason: args.reason.trim() } : {}),
    },
  });

  // supabase-js turns any non-2xx into an error and hides the JSON body on it.
  // The body is where the server says WHY — not the operator, already
  // completed — so dig it back out rather than showing "Edge Function returned
  // a non-2xx status" for a permission problem.
  if (error) {
    let payload: any = null;
    try {
      payload = await (error as any).context?.json?.();
    } catch {
      /* not JSON — fall through to the generic message */
    }
    throw new Error(payload?.error ?? 'Could not cancel the trip. Please try again.');
  }

  if (!data?.ok) {
    throw new Error(data?.error ?? 'Could not cancel the trip. Please try again.');
  }

  return {
    cancelled: data.cancelled === true,
    offline: data.offline === true,
    refunds: (data.refunds ?? []) as RefundOutcome[],
    ...(data.error ? { error: data.error as string } : {}),
  };
}
