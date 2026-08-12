/**
 * Refunds — reading them, and issuing one.
 *
 * The operator is the merchant of record, so a refund is HIS decision and comes
 * out of HIS Stripe balance. Spec:
 * docs/specs/operator-trips/refunds-and-merchant-of-record.md
 *
 * ⚠️ There is a byte-identical twin of the read side at
 * `operator-dashboard/src/services/refunds.ts` — the dashboard shares no code
 * with the app. Change one, change both.
 *
 * Why an edge function and not an insert: a refund is only legitimate if the
 * operator's Stripe balance covered it at the moment it was issued, and that
 * check needs the Stripe secret key. RLS grants this table SELECT only, exactly
 * so no client can write a row that skipped the check.
 */
import { supabase } from '../../config/supabase';

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'blocked_insufficient_balance';

export interface TripRefund {
  id: string;
  userId: string;
  amountUsd: number;
  reason: string | null;
  status: RefundStatus;
  failureReason: string | null;
  createdAt: string | null;
}

/** Postgres `numeric` arrives as a string; adding two would concatenate them. */
const toNumber = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Every refund on the trip, newest first.
 *
 * Includes attempts that never moved money (`blocked_insufficient_balance`,
 * `failed`). An operator who was stopped and sees nothing will assume the
 * refund went through.
 *
 * RLS decides the rows: a traveler sees their own, staff need
 * `payments.view_status`.
 */
export async function fetchTripRefunds(tripId: string): Promise<TripRefund[]> {
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
      amountUsd: toNumber(r.amount_usd),
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
 * Never throws for a refused refund. "Your balance is too low" is an ANSWER,
 * not a crash, and the sheet needs both numbers to say something useful. Only
 * genuinely unexpected failures come back as a generic message.
 *
 * `amountUsd` omitted = the whole remaining amount. The server asks Stripe what
 * is actually refundable; this is a request, never an authority.
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

  // supabase-js turns any non-2xx into an error and hides the JSON body on it.
  // The body is the whole point here — the server writes a message naming both
  // balance figures IN THE OPERATOR'S OWN CURRENCY, which only it can know — so
  // dig it back out instead of showing "Edge Function returned a non-2xx
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
      /* not JSON — fall through to the generic message */
    }
    return { ok: false, error: payload?.error ?? 'Could not issue the refund. Please try again.' };
  }

  if (!data?.ok) {
    return { ok: false, error: data?.error ?? 'Could not issue the refund. Please try again.' };
  }
  return { ok: true, amountUsd: Number(data.amountUsd), remainingUsd: Number(data.remainingUsd) };
}
