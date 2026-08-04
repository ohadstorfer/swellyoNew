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

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path} failed`);
  return res.json();
}

// Postgres error codes that can NEVER succeed on retry. Acknowledge them
// (after logging loudly) so Stripe stops resending for days; anything not in
// this set is treated as transient and gets a 500, which asks Stripe to retry.
const PERMANENT_PG_ERROR_CODES = new Set([
  '23514', // check violation — the row can never satisfy the constraint
  '23503', // foreign key violation — e.g. the trip no longer exists
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
    if (event.account) return new Response('ok');

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
      // issued against it, not the delta for this event. Writing it as-is
      // would double count on a second partial refund. Record only what has
      // not already been recorded for this PaymentIntent.
      const cumulativeRefundedUsd = Number(c.amount_refunded) / 100;
      const { data: priorRefunds } = await supabase
        .from('organized_trip_payment_events')
        .select('amount_usd')
        .eq('provider', 'stripe')
        .eq('provider_object_id', c.payment_intent)
        .eq('event_type', 'refunded');
      const alreadyRefundedUsd = (priorRefunds ?? []).reduce(
        (sum, e) => sum + Math.abs(Number(e.amount_usd)),
        0,
      );
      const deltaUsd = cumulativeRefundedUsd - alreadyRefundedUsd;
      if (deltaUsd <= 0) return new Response('ok'); // nothing new to record

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
        // application_fee_usd intentionally omitted here: Stripe does not
        // tell us how much (if any) of the application fee was reversed by
        // THIS particular refund, and the PaymentIntent's
        // application_fee_amount is the ORIGINAL total, not a remainder —
        // writing it again per refund would overstate fee reversal. Revenue
        // reconciliation reads it off the 'paid' row.
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
      // uq_otpe_provider_event = Stripe redelivered the same event id — the
      // only 23505 that genuinely means "already recorded, nothing lost."
      if (error.code === '23505' && error.message?.includes('uq_otpe_provider_event')) {
        return new Response('ok');
      }
      // Anything else — including a uq_otpe_object collision, which means the
      // ledger's per-object uniqueness rejected a legitimate second event for
      // this (provider_object_id, event_type), e.g. a second partial refund —
      // must surface, not be silently swallowed as if it were a harmless
      // redelivery.
      throw error;
    }

    return new Response('ok');
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code && PERMANENT_PG_ERROR_CODES.has(code)) {
      // Retrying cannot fix a constraint violation. Acknowledge so Stripe
      // stops, but log loudly so a human notices instead of it going quiet.
      console.error(
        '[stripe-webhook] permanent failure, not retrying',
        code,
        e instanceof Error ? e.message : e,
      );
      return new Response('ok');
    }
    console.error('[stripe-webhook]', e instanceof Error ? e.message : e);
    // 500 so Stripe retries — better a duplicate attempt than a lost payment.
    return new Response('error', { status: 500 });
  }
});
