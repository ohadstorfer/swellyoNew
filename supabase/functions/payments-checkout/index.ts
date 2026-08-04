// Creates one Stripe Checkout Session for one pay requirement.
//
// Named `payments-checkout`, not `stripe-checkout`, because an Israeli gateway
// (Tranzila) is expected later and becomes a branch inside here rather than a
// second call site on the client.
//
// The host's payout fields (stripe_account_id / charges_enabled /
// commission_bps) live in `operator_payout_accounts`, not `users` — see
// stripe-connect-onboard for why. Only the service role (used here) may read
// it under RLS.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

/**
 * `idempotencyKey`, when given, is sent as Stripe's `Idempotency-Key` header —
 * a retried POST (network blip, double tap on "pay") replays the cached
 * response instead of minting a second Checkout Session.
 */
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

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

/**
 * supabase-js v2's `PostgrestError` is a plain object, not an `Error`
 * subclass. `e instanceof Error ? e.message : e` therefore logs the WHOLE
 * object for one — including `.details`, which can embed identifiers.
 * `.message` alone (present on both real Errors and Postgrest-shaped
 * objects) doesn't carry that — log only that, never the raw object.
 */
function safeMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'unknown error';
}

// Mirrors usdToStripeCents / commissionCents in tripPaymentsService.ts.
// Round, never truncate: 19.99 * 100 is 1998.9999999999998 in floating point.
const toCents = (usd: number) => Math.round(usd * 100);
const feeCents = (total: number, bps: number) =>
  Math.min(total, Math.round((total * bps) / 10000));

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // `Deno.env.get(...)!` only asserts a type at compile time — at runtime a
  // missing secret is `undefined` and every Stripe call below would fail with
  // a confusing 401 from Stripe instead of a clear error here.
  if (!STRIPE_SECRET_KEY) {
    console.error('[payments-checkout] STRIPE_SECRET_KEY is not set');
    return json({ error: 'Stripe is not configured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const userId = userData.user.id;

    let body: { requirementId?: string; returnUrl?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const { requirementId, returnUrl } = body;
    if (typeof requirementId !== 'string') return json({ error: 'requirementId required' }, 400);
    if (typeof returnUrl !== 'string' || !returnUrl.startsWith('https://')) {
      return json({ error: 'returnUrl must be an https URL' }, 400);
    }

    // ── 1. The requirement must be a live pay row.
    const { data: req_ } = await supabase
      .from('organized_trip_requirements')
      .select('id, trip_id, kind, req_type, title, is_active')
      .eq('id', requirementId)
      .single();

    if (!req_ || req_.req_type !== 'pay' || !req_.is_active) {
      return json({ error: 'Not a payment step' }, 400);
    }

    // ── 2. The caller must actually be on this trip. Without this check any
    //      signed-in user could open a checkout against someone else's trip.
    const { data: participant } = await supabase
      .from('group_trip_participants')
      .select('user_id')
      .eq('trip_id', req_.trip_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!participant) return json({ error: 'You are not on this trip' }, 403);

    // ── 3. The trip must still be collecting, and the operator must be able to
    //      receive. Re-checked here because the client is not trustworthy.
    const { data: trip } = await supabase
      .from('group_trips')
      .select('id, title, host_id, payment_mode')
      .eq('id', req_.trip_id)
      .single();

    if (!trip || trip.payment_mode !== 'managed') {
      return json({ error: 'This trip is not collecting payments' }, 400);
    }

    const { data: host } = await supabase
      .from('operator_payout_accounts')
      .select('stripe_account_id, charges_enabled, commission_bps')
      .eq('user_id', trip.host_id)
      .maybeSingle();

    if (!host?.stripe_account_id || !host.charges_enabled) {
      return json({ error: 'The organiser cannot accept payments yet' }, 400);
    }

    // ── 4. What is still owed. Server-side, always.
    const { data: dueRaw, error: dueErr } = await supabase.rpc(
      'operator_traveler_amount_due',
      { p_trip_id: req_.trip_id, p_user_id: userId, p_kind: req_.kind },
    );
    if (dueErr) throw dueErr;

    const due = Number(dueRaw ?? 0);
    if (!Number.isFinite(due) || due <= 0) {
      return json({ error: 'Nothing to pay' }, 400);
    }

    const { data: events } = await supabase
      .from('organized_trip_payment_events')
      .select('amount_usd')
      .eq('trip_id', req_.trip_id)
      .eq('user_id', userId)
      .eq('requirement_id', requirementId);

    const paid = (events ?? []).reduce((s, e) => s + Number(e.amount_usd), 0);
    const outstanding = Math.max(0, due - paid);
    if (outstanding <= 0) return json({ error: 'Already paid' }, 400);

    const amountCents = toCents(outstanding);
    // commission_bps is `not null default 1200` in the database — the ?? 1200
    // fallback this used to have was dead code, and if it had ever fired it
    // would have applied a fee the database itself disagrees with.
    const commission = feeCents(amountCents, host.commission_bps);

    // I9: the ledger only moves once the webhook fires, so two checkouts
    // opened back to back both compute the full outstanding amount and both
    // could be paid. Stripe's list endpoint has no server-side metadata
    // filter, so list recent OPEN sessions (not completed, not expired) and
    // match client-side — cheap at today's volume.
    //
    // This only closes the SEQUENTIAL race ("came back later after opening a
    // session"): two genuinely concurrent requests both list before either
    // creates, both see nothing, and it is the deterministic Idempotency-Key
    // below — not this lookup — that collapses those into one session.
    //
    // Known limits: `limit=100` returns the most recent open sessions
    // PLATFORM-WIDE, not per user — past ~100 concurrent open sessions across
    // ALL operators the target can fall off the page with no signal beyond
    // the log line below. A small `operator_checkout_sessions` table keyed on
    // (user_id, requirement_id) would be simpler and exact, and should
    // replace this before volume gets anywhere near that.
    const openSessions = await stripeGet('checkout/sessions?status=open&limit=100');
    const sessionsData: Array<{
      id: string;
      url?: string;
      amount_total?: number;
      metadata?: Record<string, string>;
    }> = openSessions.data ?? [];
    if (sessionsData.length >= 100) {
      console.error(
        '[payments-checkout] open Stripe session list hit its page limit; dedup can silently miss the target session',
      );
    }
    const existing = sessionsData.find(
      sess =>
        sess.metadata?.trip_id === req_.trip_id &&
        sess.metadata?.user_id === userId &&
        sess.metadata?.requirement_id === requirementId,
    );

    if (existing) {
      if (existing.amount_total === amountCents && existing.url) {
        return json({ url: existing.url });
      }
      // The amount owed changed since this session was opened — e.g. the
      // host edited this traveler's price, the headline feature of this
      // whole project. Reusing it would over- or under-charge. Expire it so
      // it can never be paid at the stale amount, then fall through to mint
      // a fresh one below.
      try {
        await stripe(`checkout/sessions/${existing.id}/expire`, {});
      } catch (expireErr) {
        console.error('[payments-checkout] failed to expire stale session', safeMessage(expireErr));
      }
    }

    // ── 5. Destination charge: the operator is paid, our fee is split off.
    //      The idempotency key includes the ledger row count for this
    //      requirement, not just user/requirement/amount: without it, a
    //      pay -> refund -> re-pay at the same amount within Stripe's 24h
    //      idempotency window would replay the CACHED response — the
    //      original, already-completed session, a dead URL the traveler
    //      cannot pay through. The refund adds a ledger row, which changes
    //      the count and forces a fresh key.
    const idempotencyKey = `checkout:${userId}:${requirementId}:${amountCents}:${(events ?? []).length}`;
    const session = await stripe(
      'checkout/sessions',
      {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][price_data][product_data][name]': `${trip.title} — ${req_.title}`,
        'payment_intent_data[application_fee_amount]': String(commission),
        'payment_intent_data[transfer_data][destination]': host.stripe_account_id,
        // The webhook reads these back. They are the only link from a Stripe
        // event to a row in our database.
        'payment_intent_data[metadata][trip_id]': req_.trip_id,
        'payment_intent_data[metadata][user_id]': userId,
        'payment_intent_data[metadata][requirement_id]': requirementId,
        'metadata[trip_id]': req_.trip_id,
        'metadata[user_id]': userId,
        'metadata[requirement_id]': requirementId,
        success_url: returnUrl,
        cancel_url: returnUrl,
      },
      idempotencyKey,
    );

    return json({ url: session.url });
  } catch (e) {
    console.error('[payments-checkout]', safeMessage(e));
    return json({ error: 'Could not start the payment' }, 500);
  }
});
