import { supabase } from '../lib/supabase';
import { toNumber, type PayKind, type PaymentEvent } from '../domain/money';

/**
 * Which Stripe mode's payments count as real.
 *
 * This MUST match the database's `app.stripe_livemode` setting, which reads as
 * FALSE when unset — so today, test payments count as real, and both the app
 * and the database already treat the El Salvador sandbox deposit as settled.
 *
 * If this site disagreed, an operator would read "$0 collected" for a deposit
 * the traveler was told is paid. One debt, two answers.
 *
 * It is the THIRD flag that has to flip with the live Stripe key, alongside
 * the database setting and the app's EXPO_PUBLIC_STRIPE_LIVEMODE. Three flags
 * is three chances to forget one, and forgetting is silent — which is why
 * MoneyPage shows a test-mode strip and warns when it finds events in the mode
 * it is not counting. See otherModeCount().
 */
export const STRIPE_LIVEMODE = import.meta.env.VITE_STRIPE_LIVEMODE === 'true';

/** A payment step on the trip: the deposit, or the final balance. */
export type PayStep = {
  requirementId: string;
  kind: PayKind;
  title: string;
  dueDate: string | null;
};

/**
 * The trip's payment steps.
 *
 * A trip created with a blank deposit publishes a `balance` row ALONE — there
 * is no deposit step to collect against. That is why the price dialog hides
 * the deposit field when this returns no deposit step: writing one would be
 * money that can never be collected.
 */
export async function fetchPaySteps(tripId: string): Promise<PayStep[]> {
  const { data, error } = await supabase
    .from('organized_trip_requirements_resolved')
    .select('id, kind, title, due_date, sort_order')
    .eq('trip_id', tripId)
    .eq('req_type', 'pay')
    .eq('is_active', true);

  if (error) throw error;

  const steps = (data ?? [])
    .filter((r: any) => r.kind === 'deposit' || r.kind === 'balance')
    .map(
      (r: any): PayStep & { sortOrder: number } => ({
        requirementId: r.id,
        kind: r.kind,
        title: r.title ?? (r.kind === 'deposit' ? 'Deposit' : 'Final payment'),
        dueDate: r.due_date ?? null,
        sortOrder: r.sort_order ?? 0,
      }),
    );

  // The deposit always comes first, whatever sort_order says. Money is paid in
  // that order and reading it in any other is confusing.
  return steps
    .sort((a, b) => Number(a.kind !== 'deposit') - Number(b.kind !== 'deposit') || a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...step }) => step);
}

/**
 * Every payment event on the trip.
 *
 * RLS on this table is `(user_id = auth.uid()) OR is_trip_host(trip_id)`, so a
 * host reads the whole trip and nobody else reads any of it.
 *
 * Both Stripe modes come back. Filtering happens in the domain layer so the
 * page can also count what it is hiding and warn about a mode mismatch.
 *
 * Amounts go through toNumber() because Postgres `numeric` reaches the browser
 * as a string — without it, adding two payments concatenates them.
 */
export async function fetchPaymentEvents(tripId: string): Promise<PaymentEvent[]> {
  const { data, error } = await supabase
    .from('organized_trip_payment_events')
    .select('user_id, requirement_id, event_type, amount_usd, is_livemode, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(
    (r: any): PaymentEvent => ({
      userId: r.user_id,
      requirementId: r.requirement_id ?? null,
      eventType: r.event_type ?? 'paid',
      amountUsd: toNumber(r.amount_usd) ?? 0,
      isLivemode: r.is_livemode === true,
      createdAt: r.created_at ?? null,
    }),
  );
}
