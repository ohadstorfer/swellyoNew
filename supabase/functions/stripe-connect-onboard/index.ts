// Stripe Connect Express onboarding for operators.
//
// This is a destination charge (see payments-checkout): the traveler's payment
// settles on Swellyo's OWN Stripe platform balance first, and only then
// transfers to the operator's connected account, with our commission held
// back as an application fee. Because funds land on the platform balance
// before moving anywhere else, Swellyo is merchant of record for these
// charges and carries the dispute/chargeback liability that comes with that —
// that is a fact about how a destination charge works, not a policy choice.
// Whether to add `on_behalf_of` (which would make the operator the merchant
// of record instead) is a liability decision for a human to make, not
// something this file decides.
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

/**
 * Stripe's REST API, form-encoded. No SDK: one less dependency to pin in Deno.
 *
 * `idempotencyKey`, when given, is sent as Stripe's `Idempotency-Key` header —
 * a retried POST (network blip, double form submit) replays the cached
 * response instead of creating a second Stripe object.
 */
async function stripe(path: string, params?: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers,
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    // Stripe error messages are safe to surface; they never contain our keys.
    throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  }
  return body;
}

/**
 * Create this operator's Express account and record it, or return null if it
 * could not be recorded.
 *
 * Shared by the hosted (`onboard`) and native (`account_session`) paths so
 * they can never drift into creating differently-configured accounts for the
 * same product. `controller.stripe_dashboard.type` is IMMUTABLE once an
 * account exists, so a divergence here would be unfixable without recreating
 * every operator's account.
 *
 * Express, i.e. Stripe collects requirements and carries negative-balance
 * liability. Ohad's decision on 2026-08-04, taken while zero accounts existed.
 * Changing it is not an edit to this line — it is a migration of every
 * connected account.
 *
 * Returns null (already logged) when Stripe made the account but we could not
 * persist the id. See the caller comments: continuing past that would orphan
 * a live Stripe account AND let a retry create a second one.
 */
async function createExpressAccount(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  // Email is not on operator_payout_accounts — read it from users separately.
  const { data: userRow } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();

  // Deterministic and stable: only ONE Express account should ever exist per
  // operator. A retried request must land on the same account, not create a
  // second one. Shared by both actions on purpose — a user who starts the
  // native flow and falls back to hosted must not end up with two accounts.
  const acct = await stripe(
    'accounts',
    {
      type: 'express',
      email: userRow?.email ?? '',
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
    },
    `connect-account:${userId}`,
  );
  const accountId = acct.id as string;

  const { error: upsertErr } = await supabase
    .from('operator_payout_accounts')
    .upsert({ user_id: userId, stripe_account_id: accountId }, { onConflict: 'user_id' });

  if (upsertErr) {
    // I7: the Stripe account now exists but is not recorded anywhere.
    // Continuing would let onboarding finish against an account we can no
    // longer find, AND a retry of the whole request would create a SECOND
    // Express account (the lookup by user_id still sees nothing). Fail
    // loudly instead of quietly orphaning it.
    console.error(
      '[stripe-connect-onboard] failed to persist stripe_account_id',
      upsertErr.message,
    );
    return null;
  }
  return accountId;
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // `Deno.env.get(...)!` only asserts a type at compile time — at runtime a
  // missing secret is `undefined` and every Stripe call below would fail with
  // a confusing 401 from Stripe instead of a clear error here.
  if (!STRIPE_SECRET_KEY) {
    console.error('[stripe-connect-onboard] STRIPE_SECRET_KEY is not set');
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

    let body: { action?: string; returnUrl?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const { action, returnUrl } = body;

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
      const { error: updateErr } = await supabase
        .from('operator_payout_accounts')
        .update({ charges_enabled: chargesEnabled })
        .eq('user_id', userId);
      if (updateErr) {
        // Stripe stays the source of truth either way, and the response below
        // is still correct — this is only our local cache falling behind, so
        // log it and keep going rather than fail the whole request.
        console.error('[stripe-connect-onboard] failed to cache charges_enabled', updateErr.message);
      }
      return json({ chargesEnabled, accountId });
    }

    // ── diagnose: which Stripe account and mode is this key actually on?
    //
    // Exists because Stripe sandboxes and Test mode are separate environments
    // with separate keys and separate Connect signups, and NOTHING in the
    // normal flow tells you which one STRIPE_SECRET_KEY belongs to. Two people
    // can each be certain they enabled Connect and both be right about
    // different environments.
    //
    // Read-only, and returns identifiers rather than secrets: an `acct_…` id
    // and a livemode flag are not credentials. `charges_enabled` here is the
    // PLATFORM's own, not any operator's.
    if (action === 'diagnose') {
      const platform = await stripe('account');
      return json({
        // The one value that settles "which environment is this?". Compare it
        // against the account shown in the Stripe dashboard you enabled
        // Connect on. A sandbox has a DIFFERENT acct_ id from Test mode.
        platformAccountId: platform.id,
        // From the key prefix, which is definitive and never exposes the key.
        keyMode: STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test',
        // Does the CALLER already have a payout account? Not a platform fact —
        // included because "did my account get created" is the other question
        // people ask at this point.
        callerHasPayoutAccount: !!accountId,
      });
    }

    // ── account_session: the native embedded onboarding component.
    //
    // Same Express account as the hosted flow — this only changes WHERE the
    // form is drawn, never who the account belongs to or who carries risk.
    // The client secret is short-lived and scoped to this one account; the
    // SDK refetches it by calling here again when it expires, so it is never
    // stored anywhere.
    //
    // `disable_stripe_user_authentication` is deliberately NOT set. It is only
    // accepted when `controller.requirement_collection` is `application`, and
    // these are Express accounts where STRIPE collects requirements and
    // carries negative-balance liability (Ohad's decision, 2026-08-04). Asking
    // for it here would be rejected by Stripe, and getting it would mean
    // taking that liability on. The operator therefore still authenticates
    // with Stripe partway through — that is the trade that was chosen.
    if (action === 'account_session') {
      if (!accountId) {
        accountId = await createExpressAccount(supabase, userId);
        if (!accountId) return json({ error: 'Could not start Stripe onboarding' }, 500);
      }
      const session = await stripe('account_sessions', {
        account: accountId,
        'components[account_onboarding][enabled]': 'true',
      });
      return json({
        accountId,
        clientSecret: session.client_secret,
        chargesEnabled: payoutRow?.charges_enabled ?? false,
      });
    }

    if (action !== 'onboard') return json({ error: 'Unknown action' }, 400);
    // Same allowlist as payments-checkout — see the long comment there. An
    // app-scheme return closes the browser sheet by itself instead of stranding
    // the operator on a web page.
    const devSchemes = STRIPE_SECRET_KEY.startsWith('sk_test_')
      ? ['exp://', 'exp+swellyo://']
      : [];
    const allowedPrefixes = ['https://', 'swellyo://', ...devSchemes];
    if (
      typeof returnUrl !== 'string' ||
      !allowedPrefixes.some((p) => returnUrl.startsWith(p))
    ) {
      return json({ error: 'returnUrl scheme is not allowed' }, 400);
    }

    // Authentication (above) is the only gate on onboarding. There is
    // deliberately NO "you must already host a published operator trip"
    // check here — an earlier version had one and it was a hard deadlock:
    // ConnectStripeCard renders inside the CREATE wizard's budget step,
    // before any trip row exists, and the wizard blocks Next until Stripe
    // says charges are enabled. A first-time operator could therefore never
    // turn payments on at all, and edit mode could not rescue them (the
    // wizard forces payment_mode to 'offline' unless the trip is already
    // managed). Do not re-add it.
    //
    // The abuse that check was meant to prevent — unbounded Express account
    // creation under our platform account, which is both something Stripe
    // flags and the precondition for the Connect-event forgery guarded
    // against in stripe-webhook (event.account) — is already STRUCTURALLY
    // bounded and does not need a policy check: `operator_payout_accounts`
    // has `user_id` as its PRIMARY KEY, so one user can hold at most one
    // payout account no matter how many times they call this. A repeat call
    // finds the existing `accountId` above and only mints a fresh link.
    //
    // ── onboard: create the account once, then always hand back a fresh link.
    //    Account links expire in minutes, so they are never stored.
    if (!accountId) {
      accountId = await createExpressAccount(supabase, userId);
      if (!accountId) return json({ error: 'Could not start Stripe onboarding' }, 500);
    }

    // Time-bucketed, not permanently stable: account links deliberately stay
    // fresh (they expire in minutes and the brief calls out that they are
    // never stored), but a request retried within the same minute — a
    // network blip, a double tap — should not mint two live links.
    const linkIdempotencyKey = `account-link:${userId}:${accountId}:${Math.floor(Date.now() / 60000)}`;
    const link = await stripe(
      'account_links',
      {
        account: accountId,
        refresh_url: returnUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      },
      linkIdempotencyKey,
    );

    return json({
      accountId,
      // The real cached value, not a hardcoded false — an operator revisiting
      // onboarding (e.g. to update bank details) may already be enabled.
      chargesEnabled: payoutRow?.charges_enabled ?? false,
      onboardingUrl: link.url,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error('[stripe-connect-onboard]', raw);

    // A SETUP problem, not a runtime one: this platform's Stripe account has
    // never been signed up for Connect, so it may not create accounts for
    // anyone. Collapsing it into the generic message below cost a day of
    // guessing — the operator saw "Could not start Stripe onboarding" and had
    // no way to know it was nothing to do with them.
    //
    // The trap underneath it: Stripe sandboxes and Test mode are SEPARATE
    // environments, each with its own keys AND its own Connect signup.
    // Enabling Connect in one while STRIPE_SECRET_KEY comes from the other
    // produces exactly this error, and nothing on screen says which
    // environment is which. So name the account the key actually belongs to —
    // an `acct_…` id is an identifier, not a credential, and it turns
    // "somewhere isn't set up" into "THIS one isn't set up".
    if (/signed up for Connect/i.test(raw)) {
      let who = '';
      try {
        const platform = await stripe('account');
        const mode = STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
        who =
          ` The key in use is a ${mode} key for Stripe account ${platform.id}.` +
          ' Connect must be enabled on THAT account — a sandbox and Test mode' +
          ' are separate environments with separate Connect signups.';
      } catch {
        // Never let the diagnostic itself break the response.
      }
      return json(
        {
          error:
            'Stripe Connect is not enabled on this Swellyo Stripe account, so operator ' +
            'accounts cannot be created yet. This is a one-time setup step and is not ' +
            'something the operator can fix.' + who,
          code: 'connect_not_enabled',
        },
        503,
      );
    }

    return json({ error: 'Could not start Stripe onboarding' }, 500);
  }
});
