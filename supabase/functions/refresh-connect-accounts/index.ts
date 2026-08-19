// ⚠️ MANUAL DEPLOY (CLI). Daily cron.
//
// Re-reads every operator's Stripe account and writes it back to
// `operator_payout_accounts`. It sends nothing itself — the trigger added in
// 20260818000600 turns any material change into a notification, so this
// function's whole job is to make sure somebody looks.
//
// ── Why it exists ───────────────────────────────────────────────────────────
// Until now, exactly two things could notice that an operator's Stripe account
// had broken:
//
//   1. `stripe-connect-webhook`, if the "Events on Connected accounts"
//      destination is still registered in the Stripe dashboard, and
//   2. the operator opening a screen that polls `stripe-connect-onboard`.
//
// (2) is the operator discovering it themselves, which is not a notification
// system. And (1) has already failed silently on this project — twice. The
// platform webhook destination vanished from the Stripe sandbox and payments
// went unrecorded for six days in August; a later deploy appears to have
// flipped `verify_jwt` back on and did it again. Both times the symptom was
// zero invocations, i.e. nothing to see in any log we own.
//
// A poll cannot fail that way. If Stripe is reachable and the key is right,
// this runs; if it is not, the run errors loudly in a place we do watch. It
// makes the webhook an optimisation for latency (seconds instead of a day)
// rather than the only path.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

/**
 * How many accounts one run will touch, oldest-checked first.
 *
 * A cap rather than "all of them" because this is one HTTP call to Stripe per
 * account inside a function with a wall-clock limit — without it, growth turns
 * a working job into one that times out halfway and leaves the tail permanently
 * unchecked, silently. With it, the tail is merely a day behind and the log
 * says so.
 */
const MAX_PER_RUN = 400;
/** Concurrent Stripe reads. Small on purpose: this is a background sweep with a
 *  whole day to finish, and there is nothing to gain by spending rate limit. */
const CONCURRENCY = 5;

/** The Stripe fields that decide what an operator is shown about their account. */
type AccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  country: string | null;
  defaultCurrency: string | null;
};

/**
 * ⚠️ DUPLICATED from `stripe-connect-webhook` and `stripe-connect-onboard`.
 * All three write the same columns and must agree — change all three or none.
 * The copies exist because these functions deploy one by one and there is no
 * shared-module convention in `supabase/functions/`.
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
    country: acct.country ? String(acct.country).toUpperCase() : null,
    defaultCurrency: acct.default_currency ? String(acct.default_currency).toLowerCase() : null,
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
    // ⚠️ Written only when Stripe actually told us — overwriting a known
    // country with null would lose a fact we already had.
    ...(s.country ? { country: s.country } : {}),
    ...(s.defaultCurrency ? { default_currency: s.defaultCurrency } : {}),
    status_checked_at: new Date().toISOString(),
  };
}

function safeMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "unknown error";
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);

  // Same gate as every other cron function here: the internal secret, or a
  // service-role bearer.
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("ADMIN_FUNCTION_SECRET") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const bearerOk = SERVICE.length > 0 && authHeader === `Bearer ${SERVICE}`;
  if (!(expected.length > 0 && provided === expected) && !bearerOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!STRIPE_SECRET_KEY) {
    console.error(`[refresh-connect ${reqId}] STRIPE_SECRET_KEY is not set`);
    return new Response(JSON.stringify({ error: "misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Oldest-checked first, so a run that hits MAX_PER_RUN still makes progress
  // through the whole set instead of re-reading the same head every day.
  // `nullsFirst` puts accounts we have never checked at the very front.
  const { data: rows, error: listErr } = await supabase
    .from("operator_payout_accounts")
    .select("user_id, stripe_account_id")
    .not("stripe_account_id", "is", null)
    .order("status_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);

  if (listErr) {
    console.error(`[refresh-connect ${reqId}] account query failed`, listErr.message);
    return new Response(JSON.stringify({ error: "account query failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accounts = rows ?? [];
  let refreshed = 0;
  let missing = 0;   // Stripe does not know this account (see below)
  let failed = 0;

  async function refreshOne(row: { user_id: string; stripe_account_id: string }) {
    try {
      const res = await fetch(`https://api.stripe.com/v1/accounts/${row.stripe_account_id}`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });

      if (res.status === 404) {
        // An account this key cannot see. Realistically: STRIPE_SECRET_KEY and
        // the stored account id belong to different Stripe environments — a
        // sandbox and Test mode are separate, with separate keys AND separate
        // Connect signups. Retrying cannot fix it, but it must be loud,
        // because every operator's status silently stops updating.
        console.error(
          `[refresh-connect ${reqId}] Stripe 404 for ${row.stripe_account_id} — is STRIPE_SECRET_KEY on the same Stripe account as this id?`,
        );
        missing++;
        return;
      }
      if (!res.ok) {
        console.error(`[refresh-connect ${reqId}] Stripe ${res.status} for ${row.stripe_account_id}`);
        failed++;
        return;
      }

      const status = readAccountStatus(await res.json());

      // The write is the whole point: `trg_notify_connect_status` reads OLD vs
      // NEW off this UPDATE and sends whatever the change deserves. Nothing in
      // this file decides who gets told what.
      const { error: updErr } = await supabase
        .from("operator_payout_accounts")
        .update(statusColumns(status))
        .eq("user_id", row.user_id);

      if (updErr) {
        console.error(`[refresh-connect ${reqId}] write failed for ${row.user_id}`, updErr.message);
        failed++;
        return;
      }
      refreshed++;
    } catch (e) {
      console.error(`[refresh-connect ${reqId}] ${row.stripe_account_id}`, safeMessage(e));
      failed++;
    }
  }

  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    await Promise.all(
      accounts
        .slice(i, i + CONCURRENCY)
        .map((r) => refreshOne(r as { user_id: string; stripe_account_id: string })),
    );
  }

  console.log(
    `[refresh-connect ${reqId}] ${refreshed} refreshed, ${missing} unknown to Stripe, ${failed} failed, of ${accounts.length}`,
  );

  // 200 even with failures: a partial sweep is not a reason for the cron to
  // retry the whole set, and the counts are in the body and the log. A run
  // that could not read the account list at all already returned 500 above.
  return new Response(
    JSON.stringify({ checked: accounts.length, refreshed, missing, failed }),
    { headers: { "Content-Type": "application/json" } },
  );
});
