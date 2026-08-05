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
    // Stripe accepts custom URL schemes here (verified against the API,
    // 2026-08-04) — the old https-only rule was based on a wrong belief and
    // forced every payer onto a web page that does not exist. An app-scheme
    // return is what lets the browser sheet close itself and drop the traveler
    // back where they were.
    //
    // Still an allowlist, not "anything goes": `returnUrl` arrives from the
    // client and is handed to Stripe verbatim. The blast radius is only the
    // payer's own browser, but there is no reason to accept `javascript:` or a
    // data URL. Expo's dev schemes carry the dev machine's IP, so they cannot
    // be pinned to a constant — they are gated on the TEST key instead, the
    // same way the platform-charge path above is.
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

    // Can this charge actually be routed to the operator? Everything below —
    // the amount, the ledger, the webhook, what the traveler sees — is
    // identical either way; only the destination and the platform fee differ.
    const routeToOperator = !!host?.stripe_account_id && !!host.charges_enabled;

    // TEST-KEY ONLY: let the charge land on the PLATFORM account when the
    // operator has no connected account. This exists so the payment flow can be
    // exercised end to end before Stripe Connect onboarding is set up — a
    // Connect platform signup is a business step, not a code one, and blocking
    // every test on it meant the deposit/balance/refund paths could not be
    // tested at all.
    //
    // The gate is the KEY ITSELF, not a flag anyone can set: a `sk_live_` key
    // can never take this branch, so real money can never reach the platform
    // account by this route. Do not replace it with an env var — an env var is
    // one typo away from being true in production. Ohad, 2026-08-04.
    const isTestKey = STRIPE_SECRET_KEY.startsWith('sk_test_');
    if (!routeToOperator && !isTestKey) {
      // This message is shown to a TRAVELER, verbatim, in an alert. As of
      // 2026-08-05 an operator may publish a managed trip while Stripe is
      // still verifying them, so hitting this is no longer a sign that
      // something is broken — it is a normal, temporary window that usually
      // closes in minutes. Say that, rather than telling a paying customer
      // that the person running their trip "cannot accept payments", which
      // reads like a warning about the operator.
      return json(
        { error: 'The organiser is still setting up payments. Please try again a bit later.' },
        400,
      );
    }
    if (!routeToOperator) {
      console.warn(
        '[payments-checkout] TEST KEY: no connected account for host',
        trip.host_id,
        '— charging the platform account, no operator transfer, no fee.',
      );
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

    // Deliberately UNFILTERED — the filtering happens in JS below. `events`
    // has two jobs with two different correct scopes: the money sum (which
    // must exclude 'failed' rows and wrong-mode rows) and the row COUNT used
    // as an idempotency-key discriminator (which must count every row that
    // has ever landed here, or the key stops changing when it should). A
    // `.neq(...)` here would silently narrow both.
    const { data: events, error: eventsErr } = await supabase
      .from('organized_trip_payment_events')
      .select('amount_usd, event_type, is_livemode')
      .eq('trip_id', req_.trip_id)
      .eq('user_id', userId)
      .eq('requirement_id', requirementId);
    // A transient read failure must not be treated as "no payment history" —
    // that would make `paid` fall back to 0 and `outstanding` become the FULL
    // amount, sending a traveler who already part-paid to checkout for
    // everything. `events` is also the idempotency-key discriminator below;
    // silently resetting it to an empty array could collide with a
    // pre-refund key too. Throw so this 500s and the caller retries.
    if (eventsErr) throw eventsErr;

    // I4: exclude 'failed' rows, mirroring operator_requirement_pay_state and
    // fetchPaidByRequirement. otpe_amount_sign_matches_type already pins a
    // 'failed' row's amount to exactly 0, so this is belt-and-suspenders —
    // both mirrors carry the same filter with the same comment, deliberately
    // refusing to let the money arithmetic depend on that CHECK holding, and
    // this call site was the only one of the three missing it.
    //
    // I1: and only money from the Stripe mode this function's own key is
    // operating in. Test-mode rows written during a device test against the
    // production database would otherwise be treated as real payments here,
    // making `outstanding` 0 and refusing a genuine live checkout with
    // "Already paid". The key prefix — not a config flag — is the honest
    // discriminator: it is by definition the mode any charge this function
    // creates would land in. Mirrors the database's `app.stripe_livemode`
    // switch documented in 20260803000000, which must be set to match the
    // key that is installed.
    const isLivemode = STRIPE_SECRET_KEY.startsWith('sk_live_');
    const paid = (events ?? [])
      .filter(e => e.event_type !== 'failed' && e.is_livemode === isLivemode)
      .reduce((s, e) => s + Number(e.amount_usd), 0);
    const outstanding = Math.max(0, due - paid);
    if (outstanding <= 0) return json({ error: 'Already paid' }, 400);

    const amountCents = toCents(outstanding);
    // commission_bps is `not null default 1200` in the database — the ?? 1200
    // fallback this used to have was dead code, and if it had ever fired it
    // would have applied a fee the database itself disagrees with.
    // No operator to pay means no cut to take. `host` is null on that path, so
    // this also has to survive the missing row.
    const commission = routeToOperator ? feeCents(amountCents, host!.commission_bps) : 0;

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
    // Known limit, escalated rather than fixed here: `has_more` below only
    // means "there could be more sessions we didn't see" — it is a LOG LINE,
    // not a control. If the target session falls off this page (past ~100
    // concurrently OPEN sessions PLATFORM-WIDE, across every operator, not
    // just this one), price-freshness enforcement below silently stops
    // applying to it — a stale-priced session stays payable with no way for
    // this function to notice. A small `operator_checkout_sessions` table
    // keyed on (user_id, requirement_id) is the correct, exact-cardinality
    // fix and should replace this before real traffic volume arrives; that
    // is a schema change and a deploy-gating decision, not something to make
    // inside a fix round. It is also not just a dedup nicety at this point —
    // see the note on idempotencySuffix below for the second, independent
    // hole the same missing table leaves open.
    const openSessions = await stripeGet('checkout/sessions?status=open&limit=100');
    const sessionsData: Array<{
      id: string;
      url?: string;
      amount_total?: number;
      metadata?: Record<string, string>;
    }> = openSessions.data ?? [];
    if (openSessions.has_more) {
      console.error(
        '[payments-checkout] open Stripe session list has more pages than fetched; dedup/price-freshness enforcement is unactionable past this point for this request',
      );
    }

    // There can be more than one open session for this requirement (e.g. a
    // previous request's expire attempt failed and it was left behind) — a
    // single .find would leave the others live and payable at stale prices.
    const matches = sessionsData.filter(
      sess =>
        sess.metadata?.trip_id === req_.trip_id &&
        sess.metadata?.user_id === userId &&
        sess.metadata?.requirement_id === requirementId,
    );

    // Partition rather than early-return on freshMatch: if `matches` holds
    // BOTH a correctly-priced session and a stale one (reachable — two
    // concurrent requests straddling a price edit each list before either
    // creates, each see nothing, each mint at a different amount with
    // different idempotency keys, so Stripe never collapses them, and the
    // next request sees both), returning freshMatch.url immediately would
    // skip expiring the stale one, leaving it live and payable at the old
    // amount — exactly what expiring is here to prevent. Every non-fresh
    // match is expired FIRST, unconditionally, and only then does a fresh
    // match (if any) get returned.
    const freshMatch = matches.find(sess => sess.amount_total === amountCents && sess.url);
    const staleMatches = matches.filter(sess => sess.id !== freshMatch?.id);

    if (staleMatches.length > 0) {
      // e.g. the host edited this traveler's price, the headline feature of
      // this whole project. Expire every stale one so none of them can ever
      // be paid at a stale amount. Fail CLOSED on a REAL failure: if a
      // session turns out to be 'complete' (one realistic reason expire can
      // fail is that it just completed — the status=open list is seconds
      // stale — and minting a new session would double-charge an already-
      // succeeded payment), stop and ask the caller to retry. But tolerate
      // an already-'expired' session without failing: two concurrent
      // requests can both try to expire the same stale session, and the
      // loser seeing Stripe's "already expired" error is not a real problem
      // — re-check status before treating it as one, so an ordinary double
      // tap doesn't hard-fail with a 500.
      for (const stale of staleMatches) {
        try {
          await stripe(`checkout/sessions/${stale.id}/expire`, {});
        } catch (expireErr) {
          let alreadyExpired = false;
          try {
            const refetched = await stripeGet(`checkout/sessions/${stale.id}`);
            alreadyExpired = refetched.status === 'expired';
          } catch {
            // couldn't even re-check — treat conservatively, same as below.
          }
          if (!alreadyExpired) {
            console.error(
              '[payments-checkout] failed to expire a stale session, refusing to mint a new one',
              safeMessage(expireErr),
            );
            return json({ error: 'Could not start the payment' }, 500);
          }
        }
      }
    }

    if (freshMatch) return json({ url: freshMatch.url });

    // The idempotency key below must change once a session for this exact
    // (user, requirement, amount) has already existed and been expired —
    // otherwise, if the amount ever returns to a previously-used value
    // inside Stripe's 24h idempotency window (an operator raising then
    // correcting a price back down is an entirely ordinary sequence for
    // per-traveler pricing), the key would be byte-identical to the one
    // that minted the session just expired above. Stripe would replay that
    // CACHED response — the dead, just-expired session — and hard-block the
    // traveler from paying for up to 24 hours. Bounded, not the full joined
    // id list: Stripe caps Idempotency-Key at 255 characters, the base key
    // is already ~90, and each `cs_…` id is ~66 — three or more stale
    // sessions would overflow the cap and Stripe would reject the create
    // outright. Count + one id is enough to change the key deterministically
    // without risking that.
    //
    // NOT durable: this suffix is derived from the live open-session list
    // above, not from any record this function keeps itself. If the expire
    // loop above succeeds but the create call below then fails (network,
    // Stripe outage), the NEXT request sees an empty list, computes an empty
    // suffix, and sends the byte-identical key that minted the session just
    // expired — replaying a dead URL for up to 24 hours. This is the same
    // root cause as the has_more cliff noted above: this function has no
    // durable record of the sessions it has minted. A real
    // operator_checkout_sessions table would close both holes, plus the
    // early-return bypass just fixed above, at once — not something to
    // patch around here.
    const idempotencySuffix =
      staleMatches.length > 0 ? `:after=${staleMatches.length}:${staleMatches[0].id}` : '';

    // ── 5. Destination charge: the operator is paid, our fee is split off.
    //      The idempotency key includes the ledger row count for this
    //      requirement, not just user/requirement/amount: without it, a
    //      pay -> refund -> re-pay at the same amount within Stripe's 24h
    //      idempotency window would replay the CACHED response — the
    //      original, already-completed session, a dead URL the traveler
    //      cannot pay through. The refund adds a ledger row, which changes
    //      the count and forces a fresh key. idempotencySuffix does the same
    //      job for an expired-and-replaced session (see above).
    const idempotencyKey = `checkout:${userId}:${requirementId}:${amountCents}:${(events ?? []).length}${idempotencySuffix}`;
    const session = await stripe(
      'checkout/sessions',
      {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][price_data][product_data][name]': `${trip.title} — ${req_.title}`,
        // Destination charge. Omitted entirely on the test-key platform path:
        // Stripe rejects an empty `transfer_data[destination]`, and a zero
        // `application_fee_amount` without a destination is a 400 as well —
        // both keys have to be absent, not blank.
        ...(routeToOperator
          ? {
              'payment_intent_data[application_fee_amount]': String(commission),
              'payment_intent_data[transfer_data][destination]': host!.stripe_account_id as string,
            }
          : {}),
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
