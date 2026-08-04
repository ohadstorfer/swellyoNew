// Stripe → Swellyo. The single writer of payment history.
//
// verify_jwt = false: Stripe cannot present a Supabase JWT. The function gates
// itself on Stripe's own signature instead, which is strictly stronger — a
// forged body fails the HMAC.
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
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=') as [string, string]),
  );
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

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

  // Constant-time compare: a length check plus an XOR fold, so a wrong
  // signature never leaks how many leading bytes were right.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe ${path} failed`);
  return res.json();
}

serve(async req => {
  const raw = await req.text();

  if (!(await verify(raw, req.headers.get('stripe-signature')))) {
    console.error('[stripe-webhook] bad signature');
    return new Response('bad signature', { status: 400 });
  }

  const event = JSON.parse(raw);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    let row: Record<string, unknown> | null = null;

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      // A session can complete without the money actually arriving.
      if (s.payment_status !== 'paid') return new Response('ok');

      const m = s.metadata ?? {};
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
        currency_charged: String(s.currency ?? 'usd').toUpperCase(),
      };
    } else if (event.type === 'charge.refunded') {
      const c = event.data.object;
      // A charge carries no metadata of ours — the PaymentIntent does.
      const pi = await stripeGet(`payment_intents/${c.payment_intent}`);
      const m = pi.metadata ?? {};
      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: c.payment_intent,
        event_type: 'refunded',
        // Negative, so the traveler's balance is always a plain sum().
        amount_usd: -(Number(c.amount_refunded) / 100),
        amount_charged: -(Number(c.amount_refunded) / 100),
        currency_charged: String(c.currency ?? 'usd').toUpperCase(),
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

    // 23505 = the unique index on (provider, provider_event_id). Stripe
    // redelivers events; a duplicate means we already recorded this one.
    if (error && error.code !== '23505') throw error;

    return new Response('ok');
  } catch (e) {
    console.error('[stripe-webhook]', e instanceof Error ? e.message : e);
    // 500 so Stripe retries — better a duplicate attempt than a lost payment.
    return new Response('error', { status: 500 });
  }
});
