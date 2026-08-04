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

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

// Mirrors usdToStripeCents / commissionCents in tripPaymentsService.ts.
// Round, never truncate: 19.99 * 100 is 1998.9999999999998 in floating point.
const toCents = (usd: number) => Math.round(usd * 100);
const feeCents = (total: number, bps: number) =>
  Math.min(total, Math.round((total * bps) / 10000));

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const userId = userData.user.id;

    const { requirementId, returnUrl } = await req.json();
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
    const commission = feeCents(amountCents, host.commission_bps ?? 1200);

    // ── 5. Destination charge: the operator is paid, our fee is split off.
    const session = await stripe('checkout/sessions', {
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
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('[payments-checkout]', e instanceof Error ? e.message : e);
    return json({ error: 'Could not start the payment' }, 500);
  }
});
