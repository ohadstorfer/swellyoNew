import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

// OPS-9 (docs/trip-notifications-plan.html): a payment that reached Stripe but
// never reached us.
//
// This really happened: the platform webhook destination was missing 05–07 Aug
// and again on 10 Aug 2026, nobody noticed for six days, 4 payments / $3,500
// went unrecorded, and the app kept demanding money from a traveler who had
// overpaid by $600. The truth was recoverable by arithmetic the whole time —
// Stripe's own list of succeeded charges against our ledger — and nothing was
// doing the arithmetic. This check is that arithmetic, on the hourly cron.
//
// Scope decisions:
//  - `Stripe's charges list, not balance`: the balance-vs-ledger comparison
//    that diagnosed the 12 Aug incident needs the commission rate to invert,
//    which varies per operator. Charge ids don't.
//  - 3-day window: matches Stripe's own webhook retry horizon. Anything older
//    that is still missing needs a human backfill anyway and would have been
//    flagged by ~72 consecutive failing runs already.
//  - 15-minute grace: a charge whose webhook is still in flight is not an
//    incident. The 05 Aug failure mode (no destination at all) survives any
//    grace period.
//  - The key's mode (sk_live_ / sk_test_) decides which charges the API
//    returns; ledger rows carry both modes and PaymentIntent ids are unique
//    per mode, so matching on id alone stays correct either way.
//  - Every succeeded platform charge is expected to have a ledger row. Today
//    they all come from payments-checkout; a charge from anywhere else SHOULD
//    alert, because nothing else is allowed to take money on this account.

const WINDOW_DAYS = 3;
const GRACE_MINUTES = 15;

type StripeCharge = {
  id: string;
  status: string;
  paid: boolean;
  created: number;
  amount: number;
  payment_intent: string | null;
};

export function stripeLedgerCheck(): Check {
  return {
    name: "stripe_ledger",
    critical: true,
    run: async () => {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

      const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 24 * 60 * 60;
      const graceCutoff = Math.floor(Date.now() / 1000) - GRACE_MINUTES * 60;

      const res = await fetch(
        `https://api.stripe.com/v1/charges?created[gte]=${since}&limit=100`,
        { headers: { Authorization: `Bearer ${stripeKey}` } },
      );
      if (!res.ok) throw new Error(`stripe charges list: HTTP ${res.status}`);
      const body = await res.json();
      const charges: StripeCharge[] = body.data ?? [];

      const eligible = charges.filter(
        (c) =>
          c.status === "succeeded" &&
          c.paid &&
          c.payment_intent &&
          c.created <= graceCutoff,
      );
      if (eligible.length === 0) {
        return `0 charges in ${WINDOW_DAYS}d window`;
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      const piIds = eligible.map((c) => c.payment_intent as string);
      const { data: rows, error } = await supabase
        .from("organized_trip_payment_events")
        .select("provider_object_id")
        .eq("provider", "stripe")
        .eq("event_type", "paid")
        .in("provider_object_id", piIds);
      if (error) throw new Error(`ledger read: ${error.message}`);

      const recorded = new Set((rows ?? []).map((r) => r.provider_object_id));
      const missing = eligible.filter((c) => !recorded.has(c.payment_intent));

      if (missing.length > 0) {
        // PaymentIntent ids lead the message: they are what a human backfills
        // from (the 12 Aug backfill was keyed on exactly these). Capped so one
        // bad week does not produce an unreadable alert email.
        const sample = missing
          .slice(0, 5)
          .map((c) => `${c.payment_intent} ($${(c.amount / 100).toFixed(2)})`)
          .join(", ");
        const total = missing.reduce((sum, c) => sum + c.amount, 0);
        throw new Error(
          `${missing.length} succeeded charge(s) totalling $${(total / 100).toFixed(2)} have no ledger row: ${sample}${missing.length > 5 ? ", …" : ""}`,
        );
      }

      // `has_more` means charges 101+ in the window went unchecked. Not worth
      // failing over — the newest 100 are the ones a webhook outage shows up
      // in first — but say so rather than reading as full coverage.
      return `${eligible.length} charge(s) reconciled${body.has_more ? " (older charges beyond page 1 unchecked)" : ""}`;
    },
  };
}
