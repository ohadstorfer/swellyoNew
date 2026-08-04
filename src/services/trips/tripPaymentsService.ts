/**
 * Payment amounts for operator trips.
 *
 * The trip price is only a DEFAULT. What a traveler owes lives on their own
 * participant row (`price_total_usd` / `deposit_usd`), frozen when they joined.
 * That is why changing a trip's price never rewrites an existing traveler's
 * deal — the same reason an order line stores its own amount rather than
 * pointing at the product.
 *
 * ⚠️ These functions mirror `operator_traveler_amount_due()` in
 * `20260803000000_operator_trip_payments.sql`. If one changes, the other must.
 * The SQL is authoritative — the client copy exists so the Plan tab can show an
 * amount without a round trip.
 */
import { supabase } from '../../config/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

export type PayStep = 'deposit' | 'balance';

export type TravelerPrices = {
  /** This traveler's total. Callers MUST resolve the trip's default price
   *  before constructing this object — `fetchTravelerPrices` is the function
   *  that does that coalesce (participant row, falling back to the trip's
   *  `cost_per_person`), matching the SQL's `coalesce(p.price_total_usd,
   *  t.cost_per_person)`. Null here means no price exists ANYWHERE — not on
   *  the participant row and not as a trip default — so nothing is owed
   *  until the operator sets one. A caller that skips the coalesce and
   *  builds this straight from a participant row will silently under-charge
   *  travelers who never got their own price frozen. */
  totalUsd: number | null;
  /** Their deposit. Null = this trip takes one single payment. */
  depositUsd: number | null;
};

/** What this step costs, or null when it cannot be determined: either the
 *  price is unknown, or the balance works out negative (deposit > total —
 *  a contradictory configuration; a DB CHECK blocks it in stored rows, but a
 *  live form building this struct from unvalidated, mid-typing input can hit
 *  it). Null, not zero, because zero reads as "fully paid" to every
 *  consumer — mirrors `operator_traveler_amount_due()` in
 *  `20260803000000_operator_trip_payments.sql`, which returns NULL instead
 *  of `greatest(..., 0)` for the same reason (`GREATEST` silently ignores
 *  NULL inputs in Postgres, which used to make an unpriced traveler read as
 *  paid in full). A genuine balance of exactly `0` — deposit equals total —
 *  still returns `0`. */
export function amountDue(step: PayStep, p: TravelerPrices): number | null {
  if (p.totalUsd == null) return null;
  if (step === 'deposit') return p.depositUsd;
  const balance = p.totalUsd - (p.depositUsd ?? 0);
  return balance < 0 ? null : balance;
}

/** What is still owed after everything already paid against this step. */
export function amountOutstanding(
  step: PayStep,
  p: TravelerPrices,
  paidUsd: number,
): number {
  const due = amountDue(step, p);
  if (due == null) return 0;
  return Math.max(0, due - paidUsd);
}

/** Stripe works in integer cents. Round, never truncate: 19.99 * 100 is
 *  1998.9999999999998 in floating point, and truncating undercharges. */
export function usdToStripeCents(usd: number): number {
  return Math.round(usd * 100);
}

/** Swellyo's cut, in cents. Capped at the charge itself — an application fee
 *  larger than the amount makes Stripe reject the whole session. */
export function commissionCents(totalCents: number, bps: number): number {
  return Math.min(totalCents, Math.round((totalCents * bps) / 10000));
}

/**
 * Where Stripe sends the browser after Checkout — a link straight back into
 * THIS app.
 *
 * This used to be `https://swellyo.com/pay/done`, on the belief that Stripe
 * rejects custom URL schemes. It does not: `swellyo://pay/done`,
 * `exp://…/--/pay/done` and `exp+swellyo://…` were all accepted by the
 * Checkout Sessions API (verified against the live API, 2026-08-04). The https
 * URL was the worst of the three — swellyo.com/pay/done does not exist, so
 * every payer landed on a 404 and had to close the browser by hand.
 *
 * `Linking.createURL` and not a hardcoded 'swellyo://': in Expo Go the app's
 * scheme is `exp://<dev-machine-ip>:8081/--/…`, which no constant can know.
 * This resolves to whatever the current environment actually answers on, so
 * the same code returns to a standalone build and to Expo Go.
 *
 * Passing the SAME value to openAuthSessionAsync is what makes iOS dismiss the
 * browser sheet automatically the moment Stripe redirects — the OS matches on
 * the scheme, which an https URL could never satisfy.
 *
 * ⚠️ Coming back still is NOT proof of payment. See startCheckout.
 *
 * A FUNCTION, not a module-level constant: `createURL` reads the scheme out of
 * the expo-constants manifest and THROWS when it cannot find one. At module
 * scope that turns into a crash on import — it took down the whole
 * tripPaymentsService test suite, and anywhere else the manifest is not ready
 * at import time it would take the app down the same way. Called lazily, the
 * cost is one cheap lookup per checkout and the failure (if any) lands inside
 * the tap that caused it.
 */
const returnUrl = () => Linking.createURL('pay/done');

export async function fetchTravelerPrices(
  tripId: string,
  userId: string,
): Promise<TravelerPrices> {
  const [participant, trip] = await Promise.all([
    supabase
      .from('group_trip_participants')
      .select('price_total_usd, deposit_usd')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('group_trips')
      .select('cost_per_person, deposit_amount')
      .eq('id', tripId)
      .single(),
  ]);

  if (participant.error) throw participant.error;
  if (trip.error) throw trip.error;

  // Null on the participant row means they joined before payments were turned
  // on. Fall back to the trip price, exactly as operator_traveler_amount_due()
  // does in SQL.
  return {
    totalUsd: participant.data?.price_total_usd ?? trip.data?.cost_per_person ?? null,
    depositUsd: participant.data?.deposit_usd ?? trip.data?.deposit_amount ?? null,
  };
}

/**
 * Which Stripe mode this build treats as real money.
 *
 * ⚠️ Mirrors the database's `app.stripe_livemode` setting, which
 * `operator_requirement_pay_state()` reads in
 * `20260803000000_operator_trip_payments.sql`. Both default to test mode, and
 * BOTH must be flipped together when the live Stripe key is installed —
 * setting one without the other makes this screen's "paid so far" disagree
 * with what the server will actually accept. The server is the authority
 * either way (nothing here gates a payment); the cost of drift is a
 * misleading number, not a wrong charge.
 */
export const STRIPE_LIVEMODE = process.env.EXPO_PUBLIC_STRIPE_LIVEMODE === 'true';

/** How much has been paid against each pay requirement, keyed by requirement id. */
export async function fetchPaidByRequirement(
  tripId: string,
  userId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('organized_trip_payment_events')
    .select('requirement_id, amount_usd')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    // Mirrors operator_requirement_pay_state's exclusion of 'failed' rows.
    // otpe_amount_sign_matches_type already pins a 'failed' row's amount to
    // 0, so this filter is belt-and-suspenders, not load-bearing — but the
    // file header promises an exact mirror of the SQL, so it stays explicit
    // rather than relying on that CHECK holding.
    .neq('event_type', 'failed')
    // Same mirror, for the mode filter the SQL applies. Without it a Stripe
    // TEST-mode row — and the device test writes those straight into the
    // production database — reads as real money here while the server
    // (correctly) ignores it.
    .eq('is_livemode', STRIPE_LIVEMODE);

  if (error) throw error;

  const out: Record<string, number> = {};
  for (const e of data ?? []) {
    if (!e.requirement_id) continue;
    out[e.requirement_id] = (out[e.requirement_id] ?? 0) + Number(e.amount_usd);
  }
  return out;
}

/** `functions.invoke` throws on any non-2xx response with a fixed generic
 *  message ("Edge Function returned a non-2xx status code") and `data: null`
 *  — the real message the edge function composed ("Already paid", "You are
 *  not on this trip", ...) only lives in the raw Response on `error.context`.
 *  Without reading it here, every deliberate error message these functions
 *  return is thrown away and replaced with `fallback`. */
async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const body = await (error as any)?.context?.json?.().catch(() => null);
  return body?.error ?? fallback;
}

/**
 * Open Stripe Checkout and wait for the browser sheet to close.
 *
 * ⚠️ The return trip is NOT proof of payment, and the resolution of this
 * promise is not either. RETURN_URL now brings the traveler straight back
 * (see it), so `openAuthSessionAsync` DOES resolve 'success' on a real
 * redirect — but that only means Stripe finished with the browser, not that
 * the money moved. The payer can also lose their connection between paying
 * and being redirected, in which case they never come back at all and the
 * payment is still real. The webhook is the only source of truth: the caller
 * MUST refetch and trust the server, never branch on how this call returned.
 */
export async function startCheckout(requirementId: string): Promise<void> {
  // Resolved once and reused: the value handed to Stripe and the value
  // openAuthSessionAsync watches for MUST be the same string, or the browser
  // sheet never closes itself.
  const url = returnUrl();
  const { data, error } = await supabase.functions.invoke('payments-checkout', {
    body: { requirementId, returnUrl: url },
  });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, 'Could not start the payment'));
  }
  if (!data?.url) throw new Error(data?.error ?? 'Could not start the payment');

  await WebBrowser.openAuthSessionAsync(data.url, url);
}

export async function fetchConnectStatus(): Promise<{
  chargesEnabled: boolean;
  accountId: string | null;
}> {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'status' },
  });
  if (error) {
    throw new Error(
      await edgeFunctionErrorMessage(error, 'Could not check your payment account'),
    );
  }
  return {
    chargesEnabled: !!data?.chargesEnabled,
    accountId: data?.accountId ?? null,
  };
}

/**
 * A client secret for the NATIVE embedded onboarding component.
 *
 * The secret is short-lived and scoped to this operator's own Express
 * account. The Stripe SDK calls this again by itself when the secret expires
 * mid-flow, which is why it is fetched on demand and never cached.
 *
 * Same Express account as {@link startConnectOnboarding} — the two differ only
 * in where the form is drawn. An operator who starts one and finishes the
 * other still ends up with exactly one account, because the edge function
 * looks up `operator_payout_accounts` by user_id before creating anything.
 */
export async function fetchConnectAccountSession(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'account_session' },
  });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, 'Could not open Stripe'));
  }
  if (!data?.clientSecret) throw new Error(data?.error ?? 'Could not open Stripe');
  return data.clientSecret as string;
}

export async function startConnectOnboarding(): Promise<void> {
  // Same string to Stripe and to openAuthSessionAsync — see startCheckout.
  const url = returnUrl();
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'onboard', returnUrl: url },
  });
  if (error) {
    throw new Error(await edgeFunctionErrorMessage(error, 'Could not open Stripe'));
  }
  if (!data?.onboardingUrl) throw new Error(data?.error ?? 'Could not open Stripe');
  await WebBrowser.openAuthSessionAsync(data.onboardingUrl, url);
}

/** Operator sets one traveler's own price. Goes through the
 *  `operator_set_traveler_price` RPC, not a direct table update — the only
 *  UPDATE policy on `group_trip_participants` is self-only
 *  (`auth.uid() = user_id`), so a host has no RLS path to write another
 *  traveler's row. The RPC is SECURITY DEFINER and re-checks authority
 *  itself before writing.
 *
 *  ⚠️ That check is `group_trips.host_id = auth.uid()` — the single operator
 *  of record — NOT `is_trip_host()`, which is every promoted "admin" as
 *  well. Only host_id is paid (payments-checkout reads the payout account
 *  for that user alone), so anyone else setting prices is a payment bypass.
 *  The RPC also refuses `p_user_id = auth.uid()`: nobody prices themselves.
 *  The UI must gate the affordance the same way or it offers a button that
 *  always errors. See 20260803000100_operator_set_traveler_price.sql. */
export async function saveTravelerPrice(
  tripId: string,
  userId: string,
  totalUsd: number,
  depositUsd: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('operator_set_traveler_price', {
    p_trip_id: tripId,
    p_user_id: userId,
    p_total_usd: totalUsd,
    p_deposit_usd: depositUsd,
  });
  if (error) throw error;
}
