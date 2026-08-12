// Issues one refund against one operator-trip payment.
//
// Phase 2b of docs/specs/operator-trips/refunds-and-merchant-of-record.md.
//
// THE MODEL THIS ENFORCES. Swellyo is the payment rail; the OPERATOR is the
// merchant of record and owns the refund decision. So every refund here:
//   • is authorised by `money.manage` — the operator's own capability,
//   • is pulled OUT OF THE OPERATOR's balance (`reverse_transfer`),
//   • returns Swellyo's commission in proportion (`refund_application_fee`),
//   • and is refused outright unless the operator's balance already covers it.
//
// That last rule is ours, not Stripe's. Stripe would happily let the account go
// negative and chase it later; we would rather the refund simply not happen
// than create a debt we have to collect. See §Phase 2b of the spec.
//
// ⚠️ WHAT THIS FUNCTION DOES NOT DO: it does not write a `refunded` row into
// `organized_trip_payment_events`. `stripe-webhook` does that from
// `charge.refunded`, with cumulative-delta maths that a second writer would
// double-count. This function writes ONLY to `organized_trip_refunds`.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** See payments-checkout for why `.message` alone, never the raw object. */
function safeMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'unknown error';
}

async function stripe(path: string, params: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

/**
 * `stripeAccount` sends the `Stripe-Account` header, i.e. "run this read AS the
 * connected account". Required for the balance check: `/v1/balance` without it
 * returns SWELLYO's balance, which would make the guardrail pass on our money
 * instead of the operator's — the exact opposite of what it exists to do.
 */
async function stripeGet(path: string, stripeAccount?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

// Mirrors payments-checkout. Round, never truncate: 19.99 * 100 is
// 1998.9999999999998 in floating point.
const toCents = (usd: number) => Math.round(usd * 100);

/**
 * How many minor units make one major unit of this currency.
 *
 * Stripe amounts are ALWAYS in the smallest unit, and dividing by 100 is wrong
 * for the zero-decimal currencies (JPY, KRW, VND, CLP…). Asking Intl rather
 * than hardcoding a list means a currency nobody thought about still formats
 * correctly.
 */
function minorPerMajor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100; // unknown code — two decimals is the overwhelming default
  }
}

/** An amount in Stripe's smallest unit, written the way a human reads it. */
function formatMoney(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const major = minor / minorPerMajor(currency);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major);
  } catch {
    return `${major} ${code}`;
  }
}

/**
 * What this refund will actually take OUT OF THE OPERATOR's balance, in the
 * operator's own currency.
 *
 * WHY THIS EXISTS. Since `on_behalf_of` (Phase 1) a charge settles in the
 * OPERATOR's settlement currency, which need not be the currency it was taken
 * in. "Is their USD balance big enough?" is then unanswerable — there may be no
 * USD balance at all — and the only alternatives are refusing every refund for
 * that operator or inventing an exchange rate.
 *
 * Stripe already knows the number. The money reached the operator as a Charge
 * ON THEIR OWN ACCOUNT, and that charge's balance transaction is denominated in
 * their currency:
 *
 *   charge.transfer → Transfer → destination_payment → balance_transaction
 *
 * Refunding R of a charge worth C reverses the fraction R/C of that transfer,
 * so the cost is `landed × R / C`.
 *
 * Returns null when any link in the chain is unreadable. Null means UNKNOWN,
 * and the caller must refuse — an unverifiable refund is exactly the one the
 * guardrail exists to stop.
 */
async function operatorCostOfRefund(args: {
  transferId: string;
  account: string;
  refundCents: number;
  chargeCents: number;
}): Promise<{ amount: number; currency: string } | null> {
  const { transferId, account, refundCents, chargeCents } = args;
  if (chargeCents <= 0) return null;

  try {
    // Platform-side: which charge on the connected account did this create?
    const transfer = await stripeGet(`transfers/${transferId}`);
    const destinationPayment =
      typeof transfer.destination_payment === 'string'
        ? transfer.destination_payment
        : transfer.destination_payment?.id;
    if (!destinationPayment) return null;

    // Connected-account side. The `Stripe-Account` header is what makes the
    // balance transaction come back in THEIR currency instead of ours.
    const destCharge = await stripeGet(
      `charges/${destinationPayment}?expand[]=balance_transaction`,
      account,
    );
    const bt = destCharge.balance_transaction;
    if (!bt || typeof bt !== 'object' || typeof bt.net !== 'number' || !bt.currency) {
      return null;
    }

    // ⚠️ `net`, NOT `amount`. This was wrong until 2026-08-12 and cost 12% on
    // every check. On the connected account a destination payment posts the
    // GROSS in `amount`, with our commission sitting in `fee` / `fee_details`
    // as an `application_fee`; `net` is what the operator's balance actually
    // gained. Verified against acct_1U14lgHdTqJVIPkO:
    //
    //   amount 100000 · fee 12000 (application_fee) · net 88000
    //
    // Since we always send `refund_application_fee=true`, a full refund
    // reverses the transfer (−gross) and hands the commission back (+fee), so
    // the operator ends up exactly `net` poorer. Using `amount` demanded $100
    // of balance to undo a payment that had only ever given them $88 — always
    // refusing on the safe side, but refusing refunds that would have worked.
    //
    // ⚠️ ceil, never floor. Rounding down could pass a refund that leaves the
    // balance a unit short — the single outcome this guardrail exists to
    // prevent. Over-estimating by one minor unit costs nothing.
    const landed = Number(bt.net);
    const cost = Math.ceil((landed * refundCents) / chargeCents);

    return { amount: cost, currency: String(bt.currency).toLowerCase() };
  } catch (e) {
    console.error('[payments-refund] could not price the refund in the operator currency', safeMessage(e));
    return null;
  }
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!STRIPE_SECRET_KEY) {
    console.error('[payments-refund] STRIPE_SECRET_KEY is not set');
    return json({ error: 'Stripe is not configured' }, 500);
  }

  // Set inside the try so the catch can mark it failed. A row that stays
  // 'pending' forever is the one outcome with no audit value.
  let refundRowId: string | null = null;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const actorId = userData.user.id;

    let body: { paymentEventId?: string; amountUsd?: number; reason?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const { paymentEventId, amountUsd, reason } = body;
    if (typeof paymentEventId !== 'string') {
      return json({ error: 'paymentEventId required' }, 400);
    }
    // Shape only. How much may actually be refunded is decided against Stripe
    // below — this field is a request, never an authority.
    if (
      amountUsd !== undefined &&
      (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd <= 0)
    ) {
      return json({ error: 'Invalid amount' }, 400);
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
      return json({ error: 'Invalid reason' }, 400);
    }

    // ── 1. The payment being reversed ────────────────────────────────
    const { data: payment, error: payErr } = await admin
      .from('organized_trip_payment_events')
      .select('id, trip_id, user_id, provider_object_id, amount_usd, event_type, is_livemode')
      .eq('id', paymentEventId)
      .maybeSingle();

    if (payErr) {
      console.error('[payments-refund] payment lookup failed:', safeMessage(payErr));
      return json({ error: 'Could not load the payment' }, 503);
    }
    if (!payment) return json({ error: 'Payment not found' }, 404);
    if (payment.event_type !== 'paid') {
      return json({ error: 'That row is not a payment' }, 400);
    }
    if (!payment.provider_object_id) {
      // Nothing to refund against. Recording this would be misleading.
      return json({ error: 'This payment has no Stripe reference' }, 409);
    }

    // ── 2. May this person move money on this trip? ──────────────────
    // Called on a USER-scoped client, not the service role: `trip_staff_can`
    // reads `auth.uid()`, which is NULL for the service role and would make
    // every check fall through to false. Reusing the existing function rather
    // than reimplementing the tier logic keeps one source of truth — see
    // 20260807000000_operator_trip_staff.sql.
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: canManage, error: capErr } = await asUser.rpc('trip_staff_can', {
      p_trip_id: payment.trip_id,
      p_cap: 'money.manage',
    });
    if (capErr) {
      console.error('[payments-refund] capability check failed:', safeMessage(capErr));
      return json({ error: 'Could not check your permissions' }, 503);
    }
    if (canManage !== true) {
      // Deliberately not "you are not the operator" — staff can hold
      // money.manage too, and a Manager who can see payments but not move them
      // should be told what is missing, not who they are.
      return json({ error: 'You do not have permission to issue refunds on this trip.' }, 403);
    }

    // ── 3. The trip: whose Stripe account, and what terms applied ────
    const { data: trip, error: tripErr } = await admin
      .from('group_trips')
      .select('id, host_id, cancellation_preset, cancellation_rules, cancellation_notes')
      .eq('id', payment.trip_id)
      .maybeSingle();
    if (tripErr || !trip) {
      console.error('[payments-refund] trip lookup failed:', safeMessage(tripErr));
      return json({ error: 'Could not load the trip' }, 503);
    }

    const { data: host } = await admin
      .from('operator_payout_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('user_id', trip.host_id)
      .maybeSingle();

    // ── 4. What is actually refundable, per STRIPE ───────────────────
    // Stripe is the source of truth here, not our own tables. Refunds can also
    // be issued by hand from the Stripe dashboard — that has been the ONLY way
    // to refund up to now — and those never touched `organized_trip_refunds`.
    // Summing our own rows would therefore let an already-refunded charge be
    // refunded a second time.
    const pi = await stripeGet(
      `payment_intents/${payment.provider_object_id}?expand[]=latest_charge`,
    );
    const charge = pi.latest_charge;
    if (!charge || typeof charge !== 'object') {
      return json({ error: 'This payment has no charge to refund yet' }, 409);
    }

    const chargeCurrency = String(charge.currency ?? '').toLowerCase();
    const alreadyRefunded = Number(charge.amount_refunded ?? 0);
    const refundableCents = Number(charge.amount ?? 0) - alreadyRefunded;

    if (refundableCents <= 0) {
      return json({ error: 'This payment has already been fully refunded.' }, 409);
    }

    // Default to the whole remaining amount.
    const requestedCents = amountUsd === undefined ? refundableCents : toCents(amountUsd);
    if (requestedCents <= 0) return json({ error: 'Invalid amount' }, 400);
    if (requestedCents > refundableCents) {
      return json(
        {
          error: `Only $${(refundableCents / 100).toFixed(2)} is left to refund on this payment.`,
        },
        400,
      );
    }

    // Does this charge carry a transfer to the operator? Destination charges do;
    // the TEST-KEY platform path in payments-checkout does not. `reverse_transfer`
    // on a charge with no transfer is a Stripe error, and the balance guardrail
    // is meaningless there — that money is already Swellyo's.
    const hasTransfer = !!charge.transfer || !!pi.transfer_data?.destination;
    const operatorAccount = host?.stripe_account_id ?? null;

    // ── 5. THE GUARDRAIL (Eyal's rule) ───────────────────────────────
    // A refund may only ever come out of money the operator actually has. No
    // negative balances, nothing to chase later.
    if (hasTransfer && operatorAccount) {
      /** Record the attempt, then answer. A blocked refund is a fact worth keeping. */
      const block = async (failureReason: string, error: string, extra: object = {}) => {
        await admin.from('organized_trip_refunds').insert({
          trip_id: payment.trip_id,
          user_id: payment.user_id,
          requested_by: actorId,
          payment_event_id: payment.id,
          provider_object_id: payment.provider_object_id,
          amount_usd: requestedCents / 100,
          reason: reason ?? null,
          status: 'blocked_insufficient_balance',
          failure_reason: failureReason,
          is_livemode: !!payment.is_livemode,
        });
        return json({ error, code: 'insufficient_balance', ...extra }, 409);
      };

      const transferId =
        typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;

      // What this refund actually costs the operator, in THEIR currency — not
      // the charge's. See operatorCostOfRefund for why the charge currency is
      // the wrong unit to reason in.
      const cost = transferId
        ? await operatorCostOfRefund({
            transferId,
            account: operatorAccount,
            refundCents: requestedCents,
            chargeCents: Number(charge.amount ?? 0),
          })
        : null;

      // ⚠️ UNREADABLE CHAIN = UNKNOWN = REFUSE. Not "probably fine". An
      // unverifiable refund is precisely the one this guardrail exists to stop,
      // and guessing here would quietly reintroduce the negative balances
      // Eyal's rule was written to avoid.
      if (!cost) {
        console.warn('[payments-refund] could not determine operator cost', {
          transferId,
          chargeCurrency,
        });
        return await block(
          'could not read transfer → destination_payment → balance_transaction',
          'We could not check your Stripe balance, so nothing was refunded. Contact support and we will sort it out.',
        );
      }

      const balance = await stripeGet('balance', operatorAccount);
      const available: Array<{ amount: number; currency: string }> = balance.available ?? [];
      const entry = available.find(b => String(b.currency).toLowerCase() === cost.currency);
      const availableAmount = entry?.amount ?? 0;

      if (availableAmount < cost.amount) {
        // Says both numbers out loud, in the operator's own currency. "Refund
        // failed" sends them to support; "needs ₪2,200, you have ₪900" tells
        // them to wait for a payout cycle.
        //
        // ⚠️ This reads `available`, never `pending`. Money that has not
        // settled cannot fund a refund, so a refund on a very recent payment
        // can legitimately be refused. That is the rule working.
        return await block(
          `available ${availableAmount} < required ${cost.amount} (${cost.currency})`,
          `Not enough balance. This refund needs ${formatMoney(cost.amount, cost.currency)} ` +
            `and your Stripe balance is ${formatMoney(availableAmount, cost.currency)}.`,
          {
            currency: cost.currency,
            availableMinor: availableAmount,
            requiredMinor: cost.amount,
          },
        );
      }
    }

    // ── 6. Record the intent BEFORE calling Stripe ───────────────────
    // Two reasons this order matters: the row id becomes the idempotency key
    // (so a double tap cannot mint two refunds), and a crash between here and
    // the Stripe response leaves a 'pending' row to reconcile rather than a
    // silent hole.
    const { data: refundRow, error: insErr } = await admin
      .from('organized_trip_refunds')
      .insert({
        trip_id: payment.trip_id,
        user_id: payment.user_id,
        requested_by: actorId,
        payment_event_id: payment.id,
        provider_object_id: payment.provider_object_id,
        amount_usd: requestedCents / 100,
        reason: reason ?? null,
        policy_snapshot: {
          preset: trip.cancellation_preset,
          rules: trip.cancellation_rules,
          notes: trip.cancellation_notes,
        },
        status: 'pending',
        is_livemode: !!payment.is_livemode,
      })
      .select('id')
      .single();

    if (insErr || !refundRow) {
      console.error('[payments-refund] could not record the refund:', safeMessage(insErr));
      // Refuse rather than refund unrecorded. An unrecorded refund is money
      // that moved with no audit trail — worse than a refund that did not
      // happen, because nobody knows to retry it.
      return json({ error: 'Could not start the refund' }, 503);
    }
    refundRowId = refundRow.id;

    // ── 7. Refund ────────────────────────────────────────────────────
    const params: Record<string, string> = {
      payment_intent: payment.provider_object_id,
      amount: String(requestedCents),
    };
    if (hasTransfer) {
      // Pull the money back out of the operator, not out of Swellyo.
      params.reverse_transfer = 'true';
      // Give back our commission in proportion. DECIDED 2026-08-11 against the
      // comparables: our 12% is an operator-paid COMMISSION (Booking.com,
      // Viator, GetYourGuide, WeTravel), not a traveler-paid service fee
      // (Airbnb, Eventbrite). Commission follows the money the operator keeps —
      // full refund, we take nothing; keep 50%, we take 12% of that 50%.
      // Stripe applies it proportionally, so this one flag IS the rule.
      params.refund_application_fee = 'true';
    }

    const refund = await stripe('refunds', params, `refund:${refundRow.id}`);

    await admin
      .from('organized_trip_refunds')
      .update({ status: 'succeeded', stripe_refund_id: refund.id })
      .eq('id', refundRow.id);

    return json({
      ok: true,
      refundId: refundRow.id,
      amountUsd: requestedCents / 100,
      remainingUsd: (refundableCents - requestedCents) / 100,
    });
  } catch (e) {
    const msg = safeMessage(e);
    console.error('[payments-refund]', msg);

    if (refundRowId) {
      // Best effort. If this update itself fails the row stays 'pending', which
      // is still the correct signal: "we do not know what happened, check
      // Stripe" — never a false 'succeeded'.
      await admin
        .from('organized_trip_refunds')
        .update({ status: 'failed', failure_reason: msg })
        .eq('id', refundRowId);
    }
    return json({ error: 'Could not issue the refund' }, 500);
  }
});
