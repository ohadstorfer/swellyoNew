// Stripe Connect Express onboarding for operators.
//
// Money never passes through Swellyo's own Stripe account: travelers pay the
// operator's connected account and our commission is split off as an
// application fee. That is what keeps Swellyo out of money transmission —
// Stripe holds the licence, we do not need one.
//
// Payout fields (stripe_account_id / charges_enabled / commission_bps) live in
// `operator_payout_accounts`, not `users`. `users` grants `authenticated`
// full table-wide UPDATE with no column scope, so any user could otherwise
// zero their own commission or self-certify as Stripe-verified. Only the
// service role (used here) may write `operator_payout_accounts`.
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

/** Stripe's REST API, form-encoded. No SDK: one less dependency to pin in Deno. */
async function stripe(path: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    // Stripe error messages are safe to surface; they never contain our keys.
    throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  }
  return body;
}

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

    const { action, returnUrl } = await req.json();

    const { data: payoutRow } = await supabase
      .from('operator_payout_accounts')
      .select('stripe_account_id, charges_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    let accountId: string | null = payoutRow?.stripe_account_id ?? null;

    // ── status: re-read Stripe, because onboarding finishes on Stripe's site
    //    and nothing tells us about it except asking.
    if (action === 'status') {
      if (!accountId) return json({ chargesEnabled: false, accountId: null });
      const acct = await stripe(`accounts/${accountId}`);
      const chargesEnabled = !!acct.charges_enabled;
      await supabase
        .from('operator_payout_accounts')
        .update({ charges_enabled: chargesEnabled })
        .eq('user_id', userId);
      return json({ chargesEnabled, accountId });
    }

    if (action !== 'onboard') return json({ error: 'Unknown action' }, 400);
    if (typeof returnUrl !== 'string' || !returnUrl.startsWith('https://')) {
      return json({ error: 'returnUrl must be an https URL' }, 400);
    }

    // ── onboard: create the account once, then always hand back a fresh link.
    //    Account links expire in minutes, so they are never stored.
    if (!accountId) {
      // Email is not on operator_payout_accounts — read it from users separately.
      const { data: userRow } = await supabase
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

      const acct = await stripe('accounts', {
        type: 'express',
        email: userRow?.email ?? '',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
      });
      accountId = acct.id as string;
      await supabase
        .from('operator_payout_accounts')
        .upsert({ user_id: userId, stripe_account_id: accountId }, { onConflict: 'user_id' });
    }

    const link = await stripe('account_links', {
      account: accountId,
      refresh_url: returnUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return json({ accountId, chargesEnabled: false, onboardingUrl: link.url });
  } catch (e) {
    console.error('[stripe-connect-onboard]', e instanceof Error ? e.message : e);
    return json({ error: 'Could not start Stripe onboarding' }, 500);
  }
});
