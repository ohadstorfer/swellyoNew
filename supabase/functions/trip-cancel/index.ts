// Cancels an operator trip and refunds every traveler in full.
//
// THE RULE THIS ENCODES. When the OPERATOR cancels, everybody gets 100% back,
// and the trip's cancellation policy does not apply. That policy governs a
// TRAVELER who backs out; it has never had anything to say about an operator
// who calls the trip off. Airbnb, Eventbrite and GetYourGuide all draw the line
// in exactly this place (GetYourGuide additionally fines the supplier). So this
// function takes no amounts from the client and offers no partial mode — the
// refund is not a decision the caller gets to make. An operator who needs
// anything else contacts support BEFORE cancelling, and support uses
// `payments-refund` one traveler at a time.
//
// ⚠️ THE REFUND CORE BELOW IS A SECOND COPY of the one in
// `payments-refund/index.ts` — same Stripe calls, same guardrail, same reasons.
// The two functions are deployed separately and this repo has no `_shared`
// module convention, so they are kept in sync BY HAND. Change one, change both.
// The known divergence risk is real: `operatorCostOfRefund` read `amount` where
// it had to read `net` for months, and cost 12% of headroom on every check.
//
// ORDER OF OPERATIONS, and why it is not negotiable:
//
//   1. status = 'cancelled'   ← closes the door on new payments FIRST
//   2. expire open Checkout Sessions
//   3. refund everyone
//
// Refunding first would leave a window in which a traveler pays into a trip
// that is already being wound up, and that payment would not be in the batch.
// The cost of this order is that the "Trip cancelled" push (fired by
// `tg_notify_trip_cancelled`, on the status write) reaches travelers a few
// seconds before their refund is issued. That is the right way round: the news
// is the cancellation, and the money follows.
//
// ⚠️ WHAT THIS FUNCTION DOES NOT DO: it does not write `refunded` rows into
// `organized_trip_payment_events`. `stripe-webhook` does that from
// `charge.refunded`, with cumulative-delta maths that a second writer would
// double-count. This function writes ONLY to `organized_trip_refunds` and to
// the trip's own status/audit columns.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

/**
 * Which Stripe mode this deployment can actually touch.
 *
 * Derived from the key rather than read from a setting, because it is not a
 * preference: a test key cannot refund a live charge, and vice versa. Every
 * ledger row carries `is_livemode`, and refunding across the boundary is not
 * "wrong totals" — it is a Stripe error on every call.
 */
const IS_LIVEMODE = STRIPE_SECRET_KEY.startsWith('sk_live');

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

/** Mirrors payments-checkout. Round, never truncate: 19.99 * 100 is
 *  1998.9999999999998 in floating point. */
const toCents = (usd: number) => Math.round(usd * 100);

/** How many minor units make one major unit. Asking Intl beats a hardcoded
 *  zero-decimal list (JPY, KRW, VND, CLP…) that nobody remembers to extend. */
function minorPerMajor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
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
 * operator's own currency. Copy of `payments-refund`'s — see the header.
 *
 * Since `on_behalf_of` a charge settles in the OPERATOR's settlement currency,
 * which need not be the currency it was taken in, so "is their USD balance big
 * enough?" can be unanswerable. Stripe already knows the number:
 *
 *   charge.transfer → Transfer → destination_payment → balance_transaction
 *
 * Refunding R of a charge worth C reverses the fraction R/C of that transfer.
 *
 * Returns null when any link is unreadable. Null means UNKNOWN, and the caller
 * must refuse — an unverifiable refund is the one the guardrail exists to stop.
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
    const transfer = await stripeGet(`transfers/${transferId}`);
    const destinationPayment =
      typeof transfer.destination_payment === 'string'
        ? transfer.destination_payment
        : transfer.destination_payment?.id;
    if (!destinationPayment) return null;

    const destCharge = await stripeGet(
      `charges/${destinationPayment}?expand[]=balance_transaction`,
      account,
    );
    const bt = destCharge.balance_transaction;
    if (!bt || typeof bt !== 'object' || typeof bt.net !== 'number' || !bt.currency) {
      return null;
    }

    // ⚠️ `net`, NOT `amount`. On the connected account a destination payment
    // posts the GROSS in `amount`, with our commission in `fee` as an
    // `application_fee`; `net` is what their balance actually gained. Since we
    // always send `refund_application_fee=true`, a full refund reverses the
    // transfer (−gross) and hands the commission back (+fee), so the operator
    // ends up exactly `net` poorer. Using `amount` demands $100 of balance to
    // undo a payment that only ever gave them $88 — refusing on the safe side,
    // but refusing refunds that would have worked.
    //
    // ⚠️ ceil, never floor. Rounding down could pass a refund that leaves the
    // balance a unit short — the single outcome this guardrail prevents.
    const landed = Number(bt.net);
    const cost = Math.ceil((landed * refundCents) / chargeCents);

    return { amount: cost, currency: String(bt.currency).toLowerCase() };
  } catch (e) {
    console.error('[trip-cancel] could not price the refund in the operator currency', safeMessage(e));
    return null;
  }
}

const emptySummary = () => ({
  total: 0,
  succeeded: 0,
  alreadyRefunded: 0,
  blocked: 0,
  failed: 0,
  refundedUsd: 0,
});

/** What the client renders as one row of the refund-status list. */
type RefundOutcome = {
  userId: string;
  paymentEventId: string;
  amountUsd: number;
  status: 'succeeded' | 'failed' | 'blocked_insufficient_balance' | 'already_refunded';
  message?: string;
};

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!STRIPE_SECRET_KEY) {
    console.error('[trip-cancel] STRIPE_SECRET_KEY is not set');
    return json({ error: 'Stripe is not configured' }, 500);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const actorId = userData.user.id;

    let body: { tripId?: string; reason?: string; userId?: string; amountUsd?: number };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const { tripId, reason, userId, amountUsd } = body;
    if (typeof tripId !== 'string') return json({ error: 'tripId required' }, 400);
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
      return json({ error: 'Invalid reason' }, 400);
    }

    // ── TWO MODES, one refund engine ─────────────────────────────────
    //
    // Passing `userId` switches this from "cancel the trip and refund
    // everybody" to "refund this one traveler, and leave the trip alone". The
    // removal itself stays on the client — `removeParticipant()` already
    // handles the banner, the chat, the join request and the push, and
    // re-implementing that here would be a rewrite for no gain.
    //
    // Sharing the function rather than writing a second one is deliberate. The
    // balance guardrail below is subtle, and this codebase has already been
    // bitten by a copy of it drifting: `operatorCostOfRefund` read `amount`
    // where it had to read `net` for a week, quietly refusing refunds that had
    // the balance to succeed. A third copy would be a third chance at that.
    const singleTraveler = userId !== undefined;
    if (singleTraveler) {
      if (typeof userId !== 'string') return json({ error: 'Invalid userId' }, 400);
      // Shape only. What may actually be refunded is decided against Stripe.
      if (
        amountUsd !== undefined &&
        (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd < 0)
      ) {
        return json({ error: 'Invalid amount' }, 400);
      }
      // Zero is a legitimate request — "remove them, refund nothing" — but it
      // has no work to do, and minting refund rows for it would fill the audit
      // trail with events that never moved money.
      if (amountUsd === 0) {
        return json({ ok: true, cancelled: false, refunds: [], summary: emptySummary() });
      }
    } else if (amountUsd !== undefined) {
      // A partial amount makes no sense for a whole-trip cancel: the rule is
      // 100% to everyone, and accepting a number here would imply otherwise.
      return json({ error: 'amountUsd is only valid with userId' }, 400);
    }

    // ── 1. May this person do this? ──────────────────────────────────
    // On a USER-scoped client: `trip_staff_can` reads `auth.uid()`, which is
    // NULL for the service role and would make every check fall through to
    // false. The DB trigger `trg_guard_trip_money_and_cancel` enforces the
    // cancel rule on the status write, but only for writes that carry a uid —
    // the service-role write below deliberately bypasses it, so THIS is the
    // real gate.
    //
    // The two modes need DIFFERENT capabilities, and that is the point rather
    // than an inconsistency. Cancelling a trip is `trip.cancel`; refunding one
    // traveler is `money.manage`, the same capability `payments-refund` asks
    // for. A Manager may hold `travelers.remove` without `money.manage`, so
    // this is what stops them removing a paid traveler and stranding the money
    // — the client disables the button, and this makes it true.
    const requiredCap = singleTraveler ? 'money.manage' : 'trip.cancel';
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: allowed, error: capErr } = await asUser.rpc('trip_staff_can', {
      p_trip_id: tripId,
      p_cap: requiredCap,
    });
    if (capErr) {
      console.error('[trip-cancel] capability check failed:', safeMessage(capErr));
      return json({ error: 'Could not check your permissions' }, 503);
    }
    if (allowed !== true) {
      return json(
        {
          error: singleTraveler
            ? 'Only the operator of this trip can refund a traveler.'
            : 'Only the operator of this trip can cancel it.',
        },
        403,
      );
    }

    // ── 2. The trip ──────────────────────────────────────────────────
    const { data: trip, error: tripErr } = await admin
      .from('group_trips')
      .select('id, host_id, status, payment_mode, cancellation_preset, cancellation_rules, cancellation_notes')
      .eq('id', tripId)
      .maybeSingle();
    if (tripErr) {
      console.error('[trip-cancel] trip lookup failed:', safeMessage(tripErr));
      return json({ error: 'Could not load the trip' }, 503);
    }
    if (!trip) return json({ error: 'Trip not found' }, 404);

    // A finished trip is not cancellable. Its travelers went; refunding them
    // all would be a different decision entirely, and one nobody has asked for.
    //
    // A SINGLE refund on a completed trip is allowed, though: "this person
    // never actually came, give them their money back" is an ordinary thing to
    // need after the fact, and refusing it would send the operator to Stripe's
    // dashboard where nothing we record would see it.
    if (trip.status === 'completed' && !singleTraveler) {
      return json({ error: 'This trip is already marked completed.' }, 409);
    }

    // ── 3. Cancel FIRST, so nothing else can be paid into it ─────────
    // Idempotent by design. An already-cancelled trip falls straight through
    // to the refund sweep, which is what the client's "Retry" button needs:
    // the trip stays cancelled and only the unfinished refunds are re-attempted.
    //
    // Skipped entirely for a single traveler — removing one person does not
    // touch the trip, which carries on with everybody else.
    const alreadyCancelled = trip.status === 'cancelled';
    if (!singleTraveler && !alreadyCancelled) {
      const { error: cancelErr } = await admin
        .from('group_trips')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: actorId,
          cancelled_reason: reason?.trim() || null,
        })
        .eq('id', tripId)
        // Guards against two operators (or a double tap) cancelling at once.
        // The loser writes nothing and simply proceeds to the refund sweep,
        // which is idempotent — so a double tap cannot double-refund.
        .eq('status', 'active');

      if (cancelErr) {
        console.error('[trip-cancel] could not cancel the trip:', safeMessage(cancelErr));
        // Nothing has moved. Refusing here is safe and honest.
        return json({ error: 'Could not cancel the trip' }, 503);
      }
    }

    // ── 4. Kill the payment pages travelers already have open ────────
    // Best effort, and deliberately not fatal: the durable half of this fix is
    // the `status !== 'active'` check in `payments-checkout`, which refuses a
    // session this sweep missed. Stripe pages this list at 100 PLATFORM-WIDE,
    // so on a busy platform it can genuinely miss some — that is why the sweep
    // alone was never sufficient.
    // Both modes sweep, but for different reasons: cancelling kills every open
    // session on the trip, while removing one traveler kills only theirs — the
    // rest of the group is still paying and must not be interrupted.
    try {
      const openSessions = await stripeGet('checkout/sessions?status=open&limit=100');
      const sessions: Array<{ id: string; metadata?: Record<string, string> }> =
        openSessions.data ?? [];
      const mine = sessions.filter(
        s =>
          s.metadata?.trip_id === tripId &&
          (!singleTraveler || s.metadata?.user_id === userId),
      );
      for (const sess of mine) {
        try {
          await stripe(`checkout/sessions/${sess.id}/expire`, {});
        } catch (e) {
          console.warn('[trip-cancel] could not expire session', sess.id, safeMessage(e));
        }
      }
    } catch (e) {
      console.warn('[trip-cancel] could not list open sessions', safeMessage(e));
    }

    // A trip that never collected through Stripe has nothing to refund. Said
    // explicitly rather than falling through an empty loop, because "cancelled,
    // 0 refunds" and "cancelled, refunds not applicable" read the same to the
    // client otherwise.
    if (trip.payment_mode !== 'managed') {
      return json({
        ok: true,
        cancelled: !singleTraveler,
        offline: true,
        refunds: [],
        summary: emptySummary(),
      });
    }

    // ── 5. Every payment that is still standing ──────────────────────
    // `paid` rows only, in OUR Stripe mode. What is actually refundable on each
    // is then asked of Stripe, not of this table: refunds issued by hand from
    // the Stripe dashboard never touched our rows, and summing our own ledger
    // would let an already-refunded charge be refunded a second time.
    //
    // NEWEST FIRST. It decides the allocation order when a partial amount is
    // capped, and the order refunds are attempted when the balance runs short.
    // Newest is the right end to start from on both counts: the most recent
    // money is the most likely to still be sitting in the operator's
    // `available` balance rather than already paid out.
    let paymentsQuery = admin
      .from('organized_trip_payment_events')
      .select('id, user_id, provider_object_id, amount_usd, is_livemode')
      .eq('trip_id', tripId)
      .eq('event_type', 'paid')
      .eq('is_livemode', IS_LIVEMODE);

    if (singleTraveler) paymentsQuery = paymentsQuery.eq('user_id', userId);

    const { data: payments, error: payErr } = await paymentsQuery.order('created_at', {
      ascending: false,
    });

    if (payErr) {
      console.error('[trip-cancel] payment lookup failed:', safeMessage(payErr));
      // The trip IS cancelled — say so, and let the client offer a retry for
      // the money. Reporting a flat failure here would suggest nothing happened.
      return json(
        {
          ok: true,
          cancelled: !singleTraveler,
          refunds: [],
          summary: emptySummary(),
          error: 'Could not load the payments to refund',
        },
        200,
      );
    }

    const { data: host } = await admin
      .from('operator_payout_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('user_id', trip.host_id)
      .maybeSingle();
    const operatorAccount = host?.stripe_account_id ?? null;

    const policySnapshot = {
      preset: trip.cancellation_preset,
      rules: trip.cancellation_rules,
      notes: trip.cancellation_notes,
    };

    // ── 6. THE BATCH ─────────────────────────────────────────────────
    // SEQUENTIAL, not parallel, and it carries its own running balance.
    //
    // The guardrail in `payments-refund` reads the operator's balance fresh for
    // every single refund, which is correct when there is one. Fired eight
    // times at once it is actively wrong: each call reads the same starting
    // balance, each concludes there is room, and together they can overdraw the
    // account — the exact outcome the rule exists to prevent. Stripe's balance
    // does not update fast enough to save us either.
    //
    // So the balance is read ONCE, and every refund the batch commits is
    // subtracted from a local ledger before the next one is judged.
    const balanceByCurrency = new Map<string, number>();
    if (operatorAccount) {
      try {
        const balance = await stripeGet('balance', operatorAccount);
        for (const entry of (balance.available ?? []) as Array<{ amount: number; currency: string }>) {
          balanceByCurrency.set(String(entry.currency).toLowerCase(), Number(entry.amount) || 0);
        }
      } catch (e) {
        // Unreadable balance = UNKNOWN = refuse every refund, the same way one
        // unreadable transfer chain refuses one refund. The trip stays
        // cancelled and the client offers Retry.
        console.error('[trip-cancel] could not read the operator balance', safeMessage(e));
        return json({
          ok: true,
          cancelled: !singleTraveler,
          refunds: [],
          summary: emptySummary(),
          error: singleTraveler
            ? 'We could not check your Stripe balance, so nothing was refunded. Try again in a moment.'
            : 'The trip is cancelled, but we could not check your Stripe balance, so nothing was refunded yet. Try again in a moment.',
        });
      }
    }

    // The audit trail has to say which of the two things actually happened.
    // Both modes wrote "Trip cancelled by the operator" until 2026-08-19, so a
    // traveler removed from a perfectly healthy trip left a refund row claiming
    // the trip had been cancelled — read months later, by someone reconciling
    // money, that is simply false.
    const refundReason = singleTraveler
      ? 'Removed from the trip by the operator'
      : 'Trip cancelled by the operator';

    const outcomes: RefundOutcome[] = [];

    // How much of the requested amount is still unallocated, in cents.
    // `Infinity` for a whole-trip cancel and for a single traveler with no
    // amount given — both mean "everything that is left", and neither should be
    // capped by an arithmetic accident.
    let remainingCents =
      singleTraveler && amountUsd !== undefined ? toCents(amountUsd) : Number.POSITIVE_INFINITY;

    for (const payment of payments ?? []) {
      // The requested amount is spent. Anything further would refund money the
      // operator did not agree to send back.
      if (remainingCents <= 0) break;
      const record = async (
        status: RefundOutcome['status'],
        amountUsd: number,
        opts: { message?: string; failureReason?: string; write?: boolean } = {},
      ) => {
        if (opts.write !== false && status !== 'already_refunded') {
          await admin.from('organized_trip_refunds').insert({
            trip_id: tripId,
            user_id: payment.user_id,
            requested_by: actorId,
            payment_event_id: payment.id,
            provider_object_id: payment.provider_object_id,
            amount_usd: amountUsd,
            reason: refundReason,
            policy_snapshot: policySnapshot,
            status,
            failure_reason: opts.failureReason ?? null,
            is_livemode: !!payment.is_livemode,
          });
        }
        outcomes.push({
          userId: payment.user_id,
          paymentEventId: payment.id,
          amountUsd,
          status,
          ...(opts.message ? { message: opts.message } : {}),
        });
      };

      try {
        if (!payment.provider_object_id) {
          // Nothing to refund against. Recording a row would be misleading.
          await record('failed', 0, {
            message: 'This payment has no Stripe reference.',
            failureReason: 'no provider_object_id',
          });
          continue;
        }

        const pi = await stripeGet(
          `payment_intents/${payment.provider_object_id}?expand[]=latest_charge`,
        );
        const charge = pi.latest_charge;
        if (!charge || typeof charge !== 'object') {
          await record('failed', 0, {
            message: 'This payment never produced a charge.',
            failureReason: 'no latest_charge',
          });
          continue;
        }

        const chargeCents = Number(charge.amount ?? 0);
        const refundableCents = chargeCents - Number(charge.amount_refunded ?? 0);

        if (refundableCents <= 0) {
          // Already fully refunded — by an earlier run of this batch, by a
          // single refund from the dashboard, or by hand in Stripe. This is the
          // branch that makes Retry safe: Stripe, not our rows, decides what is
          // left, so re-running can never double-refund.
          //
          // Close out any row this batch left 'pending' on a previous attempt
          // (Stripe succeeded, our status update did not). Without this the row
          // would say 'pending' forever on a refund that plainly happened.
          await admin
            .from('organized_trip_refunds')
            .update({ status: 'succeeded' })
            .eq('payment_event_id', payment.id)
            .eq('status', 'pending');

          await record('already_refunded', 0, { message: 'Already refunded.' });
          continue;
        }

        // ── Allocation ───────────────────────────────────────────────
        // A whole-trip cancel refunds every payment in full, so the cap is
        // Infinity and this is a no-op. A capped single-traveler refund walks
        // their payments newest-first, taking each in full until what is left
        // to give back is smaller than the next payment — that one is refunded
        // partially, and the walk stops.
        //
        // Deliberately allocated across payments rather than asked of the
        // client: an operator thinks "give her back $450", not "refund row 6 in
        // full and 40% of row 5". On prod one traveler already has six paid
        // rows totalling $3,600.
        const refundCents = Math.min(refundableCents, remainingCents);
        if (refundCents <= 0) break;

        const refundUsd = refundCents / 100;

        const hasTransfer = !!charge.transfer || !!pi.transfer_data?.destination;

        // ── The guardrail, against the batch's running balance ────────
        if (hasTransfer && operatorAccount) {
          const transferId =
            typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;

          const cost = transferId
            ? await operatorCostOfRefund({
                transferId,
                account: operatorAccount,
                refundCents,
                chargeCents,
              })
            : null;

          if (!cost) {
            await record('blocked_insufficient_balance', refundUsd, {
              message: 'We could not check what this refund costs you, so it was not sent.',
              failureReason: 'could not read transfer → destination_payment → balance_transaction',
            });
            continue;
          }

          const remaining = balanceByCurrency.get(cost.currency) ?? 0;
          if (remaining < cost.amount) {
            await record('blocked_insufficient_balance', refundUsd, {
              message:
                `Needs ${formatMoney(cost.amount, cost.currency)}, ` +
                `${formatMoney(remaining, cost.currency)} left in your Stripe balance.`,
              failureReason: `available ${remaining} < required ${cost.amount} (${cost.currency})`,
            });

            // ⚠️ STOP, do not try the next payment — in single-traveler mode.
            //
            // The allocation walks this person's payments to fill ONE amount.
            // Neither the amount owed nor the balance changes when a block
            // happens, so every remaining payment blocks identically: one $70
            // request against five payments wrote FIVE blocked rows of $70, and
            // the audit trail then reads as $350 refused. Observed on prod
            // 2026-08-19.
            //
            // A whole-trip cancel genuinely should carry on: the balance is
            // only debited on success, so a cheaper traveler further down the
            // list can still be paid.
            if (singleTraveler) break;
            continue;
          }

          // Commit it against the running total BEFORE the call, so a refund
          // that succeeds cannot be counted twice, and one that fails below
          // simply leaves the batch a little more conservative than it needed
          // to be. Erring toward "not enough" is the safe direction here.
          balanceByCurrency.set(cost.currency, remaining - cost.amount);
        }

        // ── Record the intent BEFORE calling Stripe ──────────────────
        // The row id is the idempotency key, so a retry inside Stripe's 24h
        // window cannot mint two refunds for one row; and a crash between here
        // and the response leaves a 'pending' row to reconcile (see the
        // already-refunded branch above) rather than a silent hole.
        const { data: refundRow, error: insErr } = await admin
          .from('organized_trip_refunds')
          .insert({
            trip_id: tripId,
            user_id: payment.user_id,
            requested_by: actorId,
            payment_event_id: payment.id,
            provider_object_id: payment.provider_object_id,
            amount_usd: refundUsd,
            reason: refundReason,
            policy_snapshot: policySnapshot,
            status: 'pending',
            is_livemode: !!payment.is_livemode,
          })
          .select('id')
          .single();

        if (insErr || !refundRow) {
          // Refuse rather than refund unrecorded: money that moved with no
          // audit trail is worse than money that did not move, because nobody
          // knows to retry it.
          console.error('[trip-cancel] could not record the refund:', safeMessage(insErr));
          outcomes.push({
            userId: payment.user_id,
            paymentEventId: payment.id,
            amountUsd: refundUsd,
            status: 'failed',
            message: 'Could not start this refund.',
          });
          continue;
        }

        const params: Record<string, string> = {
          payment_intent: payment.provider_object_id,
          amount: String(refundCents),
        };
        if (hasTransfer) {
          // Pull the money back out of the operator, not out of Swellyo, and
          // give our commission back in proportion. On a full refund that means
          // we keep nothing — which is the only defensible outcome for a trip
          // that will not happen.
          params.reverse_transfer = 'true';
          params.refund_application_fee = 'true';
        }

        try {
          const refund = await stripe('refunds', params, `refund:${refundRow.id}`);
          await admin
            .from('organized_trip_refunds')
            .update({ status: 'succeeded', stripe_refund_id: refund.id })
            .eq('id', refundRow.id);

          // Only money that actually went back counts against the request. A
          // blocked or failed refund leaves the remainder intact, so a retry
          // still has the full amount to give — the operator asked for $450 and
          // must not end up having sent $200 because one charge misfired.
          remainingCents -= refundCents;

          outcomes.push({
            userId: payment.user_id,
            paymentEventId: payment.id,
            amountUsd: refundUsd,
            status: 'succeeded',
          });
        } catch (e) {
          const msg = safeMessage(e);
          await admin
            .from('organized_trip_refunds')
            .update({ status: 'failed', failure_reason: msg })
            .eq('id', refundRow.id);

          outcomes.push({
            userId: payment.user_id,
            paymentEventId: payment.id,
            amountUsd: refundUsd,
            status: 'failed',
            message: msg,
          });
        }
      } catch (e) {
        // One traveler's refund failing must never abandon the rest of the
        // batch — that would leave the trip cancelled and an arbitrary subset
        // of people unrefunded, with nothing on screen to say which.
        const msg = safeMessage(e);
        console.error('[trip-cancel] refund failed for payment', payment.id, msg);
        outcomes.push({
          userId: payment.user_id,
          paymentEventId: payment.id,
          amountUsd: 0,
          status: 'failed',
          message: msg,
        });
      }
    }

    const refundedUsd = outcomes
      .filter(o => o.status === 'succeeded')
      .reduce((sum, o) => sum + o.amountUsd, 0);

    return json({
      ok: true,
      cancelled: !singleTraveler,
      alreadyCancelled: singleTraveler ? false : alreadyCancelled,
      // What could not be allocated: the operator asked for more than the
      // traveler's payments could give back, or some of it was blocked. The
      // client says so rather than letting a $450 request quietly send $200.
      unallocatedUsd:
        singleTraveler && Number.isFinite(remainingCents) && remainingCents > 0
          ? remainingCents / 100
          : 0,
      refunds: outcomes,
      summary: {
        total: outcomes.length,
        succeeded: outcomes.filter(o => o.status === 'succeeded').length,
        alreadyRefunded: outcomes.filter(o => o.status === 'already_refunded').length,
        blocked: outcomes.filter(o => o.status === 'blocked_insufficient_balance').length,
        failed: outcomes.filter(o => o.status === 'failed').length,
        refundedUsd,
      },
    });
  } catch (e) {
    console.error('[trip-cancel]', safeMessage(e));
    return json({ error: 'Could not cancel the trip' }, 500);
  }
});
