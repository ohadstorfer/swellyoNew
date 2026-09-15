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
 * `label`, when given, replaces `path` in the thrown error's message.
 * `stripeGet`'s default error embeds the full request path — including
 * whatever id it was fetching (e.g. `payment_intents/pi_…`) — which is meant
 * to be caught by a caller that already knows the id, not logged. A caller
 * that logs the error on failure (see the application_fee_usd enrichment
 * below) should pass a redacted label instead.
 */
async function stripeGet(path: string, label = path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe ${label} failed`);
  return res.json();
}

/** POST to Stripe. Same redacted-label contract as stripeGet. */
async function stripePost(path: string, params: Record<string, string>, label = path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`Stripe ${label} failed`);
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
//
// Deliberately does NOT include a Stripe-side status like "404 from
// stripeGet". A prior version of this file treated any Stripe 404 as
// permanent, which was right for enrichment lookups but wrong for the
// refund path below, where the PaymentIntent fetch supplies the metadata
// the row cannot be built without — a 404 there means a lost, unrecoverable
// refund if swallowed as "ok". The realistic trigger for a Stripe 404 here
// is STRIPE_SECRET_KEY pointing at the wrong mode/account, in which case
// EVERY lookup 404s; that needs to keep 500-retrying for the ~3 days Stripe
// allows, because that retry window is the only signal a human gets to
// notice and fix the key.
//
// I6 (round 5): '23503' (foreign key violation) was in this set and has been
// removed. It is NOT safe to acknowledge. By the time this insert runs the
// money has already moved on Stripe's side; a 200 here tells Stripe to stop
// retrying, and the ledger row that records the payment is never written.
// Nothing else ever writes it, so that payment is unrecoverable — the
// traveler is charged, `operator_requirement_pay_state` still reads
// `not_started`, and they get asked to pay again. The FK targets are also
// exactly the things a concurrent operator action can transiently remove or
// recreate (a requirement row, a payout account), so "can never succeed on
// retry" was not even true of it.
//
// The cost of getting this wrong the other way is bounded and deliberate: a
// genuinely deleted trip now 500-loops for the ~3 days Stripe retries. That
// is the same alerting mechanism the 23505 branch further down already
// relies on ("that retry storm is DELIBERATE here") — a noisy retry storm a
// human notices, rather than a silent loss of money nobody ever sees.
const PERMANENT_PG_ERROR_CODES = new Set([
  '23514', // check violation — the row can never satisfy the constraint
  '22P02', // invalid text representation — e.g. a non-UUID trip_id in metadata
  '23502', // not null violation
]);

/**
 * PAY-6: write an `operator_payment_stuck` notification for a payment that
 * did not finish. Called for `payment_intent.payment_failed` (metadata lives
 * on the PaymentIntent — payments-checkout sets it via
 * `payment_intent_data[metadata]`) and `checkout.session.expired` (metadata
 * lives on the session itself).
 *
 * Every guard here exists to NOT send:
 *
 *  - An expired session with an open replacement is payments-checkout's own
 *    doing — it deliberately expires stale-priced sessions and mints a fresh
 *    one in the same request (price edits, dedup). The traveler is mid-
 *    checkout, not stuck; "your payment did not go through" would be a lie.
 *  - A payment that arrived AFTER the failure (retried the declined card and
 *    it worked, or paid through a newer session) means nothing is stuck.
 *  - A cancelled or already-departed trip is past chasing — the plan's global
 *    stop rule ("trip started · cancelled · person removed").
 *  - A deleted requirement has nothing left to pay.
 *  - One nudge per requirement per 24h, matching the Remind button's cooldown.
 *
 * Throws are the caller's problem — it logs and acknowledges (best-effort).
 */
async function notifyPaymentStuck(
  supabase: ReturnType<typeof createClient>,
  event: { type: string; id: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  const expired = event.type === 'checkout.session.expired';
  const obj = event.data.object as {
    created?: number;
    metadata?: Record<string, string>;
  };
  const m = obj.metadata ?? {};
  const tripId = m.trip_id;
  const userId = m.user_id;
  const requirementId = m.requirement_id;
  if (!tripId || !userId || !requirementId) {
    // Not one of ours (or pre-metadata) — permanent, nothing to notify.
    return;
  }

  if (expired) {
    // Replacement-session check. Same list-then-filter technique (and the
    // same platform-wide ~100-open-sessions limit) as payments-checkout's
    // dedup — past that page this guard can miss and the worst case is one
    // spurious reminder, not money.
    const open = await stripeGet('checkout/sessions?status=open&limit=100');
    const stillOpen = (open.data ?? []).some(
      (sess: { metadata?: Record<string, string> }) =>
        sess.metadata?.trip_id === tripId &&
        sess.metadata?.user_id === userId &&
        sess.metadata?.requirement_id === requirementId,
    );
    if (stillOpen) return;
  }

  // Paid-meanwhile: any 'paid' ledger row for this traveler+requirement newer
  // than the failed attempt means the money got through another way.
  const objCreatedIso = obj.created
    ? new Date(Number(obj.created) * 1000).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: paidSince, error: paidErr } = await supabase
    .from('organized_trip_payment_events')
    .select('id')
    .eq('user_id', userId)
    .eq('requirement_id', requirementId)
    .eq('event_type', 'paid')
    .gte('created_at', objCreatedIso)
    .limit(1);
  if (paidErr) throw paidErr;
  if (paidSince && paidSince.length > 0) return;

  // The requirement must still exist and the trip must still be worth paying
  // for. `maybeSingle` on the requirement: a deleted row is a skip, not an
  // error.
  const { data: req, error: reqErr } = await supabase
    .from('organized_trip_requirements')
    .select('id')
    .eq('id', requirementId)
    .maybeSingle();
  if (reqErr) throw reqErr;
  if (!req) return;

  const { data: trip, error: tripErr } = await supabase
    .from('group_trips')
    .select('status, start_date')
    .eq('id', tripId)
    .maybeSingle();
  if (tripErr) throw tripErr;
  if (!trip) return;
  if (trip.status === 'cancelled') return;
  if (trip.start_date && String(trip.start_date) <= new Date().toISOString().slice(0, 10)) return;

  // Cooldown: one per requirement per 24h, whichever event got there first.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await supabase
    .from('notifications')
    .select('id')
    .eq('recipient_id', userId)
    .eq('type', 'operator_payment_stuck')
    .eq('entity_id', requirementId)
    .gte('created_at', dayAgo)
    .limit(1);
  if (recentErr) throw recentErr;
  if (recent && recent.length > 0) return;

  const { error: insErr } = await supabase.from('notifications').insert({
    recipient_id: userId,
    trip_id: tripId,
    type: 'operator_payment_stuck',
    audience: 'user',
    entity_type: 'requirement',
    // entity_id = the requirement, so the queue's dedup_key collapses a
    // decline and a later expiry of the same attempt into one push.
    entity_id: requirementId,
    // 'bank_returned' is the ACH bounce (async_payment_failed): the bank said
    // no three days after the traveler thought they were done. The client's
    // bell copy names it — "your bank said no" — because a traveler who paid
    // by bank account and reads "your card was declined" will not believe the
    // message is about them.
    data: {
      reason:
        event.type === 'checkout.session.async_payment_failed'
          ? 'bank_returned'
          : expired
            ? 'checkout_abandoned'
            : 'card_declined',
    },
  });
  if (insErr) throw insErr;
}

/**
 * ACH (docs/specs/operator-trips/ach-bank-payments.md): tell the traveler
 * their bank payment ARRIVED. Called for `checkout.session.async_payment_succeeded`
 * only — a card confirms while they are watching, so it has nothing to say.
 *
 * This is the one the traveler has been waiting three days for, and the row
 * has said "on its way" the whole time. Stripe's own guidance for delayed
 * payment methods is to tell the customer at this point; the bounce already
 * does, and a flow that only ever speaks up for bad news teaches people to
 * dread the notification.
 *
 * Same best-effort contract as notifyPaymentStuck: throws are the caller's,
 * a lost notification costs a heads-up, never money. No cooldown — this fires
 * once per ledger row, and the 23505 exit upstream already stops redelivery.
 */
async function notifyPaymentLanded(
  supabase: ReturnType<typeof createClient>,
  args: { tripId: string; userId: string; requirementId: string; amountUsd: number },
): Promise<void> {
  const { tripId, userId, requirementId, amountUsd } = args;

  const { data: req, error: reqErr } = await supabase
    .from('organized_trip_requirements')
    .select('id, title, kind')
    .eq('id', requirementId)
    .maybeSingle();
  if (reqErr) throw reqErr;
  if (!req) return;

  // A cancelled trip is refunding, not celebrating. A "your deposit arrived 🎉"
  // there would be the wrong message — but SILENCE was worse: the trip was
  // cancelled while this bank payment was still clearing, the money has now
  // landed anyway, and nobody was told. So the cancelled branch aims the same
  // notification type at the OPERATOR instead, flagged so both renderers
  // switch the copy to "refund it". Their refund button is the whole fix.
  const { data: trip, error: tripErr } = await supabase
    .from('group_trips')
    .select('status, host_id')
    .eq('id', tripId)
    .maybeSingle();
  if (tripErr) throw tripErr;
  if (!trip) return;
  if (trip.status === 'cancelled') {
    if (!trip.host_id) return;
    const recipients = await operatorRecipients(supabase, tripId, trip.host_id);
    if (recipients.length === 0) return;
    const { error: opErr } = await supabase.from('notifications').insert(
      recipients.map(rid => ({
        recipient_id: rid,
        trip_id: tripId,
        type: 'operator_payment_landed',
        // Same audience as the dispute notifications — this is operator-facing.
        audience: 'admin',
        entity_type: 'requirement',
        entity_id: requirementId,
        data: {
          amount_usd: amountUsd,
          item_name: req.title ?? (req.kind === 'deposit' ? 'Deposit' : 'Payment'),
          on_cancelled_trip: true,
        },
      })),
    );
    if (opErr) throw opErr;
    return;
  }

  const { error: insErr } = await supabase.from('notifications').insert({
    recipient_id: userId,
    trip_id: tripId,
    type: 'operator_payment_landed',
    audience: 'user',
    entity_type: 'requirement',
    entity_id: requirementId,
    data: {
      amount_usd: amountUsd,
      // The requirement's own title ("Deposit", "Final payment"), so the copy
      // can name the step rather than say "your payment".
      item_name: req.title ?? (req.kind === 'deposit' ? 'Deposit' : 'Payment'),
    },
  });
  if (insErr) throw insErr;
}

/** "Aug 31" — same shape scan-requirement-deadlines uses for due_date_label. */
function disputeDueLabel(dueBy: unknown): string | null {
  const n = Number(dueBy);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return null;
  }
}

/**
 * Phase 3 (refunds-and-merchant-of-record.md): tell the operator about a
 * dispute. Recipient is the operator of record — group_trips.host_id, the
 * same two-hop identity payments-checkout routes the money by. audience
 * 'admin' + entity = the requirement, matching the
 * operator_requirement_overdue_operator digest, the closest trip-scoped
 * operator-facing precedent.
 *
 * Throws are the caller's problem — every call site wraps this best-effort:
 * a lost notification costs a heads-up, never money or a retry storm.
 */
async function notifyDisputeToOperator(
  supabase: ReturnType<typeof createClient>,
  tripId: string,
  requirementId: string,
  type: 'operator_charge_disputed' | 'operator_dispute_closed',
  data: Record<string, unknown>,
): Promise<void> {
  const { data: trip, error: tripErr } = await supabase
    .from('group_trips')
    .select('host_id, title')
    .eq('id', tripId)
    .maybeSingle();
  if (tripErr) throw tripErr;
  if (!trip?.host_id) return;

  // Redelivery guard for the one path with no ledger insert to dedup on
  // (a dispute closed 'won' writes no row). dispute_id is unique per case,
  // so one notification per (case, outcome) no matter how often Stripe
  // resends the event.
  //
  // Still keyed on host_id alone even though the insert below fans out: the
  // whole batch is written in one statement, so the operator's row exists if
  // and only if every co-operator's does. Checking one is checking all — and
  // it stays correct when a co-operator is appointed between two redeliveries,
  // where a count-based guard would resend to everybody.
  const { data: dup, error: dupErr } = await supabase
    .from('notifications')
    .select('id')
    .eq('recipient_id', trip.host_id)
    .eq('type', type)
    .eq('data->>dispute_id', String(data.dispute_id ?? ''))
    .eq('data->>outcome', String(data.outcome ?? ''))
    .limit(1);
  if (dupErr) throw dupErr;
  if (dup && dup.length > 0) return;

  const recipients = await operatorRecipients(supabase, tripId, trip.host_id);
  if (recipients.length === 0) return;

  const { error: insErr } = await supabase.from('notifications').insert(
    recipients.map(rid => ({
      recipient_id: rid,
      trip_id: tripId,
      type,
      audience: 'admin',
      entity_type: 'requirement',
      entity_id: requirementId,
      data: { trip_title: trip.title, ...data },
    })),
  );
  if (insErr) throw insErr;
}

/**
 * A dispute was LOST: pull the money back from the operator with a transfer
 * reversal. Phase 3 step 3, and the spec's one hard rule lives here: reverse
 * ONLY on the loss, never on `created` — for a cross-border charge, Stripe
 * warns you may be unable to transfer the money back if the dispute is won.
 *
 * Idempotent by inspection, not by Stripe idempotency keys (whose 24h window
 * is shorter than Stripe's ~3-day retry schedule): a reversal this function
 * created carries the dispute id in its metadata, so a redelivered event
 * finds it and does nothing.
 *
 * Throws → the caller 500s → Stripe retries. A failed recovery must never be
 * acknowledged away; this is money, not a notification.
 */
async function reverseTransferForLostDispute(dispute: {
  id: string;
  charge?: string;
  amount: number;
}): Promise<void> {
  if (!dispute.charge) {
    console.error('[stripe-webhook] lost dispute carries no charge id — nothing to reverse');
    return;
  }
  const c = await stripeGet(`charges/${dispute.charge}`, 'charges/<redacted>');
  if (!c.transfer) {
    // Platform-lane payment: nothing was transferred to an operator, so there
    // is nothing to pull back. Swellyo eats this one — expected, per the spec.
    console.error('[stripe-webhook] lost dispute on a platform-lane charge — no transfer to reverse');
    return;
  }

  const transferId = String(c.transfer);
  const t = await stripeGet(`transfers/${transferId}`, 'transfers/<redacted>');

  const existing = await stripeGet(
    `transfers/${transferId}/reversals?limit=100`,
    'transfers/<redacted>/reversals',
  );
  const alreadyDone = (existing.data ?? []).some(
    (r: { metadata?: Record<string, string> }) => r.metadata?.dispute_id === dispute.id,
  );
  if (alreadyDone) return;

  // A reversal can never exceed what is left on the transfer — a partial
  // refund (refunds reverse proportionally) may have shrunk it already. The
  // dispute is the full charge; the transfer was the charge minus our
  // commission, so the cap is the normal case, not the edge case: we recover
  // the operator's share and eat our own.
  const reversible = Number(t.amount) - Number(t.amount_reversed ?? 0);
  const amount = Math.min(Number(dispute.amount), reversible);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('[stripe-webhook] lost dispute: transfer already fully reversed, nothing to recover');
    return;
  }

  await stripePost(
    `transfers/${transferId}/reversals`,
    { amount: String(amount), 'metadata[dispute_id]': dispute.id },
    'transfers/<redacted>/reversals',
  );
}

/**
 * Everyone who runs this trip: the operator of record, plus any co-operator
 * they appointed (20260901000000_co_operator_role.sql).
 *
 * A co-operator holds `money.manage` — they can issue the refund an alert is
 * asking for — so an alert only the creator receives is a power granted to
 * someone who is never told to use it.
 *
 * Falls back to host_id alone if the RPC fails. Being told once is a smaller
 * problem than not being told at all, and this runs inside webhook and cron
 * paths that must not throw over a fan-out.
 */
async function operatorRecipients(
  supabase: ReturnType<typeof createClient>,
  tripId: string,
  hostId: string | null,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('trip_operator_ids', { p_trip_id: tripId });
  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) console.error('[operatorRecipients] falling back to host_id:', error.message);
    return hostId ? [hostId] : [];
  }
  return (data as string[]).filter(Boolean);
}

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
    // Runs once, after the ledger row is INSERTED for the first time — a
    // redelivery takes the 23505 → "genuine redelivery" exit above it and
    // never gets here, which is what makes a notification-per-event safe.
    // Best-effort: a throw is logged, never retried (same contract as PAY-6).
    let afterInsert: (() => Promise<void>) | null = null;

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const s = event.data.object;

      // A session can complete without the money actually arriving, and for a
      // BANK payment that is the normal case rather than an anomaly:
      //
      //   card  → completed(payment_status='paid')                 … done
      //   ACH   → completed(payment_status='processing')           … day 0
      //           async_payment_succeeded | async_payment_failed   … day ~3
      //
      // 'processing' therefore writes a zero-amount marker row instead of
      // being dropped. That row is what payments-checkout reads to refuse a
      // SECOND session while the first payment is still clearing — without it
      // the traveler is invited to pay again 30 minutes into a 3-day wait.
      // See docs/specs/operator-trips/ach-bank-payments.md.
      //
      // async_payment_succeeded carries no payment_status of its own worth
      // gating on — the event's existence IS the confirmation — so only the
      // 'completed' shape is filtered here.
      const inFlight =
        event.type === 'checkout.session.completed' && s.payment_status === 'processing';
      if (event.type === 'checkout.session.completed' && !inFlight && s.payment_status !== 'paid') {
        // Not silent any more. On 27 Aug 2026 a microdeposit-verified ACH
        // attempt completed Checkout with a status that landed here, was
        // dropped without a word, and failed 20 seconds later — the only
        // evidence was three bare "booted" lines. payments-checkout now forces
        // instant verification so this should not recur for bank payments;
        // if it does, the status and event id are the whole diagnosis.
        console.error(
          '[stripe-webhook] completed session with no money to record, ignoring',
          String(s.payment_status),
          String(s.status),
          event.id,
        );
        return new Response('ok');
      }

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
      //
      // This is deliberately NON-FATAL: application_fee_usd is optional and
      // nullable, and this lookup must never be able to block recording that
      // the money actually arrived. If it fails — most realistically because
      // STRIPE_SECRET_KEY points at the wrong mode/account, in which case
      // this 404s on every single event — the row still gets written with a
      // null fee instead of the traveler's payment silently never being
      // recorded at all (with no Stripe redelivery to ever recover it, since
      // the outer handler would have returned 200).
      let applicationFeeUsd: number | null = null;
      // Who was the merchant of record for this charge. Read from Stripe's own
      // record of the PaymentIntent rather than from our metadata, because a
      // dispute two years from now is answered by what Stripe says the charge
      // was, not by what we claim we sent.
      //
      // NULL when the fetch below fails — that means UNKNOWN, not 'platform'.
      // The column's CHECK allows null for exactly this case. Guessing
      // 'platform' here would put a wrong seller on a row that a chargeback
      // response might one day quote.
      let settlementMerchant: 'platform' | 'operator' | null = null;
      // Skipped for the in-flight marker. It carries no money, so there is no
      // fee to reconcile and no seller to pin down — and the 'paid' row that
      // lands on day 3 carries both, read from the same PaymentIntent once it
      // has actually settled. Saves an API call on every bank checkout.
      if (!inFlight) {
        try {
          // Redacted label: this catch logs on failure, and safeMessage(feeErr)
          // would otherwise read back `Stripe payment_intents/pi_… failed` —
          // exactly the identifier safeMessage exists to keep out of logs. If
          // STRIPE_SECRET_KEY is pointing at the wrong mode/account (the
          // current pre-deploy state), this fires on EVERY event, so it isn't
          // a one-off.
          const pi = await stripeGet(`payment_intents/${s.payment_intent}`, 'payment_intents/<redacted>');
          applicationFeeUsd =
            pi.application_fee_amount != null ? Number(pi.application_fee_amount) / 100 : null;
          settlementMerchant = pi.on_behalf_of ? 'operator' : 'platform';
        } catch (feeErr) {
          console.error(
            '[stripe-webhook] could not enrich application_fee_usd / settlement_merchant, recording the payment without them',
            safeMessage(feeErr),
          );
        }
      }

      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: s.payment_intent,
        event_type: inFlight ? 'processing' : 'paid',
        // ⚠️ The two amounts diverge on an in-flight row, and the split is the
        // point. `amount_usd` is what every money total sums, so a payment
        // that has not arrived must contribute exactly 0 — the migration's
        // CHECK pins it there. `amount_charged` is a record of what was
        // AUTHORISED, not a total, so it keeps the real figure and lets the
        // UI say "your $6,250 bank payment is on its way" instead of "$0".
        amount_usd: inFlight ? 0 : Number(s.amount_total) / 100,
        amount_charged: Number(s.amount_total) / 100,
        currency_charged: currency.toUpperCase(),
        application_fee_usd: applicationFeeUsd,
        settlement_merchant: settlementMerchant,
        // Stripe test-mode events must never be mistaken for real money.
        is_livemode: !!event.livemode,
      };

      // Only the delayed path speaks up. A card confirms while the traveler
      // is watching the screen; a bank payment lands three days after they
      // stopped looking, and the row has said "on its way" the whole time.
      // Runs only if the row is genuinely new (redelivery exits on 23505
      // before afterInsert), so it fires once per payment.
      if (event.type === 'checkout.session.async_payment_succeeded') {
        const landed = {
          tripId: String(m.trip_id ?? ''),
          userId: String(m.user_id ?? ''),
          requirementId: String(m.requirement_id ?? ''),
          amountUsd: Number(s.amount_total) / 100,
        };
        afterInsert = () => notifyPaymentLanded(supabase, landed);
      }
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

      // A charge carries no metadata of ours — the PaymentIntent does. Unlike
      // the enrichment fetch above, this one is NOT optional: without it
      // there is no trip_id/user_id/requirement_id to build the row from, so
      // a failure here (including a 404) is left to throw and 500 — a lost
      // refund row is exactly as unrecoverable as a lost paid row.
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
        // application_fee_usd intentionally left out here. This is a KNOWN,
        // DEFERRED reconciliation gap, not a Stripe limitation: for a
        // destination charge, the application_fee object carries a
        // cumulative amount_refunded too, readable via
        // GET /v1/application_fees/{id} — the object id is on the CHARGE as
        // `c.application_fee` (already available above; the PaymentIntent
        // only carries application_fee_amount, not the fee object's id).
        // The same integer-cents delta technique used above for amount_usd
        // would apply to it. Deferred because nothing in this codebase
        // issues refunds yet.
        //
        // What "deferred" actually costs: `refund_application_fee` defaults
        // to FALSE, so on an ordinary refund the platform keeps the fee and
        // the application_fee_usd already recorded on the 'paid' row stays
        // correct — sum(application_fee_usd) is NOT overstated by a plain
        // refund. It is only overstated when the fee was actually reversed
        // (refund created with refund_application_fee: true), and for a
        // partial refund the reversal is proportional, so the error is
        // bounded by the reversed portion, not the whole fee.
      };
    } else if (event.type === 'checkout.session.async_payment_failed') {
      // A bank payment that bounced, three days after the traveler thought
      // they were done. Two things have to happen, in this order of
      // importance:
      //
      //   1. RESOLVE THE MARKER. The 'processing' row written on day 0 is what
      //      payments-checkout reads to refuse a second session while money is
      //      in flight. A bounce that left it unresolved would block that
      //      requirement FOREVER — the traveler could never pay again, which
      //      is a far worse outcome than the bounce itself. The 'failed' row
      //      shares the marker's provider_object_id (the PaymentIntent), and
      //      that shared id is exactly what the guard matches on.
      //   2. Tell them, through the same PAY-6 path a declined card takes.
      //
      // ⚠️ This is the ONLY place in the codebase that writes a 'failed' row.
      // Card declines and expired sessions notify WITHOUT one (see the branch
      // below), because no marker was ever written for them and an
      // append-only ledger gains nothing from recording a non-event. Here the
      // row is load-bearing: it is the resolution, not the record.
      const s = event.data.object;
      const m = s.metadata ?? {};

      if (!s.payment_intent) {
        // Without the PaymentIntent there is no way to tie this back to the
        // marker, so the guard would stay stuck. Loud, and permanent —
        // retrying cannot conjure the id.
        console.error('[stripe-webhook] async payment failure has no payment_intent', event.id);
        return new Response('ok');
      }

      row = {
        trip_id: m.trip_id,
        user_id: m.user_id,
        requirement_id: m.requirement_id,
        provider: 'stripe',
        provider_event_id: event.id,
        provider_object_id: s.payment_intent,
        event_type: 'failed',
        // Pinned to 0 by otpe_amount_sign_matches_type. amount_charged keeps
        // what was attempted, for the same reason the marker row does: it is
        // a record, not a total.
        amount_usd: 0,
        amount_charged: s.amount_total != null ? Number(s.amount_total) / 100 : null,
        currency_charged: String(s.currency ?? '').toUpperCase() || null,
        is_livemode: !!event.livemode,
      };

      // Only if the row is genuinely new — a Stripe redelivery takes the
      // 23505 exit before this runs, so the traveler is told once.
      afterInsert = () => notifyPaymentStuck(supabase, event);
    } else if (
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'checkout.session.expired'
    ) {
      // PAY-6 (docs/trip-notifications-plan.html): a payment that did not
      // finish tells the traveler, instead of telling nobody. Two shapes of
      // "did not finish": the card was declined (they watched it happen), and
      // the checkout was opened and abandoned (Stripe expires it after ~24h).
      //
      // Best-effort BY DESIGN — always acknowledged, never 500. A notification
      // is not a ledger row: losing one costs a reminder, while a retry storm
      // over one costs three days of noise (and until the
      // `operator_payment_stuck` migrations are applied, the insert fails on
      // the unknown enum value — that must not loop). This also means these
      // events can be subscribed in the Stripe dashboard before or after the
      // migrations land, in either order, safely.
      try {
        await notifyPaymentStuck(supabase, event);
      } catch (e) {
        console.error('[stripe-webhook] payment-stuck notify failed (best-effort, not retrying)', safeMessage(e));
      }
      return new Response('ok');
    } else if (
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.closed'
    ) {
      // Phase 3 (refunds-and-merchant-of-record.md): a chargeback stops being
      // invisible. `created` writes a 0-amount 'disputed' marker and tells the
      // operator while there is still time to fight it — the evidence clock is
      // days. `closed` splits on the outcome: 'lost' recovers the operator's
      // share with a transfer reversal, then writes the negative
      // 'dispute_lost' row that lets every money total self-correct; 'won'
      // moved no money net, so it writes nothing and just tells the operator.
      const d = event.data.object as {
        id: string;
        charge?: string;
        payment_intent?: string;
        amount: number;
        currency?: string;
        reason?: string;
        status?: string;
        evidence_details?: { due_by?: number };
      };

      if (!d.payment_intent) {
        console.error('[stripe-webhook] dispute has no payment_intent', event.id);
        return new Response('ok'); // permanent — nothing to look up
      }

      const currency = String(d.currency ?? '').toLowerCase();
      if (currency !== 'usd') {
        console.error(
          '[stripe-webhook] unsupported currency, refusing to write',
          currency,
          event.id,
        );
        return new Response('ok');
      }

      // The PaymentIntent carries our metadata. NOT optional, same as the
      // refund path: without it there is no row to build, and a lost dispute
      // row is exactly as unrecoverable as a lost refund row — throw and 500
      // so Stripe retries.
      const pi = await stripeGet(`payment_intents/${d.payment_intent}`);
      const m = pi.metadata ?? {};
      const amountUsd = Number(d.amount) / 100;

      const status = String(d.status ?? '');
      const closed = event.type === 'charge.dispute.closed';

      if (!closed) {
        row = {
          trip_id: m.trip_id,
          user_id: m.user_id,
          requirement_id: m.requirement_id,
          provider: 'stripe',
          provider_event_id: event.id,
          provider_object_id: d.payment_intent,
          event_type: 'disputed',
          // 0 by design (and by CHECK): the outcome is not known yet, and a
          // won dispute returns the money — no total may move on this row.
          amount_usd: 0,
          amount_charged: 0,
          currency_charged: currency.toUpperCase(),
          is_livemode: !!event.livemode,
        };
        afterInsert = () =>
          notifyDisputeToOperator(supabase, String(m.trip_id), String(m.requirement_id), 'operator_charge_disputed', {
            dispute_id: d.id,
            amount_usd: amountUsd,
            reason: d.reason ?? null,
            evidence_due_label: disputeDueLabel(d.evidence_details?.due_by),
          });
      } else if (status === 'lost') {
        // Recovery FIRST, ledger second. If the reversal throws, the 500
        // makes Stripe retry the whole event; nothing has been written yet,
        // so the retry re-runs both halves, and the reversal's own
        // metadata-based idempotency keeps it single.
        await reverseTransferForLostDispute(d);

        row = {
          trip_id: m.trip_id,
          user_id: m.user_id,
          requirement_id: m.requirement_id,
          provider: 'stripe',
          provider_event_id: event.id,
          provider_object_id: d.payment_intent,
          event_type: 'dispute_lost',
          // Negative, like 'refunded': the traveler's bank took the money
          // back, so their balance is once again a plain sum().
          amount_usd: -amountUsd,
          amount_charged: -amountUsd,
          currency_charged: currency.toUpperCase(),
          is_livemode: !!event.livemode,
        };
        afterInsert = () =>
          notifyDisputeToOperator(supabase, String(m.trip_id), String(m.requirement_id), 'operator_dispute_closed', {
            dispute_id: d.id,
            amount_usd: amountUsd,
            outcome: 'lost',
          });
      } else if (status === 'won') {
        // No ledger row — nothing moved net. The notify helper carries its
        // own dispute_id dedup, since there is no insert to dedup on here.
        if (m.trip_id && m.requirement_id) {
          try {
            await notifyDisputeToOperator(supabase, String(m.trip_id), String(m.requirement_id), 'operator_dispute_closed', {
              dispute_id: d.id,
              amount_usd: amountUsd,
              outcome: 'won',
            });
          } catch (e) {
            console.error('[stripe-webhook] dispute-won notify failed (best-effort, not retrying)', safeMessage(e));
          }
        }
        return new Response('ok');
      } else {
        // 'warning_closed' — an inquiry that closed without ever becoming a
        // real chargeback. No money moved, nothing to say.
        console.error('[stripe-webhook] dispute closed without an outcome, ignoring', status, event.id);
        return new Response('ok');
      }
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
        // Otherwise: the other collision, or the lookup itself failed — fall
        // through and throw below. That 500s and Stripe retries this event
        // on its normal backoff schedule for ~3 days; that retry storm is
        // DELIBERATE here, not an oversight — it is the alerting mechanism
        // for a genuine uq_otpe_object collision, which should never happen
        // in normal operation and needs a human to look at it.
      }
      throw error;
    }

    if (afterInsert) {
      try {
        await afterInsert();
      } catch (e) {
        console.error('[stripe-webhook] post-insert notify failed (best-effort, not retrying)', safeMessage(e));
      }
    }

    return new Response('ok');
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code && PERMANENT_PG_ERROR_CODES.has(code)) {
      // Retrying cannot fix a constraint violation. Acknowledge so Stripe
      // stops, but log loudly so a human notices instead of it going quiet.
      console.error('[stripe-webhook] permanent failure, not retrying', code, safeMessage(e));
      return new Response('ok');
    }
    console.error('[stripe-webhook]', safeMessage(e));
    // 500 so Stripe retries — better a duplicate attempt than a lost payment.
    return new Response('error', { status: 500 });
  }
});
