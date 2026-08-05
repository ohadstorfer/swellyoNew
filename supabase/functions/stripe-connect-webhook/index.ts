// Stripe → Swellyo, for CONNECTED ACCOUNTS. The thing that tells us an
// operator finished verification while nobody was looking at the app.
//
// ── Why this is a SECOND function and not a branch in `stripe-webhook` ──────
// `stripe-webhook` carries a hard rule in its own header: it MUST NOT be
// registered as a Connect endpoint, because a Connect endpoint receives events
// for every connected account, all signed with the SAME secret — so a
// connected operator could forge an event on their own account carrying
// metadata that points at someone else's trip and have it recorded as a real
// payment. It enforces that by rejecting any event with `event.account` set.
//
// `account.updated` for a connected account only ever arrives with
// `event.account` set, so it can only be delivered to a Connect endpoint.
// Putting it in that function would mean registering that function as a
// Connect endpoint and deleting the guard that protects the payment ledger.
//
// So: a separate function, a SEPARATE signing secret, and an attack surface
// that is provably empty — this file never reads a single value out of the
// event body except the account id, and then goes and asks Stripe directly.
// The worst a malicious operator can do by forging an event about their own
// account is make us re-read their own real status from Stripe.
//
// Stripe recommends exactly that, for a different reason:
//   "You can look at the values in the Event object's data.object hash, but we
//    recommend using data.object.id to retrieve the Account object. The Event
//    object's data.object hash contains a snapshot of the Account object at
//    the time the event was created, and those values might have changed."
//   — docs.stripe.com/connect/track-account-onboarding
//
// ── Setup (Stripe dashboard → Developers → Webhooks) ────────────────────────
//   1. Add endpoint → "Events on Connected accounts" (NOT "Events on your
//      account" — that is the other function).
//   2. Listen to: account.updated. Nothing else.
//   3. Put its signing secret in STRIPE_CONNECT_WEBHOOK_SECRET. It is a
//      DIFFERENT secret from STRIPE_WEBHOOK_SECRET; reusing that one silently
//      turns this into a fail-open endpoint for the payment webhook's events.
//   4. Deploy with --no-verify-jwt: Stripe cannot present a Supabase JWT.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_CONNECT_WEBHOOK_SECRET = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')!;

/**
 * Verify Stripe's `t=…,v1=…` signature header.
 *
 * Byte-for-byte the same algorithm as `stripe-webhook`'s, against a different
 * secret. Kept as a copy because these functions deploy independently and this
 * repo has no shared module for them — see the note on readAccountStatus.
 */
async function verify(payload: string, header: string | null): Promise<boolean> {
  if (!header) return false;

  // Every v1 candidate, not just the last: during a signing-secret rotation
  // Stripe sends one v1 per active secret.
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
    new TextEncoder().encode(STRIPE_CONNECT_WEBHOOK_SECRET),
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

  // Constant-time compare: length check plus an XOR fold, so a wrong signature
  // never leaks how many leading bytes were right.
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
 * supabase-js v2's `PostgrestError` is a plain object, not an `Error`
 * subclass, so `e.message` is the only field safe to log — the whole object
 * embeds `.details`, which for a unique violation carries the full key.
 */
function safeMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'unknown error';
}

/** The Stripe fields that decide what an operator is shown about their account. */
type AccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
};

/**
 * ⚠️ DUPLICATED from `stripe-connect-onboard`. Both write the same columns —
 * that one on a poll, this one on a webhook — so they must agree. Change both
 * or neither. The copy exists because these functions deploy one by one and
 * there is no shared module convention in `supabase/functions/`.
 */
function readAccountStatus(acct: Record<string, unknown>): AccountStatus {
  const req = (acct.requirements ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    chargesEnabled: !!acct.charges_enabled,
    payoutsEnabled: !!acct.payouts_enabled,
    detailsSubmitted: !!acct.details_submitted,
    currentlyDue: list(req.currently_due),
    pastDue: list(req.past_due),
    pendingVerification: list(req.pending_verification),
    disabledReason: (req.disabled_reason as string | null) ?? null,
  };
}

/** The same status, shaped for `operator_payout_accounts`. Also duplicated. */
function statusColumns(s: AccountStatus) {
  return {
    charges_enabled: s.chargesEnabled,
    payouts_enabled: s.payoutsEnabled,
    details_submitted: s.detailsSubmitted,
    requirements_due: s.currentlyDue,
    requirements_past_due: s.pastDue,
    disabled_reason: s.disabledReason,
    status_checked_at: new Date().toISOString(),
  };
}

serve(async req => {
  // The signature check fails OPEN if the secret is missing: `Deno.env.get(
  // ...)!` only asserts a type at compile time, and at runtime
  // `TextEncoder().encode(undefined)` produces a ZERO-LENGTH HMAC key that
  // anyone can sign against. Bail before ever calling verify().
  if (!STRIPE_CONNECT_WEBHOOK_SECRET) {
    console.error('[stripe-connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not set');
    return new Response('misconfigured', { status: 500 });
  }
  if (!STRIPE_SECRET_KEY) {
    console.error('[stripe-connect-webhook] STRIPE_SECRET_KEY is not set');
    return new Response('misconfigured', { status: 500 });
  }

  const raw = await req.text();

  if (!(await verify(raw, req.headers.get('stripe-signature')))) {
    console.error('[stripe-connect-webhook] bad signature');
    return new Response('bad signature', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const event = JSON.parse(raw);

    if (event.type !== 'account.updated') {
      // Acknowledged and ignored, so Stripe stops retrying. This endpoint
      // should only be subscribed to account.updated in the first place.
      return new Response('ok');
    }

    // The MIRROR of stripe-webhook's guard: that function refuses events WITH
    // an account, this one refuses events WITHOUT. A platform-account event
    // arriving here means the endpoint was registered as the wrong kind, and
    // an `account.updated` with no account id has nothing to act on anyway.
    const accountId = event.account as string | undefined;
    if (!accountId) {
      console.error('[stripe-connect-webhook] account.updated with no event.account; endpoint must be a CONNECT endpoint');
      return new Response('ok');
    }

    // Ask Stripe rather than believing the payload — see the file header. This
    // is both the anti-forgery property and Stripe's own recommendation, since
    // `data.object` is a snapshot that may already be stale.
    const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) {
      if (res.status === 404) {
        // An account this key cannot see. Realistically: the endpoint and
        // STRIPE_SECRET_KEY belong to different Stripe environments (a sandbox
        // and Test mode are separate, with separate keys AND separate Connect
        // signups). Retrying cannot fix that, but it must be loud, because
        // every operator's status silently stops updating.
        console.error('[stripe-connect-webhook] Stripe 404 for a connected account — is STRIPE_SECRET_KEY on the same account as this endpoint?');
        return new Response('ok');
      }
      // Anything else is transient: 500 so Stripe retries.
      throw new Error(`Stripe accounts fetch failed with ${res.status}`);
    }
    const status = readAccountStatus(await res.json());

    // ── The false → true transition, claimed atomically.
    //
    // `.eq('charges_enabled', false)` is the whole trick: the UPDATE matches at
    // most once, because it also SETS charges_enabled to true. Two events
    // racing (Stripe redelivers, and one account.updated often follows
    // another within seconds) means the second finds no row and sends no
    // second push. Reading the row and then writing it would not be safe here.
    if (status.chargesEnabled) {
      const { data: claimed, error: claimErr } = await supabase
        .from('operator_payout_accounts')
        .update(statusColumns(status))
        .eq('stripe_account_id', accountId)
        .eq('charges_enabled', false)
        .select('user_id');
      if (claimErr) throw claimErr;

      if (claimed && claimed.length > 0) {
        const userId = claimed[0].user_id as string;

        // Feed row + push, via the same path as every other notification: the
        // insert fires tg_enqueue_push, which respects quiet hours for this
        // priority. Nothing here talks to Expo directly.
        //
        // entity_id = the operator's own id, so the queue's dedup_key is
        // stable ("<user>:operator_stripe_ready:<user>") instead of falling
        // back to the notification's own row id, which is unique per insert
        // and would therefore dedupe nothing.
        //
        // NON-FATAL on purpose: the status is already saved, which is the part
        // that unblocks the operator in the app. A failed notification must
        // never 500 this request and make Stripe redeliver an event whose only
        // remaining effect would be a duplicate push.
        const { error: notifyErr } = await supabase.from('notifications').insert({
          recipient_id: userId,
          trip_id: null,
          type: 'operator_stripe_ready',
          audience: 'user',
          entity_type: 'payout_account',
          entity_id: userId,
          data: {},
        });
        if (notifyErr) {
          console.error('[stripe-connect-webhook] status saved but notification failed', safeMessage(notifyErr));
        }
        return new Response('ok');
      }
      // Fell through: charges were already true. Still refresh the rest below —
      // requirements can change on an account that is live (a future deadline,
      // a document that expired).
    }

    // Every other case: a plain refresh. No row matching this account id is
    // normal and not an error — an operator can exist in Stripe while their
    // row was never written (see the persist failure branch in
    // stripe-connect-onboard), and this endpoint sees every connected account.
    const { error: refreshErr } = await supabase
      .from('operator_payout_accounts')
      .update(statusColumns(status))
      .eq('stripe_account_id', accountId);
    if (refreshErr) throw refreshErr;

    return new Response('ok');
  } catch (e) {
    console.error('[stripe-connect-webhook]', safeMessage(e));
    // 500 so Stripe retries. Nothing here writes money, so a retry is cheap;
    // the cost of giving up is an operator whose card never stops saying
    // "Stripe is checking your details".
    return new Response('error', { status: 500 });
  }
});
