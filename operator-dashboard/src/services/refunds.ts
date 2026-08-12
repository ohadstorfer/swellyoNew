import { supabase } from '../lib/supabase';
import { toNumber } from '../domain/money';

/**
 * Refunds, read and issued.
 *
 * ⚠️ Rule 1 of docs/SPEC.md still holds: this site adds NOTHING to the
 * database. `organized_trip_refunds` and the `payments-refund` function are
 * created and owned by the app side (migration 20260811000400); this file only
 * reads a table that already exists and calls a function that already runs.
 *
 * Why an edge function and not an insert: a refund is only legitimate if the
 * operator's Stripe balance covered it at the moment it was issued. That check
 * needs the Stripe secret key, so it can only happen server-side — and RLS
 * grants this table SELECT only, precisely so no client can write a row that
 * skipped it.
 */

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'blocked_insufficient_balance';

export type TripRefund = {
  id: string;
  userId: string;
  amountUsd: number;
  reason: string | null;
  status: RefundStatus;
  failureReason: string | null;
  createdAt: string | null;
};

/**
 * Every refund on the trip, newest first.
 *
 * Includes the attempts that never moved money — `blocked_insufficient_balance`
 * and `failed`. That is deliberate: an operator who tried to refund and was
 * stopped needs to see that it did not happen, or they will assume it did.
 *
 * Amounts go through toNumber() because Postgres `numeric` arrives as a string.
 */
export async function fetchRefunds(tripId: string): Promise<TripRefund[]> {
  const { data, error } = await supabase
    .from('organized_trip_refunds')
    .select('id, user_id, amount_usd, reason, status, failure_reason, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(
    (r: any): TripRefund => ({
      id: r.id,
      userId: r.user_id,
      amountUsd: toNumber(r.amount_usd) ?? 0,
      reason: r.reason ?? null,
      status: (r.status ?? 'pending') as RefundStatus,
      failureReason: r.failure_reason ?? null,
      createdAt: r.created_at ?? null,
    }),
  );
}

export type IssueRefundResult =
  | { ok: true; amountUsd: number; remainingUsd: number }
  | { ok: false; error: string };

/**
 * Issue a refund against one recorded payment.
 *
 * Never throws for a refused refund — "your balance is too low" is an ANSWER,
 * not a crash, and the dialog needs to show the two numbers. Only genuinely
 * unexpected failures come back as a generic error string.
 *
 * `amountUsd` omitted means the whole remaining amount. The server decides what
 * is actually refundable by asking Stripe; this is a request, not an authority.
 */
export async function issueRefund(args: {
  paymentEventId: string;
  amountUsd?: number;
  reason?: string;
}): Promise<IssueRefundResult> {
  const { data, error } = await supabase.functions.invoke('payments-refund', {
    body: {
      paymentEventId: args.paymentEventId,
      ...(args.amountUsd !== undefined ? { amountUsd: args.amountUsd } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    },
  });

  // supabase-js treats any non-2xx as an error and hides the JSON body on it.
  // The body is the whole point here — the server writes a message naming both
  // balance figures IN THE OPERATOR'S OWN CURRENCY, which only it can know — so
  // dig it back out rather than showing "Edge Function returned a non-2xx
  // status".
  //
  // The message is passed through verbatim and never rebuilt from numbers here:
  // the operator's settlement currency may not be USD, and a client formatting
  // "$" around a shekel figure would be worse than no detail at all.
  if (error) {
    let payload: any = null;
    try {
      payload = await (error as any).context?.json?.();
    } catch {
      /* the body was not JSON; fall through to the generic message */
    }
    return { ok: false, error: payload?.error ?? 'Could not issue the refund. Please try again.' };
  }

  if (!data?.ok) {
    return { ok: false, error: data?.error ?? 'Could not issue the refund. Please try again.' };
  }
  return { ok: true, amountUsd: Number(data.amountUsd), remainingUsd: Number(data.remainingUsd) };
}
