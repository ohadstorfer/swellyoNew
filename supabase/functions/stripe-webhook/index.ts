// Stripe → Swellyo. The single writer of payment history.
//
// verify_jwt = false: Stripe cannot present a Supabase JWT. The function gates
// itself on Stripe's own signature instead, which is strictly stronger — a
// forged body fails the HMAC.
//
// ⚠️ MUST NOT be registered as a Stripe Connect webhook endpoint (an endpoint
// listening "on behalf of" connected accounts). A Connect endpoint receives
// events for every connected account, all signed with this SAME secret — so
// a connected operator could forge an event on THEIR OWN account with
// metadata pointing at someone else's trip/user/requirement and have it
// recorded as a real payment. This must only ever be a platform-account
// endpoint. The `event.account` check below is the enforcement of that even
// if the endpoint is ever misconfigured.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

/**
 * Verify Stripe's `t=…,v1=…` signature header.
 *
 * Done by hand rather than with the Stripe SDK because the SDK's verifier needs
 * Node crypto. WebCrypto is available in Deno and does the same HMAC.
 */
async function verify(payload: string, header: string | null): Promise<boolean> {
  if (!header) return false;

  // Parse into a timestamp plus EVERY v1 candidate. During a signing-secret
  // rotation Stripe sends one v1 per active secret, and its own libraries
  // accept a match against any of them. Object.fromEntries would silently
  // keep only the LAST duplicate key, so every event would 400 for the
  // rotation's whole duration — a silent, retried-into-oblivion loss of
  // payment records.
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  // Reject anything older than five minutes, so a captured request cannot be
  // replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare against each candidate: a length check plus an XOR
  // fold, so a wrong signature never leaks how many leading bytes were right.
  const matchesOne = (candidate: string) => {
    if (expected.length !== candidate.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
    }
    return diff === 0;
  };

  return signatures.some(matchesOne);
}

/**
 * A plain-object thrown error carries a Stripe HTTP status when the failure
 * came from `stripeGet` — used below to treat a Stripe 404 (e.g. the
 * PaymentIntent this webhook needs no longer exists) as permanent instead of
 * retried forever.
 */
async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const err = new Error(`Stripe ${path} failed`) as Error & { stripeStatus?: number };
    err.stripeStatus = res.status;
    throw err;
  }
  return res.json();
}

/**
 * supabase-js v2's `PostgrestError` is a plain object, not an `Error`
 * subclass. `e instanceof Error ? e.message : e` therefore logs the WHOLE
 * object for one — including `.details`, which for a unique-violation embeds
 * the full constraint key (e.g. the Stripe PaymentIntent id). `.message`
 * alone (present on both real Errors and Postgrest-shaped objects) never
 * carries that — log only that, never the raw object.
 */
function safeMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'unknown error';
}

// Postgres error codes that can NEVER succeed on retry. Acknowledge them
// (after logging loudly) so Stripe stops resending for days; anything not in
// this set is treated as transient and gets a 500, which asks Stripe to retry.
const PERMANENT_PG_ERROR_CODES = new Set([
  '23514', // check violation — the row can never satisfy the constraint
  '23503', // foreign key violation — e.g. the trip no longer exists
  '22P02', // invalid text representation — e.g. a non-UUID trip_id in metadata
  '23502', // not null violation
]);

serve(async req => {
  // The signature check fails OPEN if the secret is missing: `Deno.env.get(
  // ...)!` only asserts a type at compile time. At runtime a missing secret
  // is `undefined`, and `TextEncoder().encode(undefined)` silently produces a
  // ZERO-LENGTH HMAC key — importKey succeeds, and anyone can compute a valid
  // signature against an empty key. Bail before ever calling verify().
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('misconfigured', { status: 500 });
  }
  if (!STRIPE_SECRET_KEY) {
    console.error('[stripe-webhook] STRIPE_SECRET_KEY is not set');
    return new Response('misconfigured', { status: 500 });
  }

  const raw = await req.text();

  if (!(await verify(raw, req.headers.get('stripe-signature')))) {
    console.error('[stripe-webhook] bad signature');
    return new Response('bad signature', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // A signed but malformed body must not throw unhandled — keep this
    // inside the try.
    const event = JSON.parse(raw);

    // A valid signature proves the event came from Stripe. It does NOT prove
    // it describes OUR platform account — see the file-header warning. Any
    // event carrying `account` is a Connect-account event and is ignored.
    // Logged, not silent: silently dropping it would hide the exact
    // misconfiguration the header warns about, with zero signal that it
    // happened.
    if (event.account) {
      console.error('[stripe-webhook] ignoring Connect-account event; this endpoint must be platform-account only', event.account);
      return new Response('ok');
    }

    let row: Record<string, unknown> | null = null;

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      // A session can complete without the money actually arriving.
      if (s.payment_status !== 'paid') return new Response('ok');

      if (!s.payment_intent) {
        console.error('[stripe-webhook] paid session has no payment_intent', event.id);
        return new Response('ok'); // permanent — retrying adds nothing
      }

      const currency = String(s.currency ?? '').toLowerCase();
      if (currency !== 'usd') {
        // amount_usd is a straight cents/100 conversion — only correct for
        // USD. Checkout only ever creates USD sessions today (the Israeli
        // gateway mentioned in payments-checkout is a separate function, not
        // a currency on this one); a non-USD event here means something
        // upstream changed without this handler being updated for it.
        console.error(
          '[stripe-webhook] unsupported currency, refusing to write',
          currency,
          event.id,
        );
        return new Response('ok');
      }

      const m = s.metadata ?? {};

      // Read the fee Stripe actually applied to this PaymentIntent, so
      // Swellyo's own revenue can be reconciled straight from the ledger
      // instead of being computed-and-discarded at checkout time.
      const pi = await stripeGet(`payment_intents/${s.payment_intent}`);

      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: s.payment_intent,
        event_type: 'paid',
        amount_usd: Number(s.amount_total) / 100,
        amount_charged: Number(s.amount_total) / 100,
        currency_charged: currency.toUpperCase(),
        application_fee_usd:
          pi.application_fee_amount != null ? Number(pi.application_fee_amount) / 100 : null,
        // Stripe test-mode events must never be mistaken for real money.
        is_livemode: !!event.livemode,
      };
    } else if (event.type === 'charge.refunded') {
      const c = event.data.object;

      if (!c.payment_intent) {
        console.error('[stripe-webhook] refund has no payment_intent', event.id);
        return new Response('ok'); // permanent — nothing to look up
      }

      const currency = String(c.currency ?? '').toLowerCase();
      if (currency !== 'usd') {
        console.error(
          '[stripe-webhook] unsupported currency, refusing to write',
          currency,
          event.id,
        );
        return new Response('ok');
      }

      // A charge carries no metadata of ours — the PaymentIntent does.
      const pi = await stripeGet(`payment_intents/${c.payment_intent}`);
      const m = pi.metadata ?? {};

      // `amount_refunded` on a charge is CUMULATIVE across every refund ever
      // issued against it, not the delta for this event — write it as-is and
      // a second partial refund double-counts. Compute the delta in INTEGER
      // CENTS, not dollars: summing already-divided `amount_usd` doubles
      // accumulates float residue (e.g. prior rows of $0.01 and $0.06 against
      // a $0.07 cumulative can yield a "delta" of 1.39e-17 — a positive
      // number, so it would insert a garbage near-zero row). Stripe's
      // `amount_refunded` is already an integer number of cents; stay in
      // cents until the very last step.
      const cumulativeRefundedCents = Number(c.amount_refunded);

      const { data: priorRefunds, error: priorErr } = await supabase
        .from('organized_trip_payment_events')
        .select('amount_usd')
        .eq('provider', 'stripe')
        .eq('provider_object_id', c.payment_intent)
        .eq('event_type', 'refunded');
      // A transient read failure must not be treated as "nothing recorded
      // yet" — that would make alreadyRefundedCents fall back to 0 and the
      // delta become the FULL cumulative refund, double-recording it. Throw
      // so this 500s and Stripe retries instead.
      if (priorErr) throw priorErr;

      const alreadyRefundedCents = (priorRefunds ?? []).reduce(
        (sum, e) => sum + Math.round(Math.abs(Number(e.amount_usd)) * 100),
        0,
      );
      const deltaCents = cumulativeRefundedCents - alreadyRefundedCents;
      if (deltaCents <= 0) return new Response('ok'); // nothing new to record

      const deltaUsd = deltaCents / 100;

      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: c.payment_intent,
        event_type: 'refunded',
        // Negative, so the traveler's balance is always a plain sum().
        amount_usd: -deltaUsd,
        amount_charged: -deltaUsd,
        currency_charged: currency.toUpperCase(),
        is_livemode: !!event.livemode,
        // application_fee_usd intentionally left out here: this IS
        // reconstructable — for a destination charge the `application_fee`
        // object carries a cumulative `amount_refunded` too, readable via
        // `/v1/application_fees/{id}` when the refund was created with
        // `refund_application_fee: true`, and the same delta technique above
        // would work on it. Deferred because nothing in this codebase issues
        // refunds yet. Known gap, not a limitation: until this is wired up,
        // sum(application_fee_usd) OVERSTATES Swellyo's net revenue by the
        // full fee on any refunded charge.
      };
    } else {
      // Everything else is acknowledged and ignored, so Stripe stops retrying.
      return new Response('ok');
    }

    if (!row.trip_id || !row.user_id || !row.requirement_id) {
      console.error('[stripe-webhook] event missing metadata', event.id);
      // 200 on purpose: retrying will not add the metadata back.
      return new Response('ok');
    }

    const { error } = await supabase.from('organized_trip_payment_events').insert(row);

    if (error) {
      if (error.code === '23505') {
        // Two different unique indexes can raise 23505 here: a genuine
        // Stripe redelivery of the same event id (uq_otpe_provider_event),
        // or — for a 'paid' row — a second event describing the same
        // PaymentIntent (uq_otpe_object, scoped to event_type = 'paid').
        // Matching by constraint NAME would assume Postgres reports
        // uq_otpe_provider_event first when both are violated — true today
        // because index checks run in OID order, but a dump/restore that
        // reverses the OIDs would turn ordinary redeliveries into 500 loops.
        // Ask the table directly instead: this event id already having a row
        // IS what "redelivery" means, independent of index internals.
        const { data: already, error: lookupErr } = await supabase
          .from('organized_trip_payment_events')
          .select('id')
          .eq('provider', 'stripe')
          .eq('provider_event_id', event.id)
          .maybeSingle();
        if (!lookupErr && already) return new Response('ok'); // genuine redelivery
        // Otherwise: the other collision, or the lookup itself failed —
        // surface it rather than silently discarding a legitimate event.
      }
      throw error;
    }

    return new Response('ok');
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    const stripeStatus = (e as { stripeStatus?: number } | null)?.stripeStatus;
    if ((code && PERMANENT_PG_ERROR_CODES.has(code)) || stripeStatus === 404) {
      // Retrying cannot fix a constraint violation, and a 404 from Stripe
      // (e.g. the PaymentIntent this event points at no longer exists) will
      // not resolve itself either. Acknowledge so Stripe stops, but log
      // loudly so a human notices instead of it going quiet.
      console.error(
        '[stripe-webhook] permanent failure, not retrying',
        code ?? `stripe ${stripeStatus}`,
        safeMessage(e),
      );
      return new Response('ok');
    }
    console.error('[stripe-webhook]', safeMessage(e));
    // 500 so Stripe retries — better a duplicate attempt than a lost payment.
    return new Response('error', { status: 500 });
  }
});
