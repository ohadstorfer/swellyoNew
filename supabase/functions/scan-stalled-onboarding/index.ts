// ⚠️ MANUAL DEPLOY (CLI). Daily cron.
//
// Nudges travelers who paid a deposit and never finished onboarding, and tells
// the operator when someone is stuck. Spec: docs/operator-trips-checklist.html
// §4, "Deposit paid, onboarding abandoned — and nobody notices".
//
// It writes `notifications` rows and nothing else. The Phase-1 enqueue trigger
// turns them into push queue rows with quiet-hours `send_after`, so both types
// land in the bell AND on the phone — provided they are listed in
// `notification_push_priority`, which 20260818000300 does. Without that they
// would be feed-only and silent, and nothing would look broken.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * The traveler ladder. Three nudges, then silence.
 *
 * They paid — they are committed, not a cold lead — so a reminder is welcome
 * rather than spam. That is also why there is no fourth: money held does not
 * buy unlimited pushes.
 *
 * `column` is the claim: the scanner stamps it BEFORE sending, so a double cron
 * run, a retry or two overlapping invocations cannot send the same message
 * twice. A nudge lost to a failed insert is strictly better than a duplicate
 * push, which is the same trade stripe-connect-webhook makes.
 */
const NUDGES = [
  { key: "24h", afterHours: 24, column: "stall_nudge_24h_sent_at" },
  { key: "3d", afterHours: 72, column: "stall_nudge_3d_sent_at" },
  { key: "7d", afterHours: 168, column: "stall_nudge_7d_sent_at" },
] as const;

/** The operator hears nothing for three days — before that it is normal latency. */
const OPERATOR_FIRST_HOURS = 72;
/** Then at most weekly, while anyone is still stuck. */
const OPERATOR_REPEAT_HOURS = 168;

interface Stalled {
  user_id: string;
  deposit_paid_at: string;
  last_activity_at: string;
  stalled_hours: number;
  missing_titles: string[];
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);

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

  const supabase = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Managed type-C trips only. `operator_stalled_onboarders` re-checks status
  // and start date itself; this is just to avoid asking about trips that can
  // never have a stalled payer.
  const { data: trips, error: tripsErr } = await supabase
    .from("group_trips")
    .select("id, title, host_id, operator_stall_digest_sent_at")
    .eq("hosting_style", "C")
    .eq("payment_mode", "managed")
    .eq("status", "active");

  if (tripsErr) {
    console.error(`[stalled ${reqId}] trip query failed`, tripsErr.message);
    return new Response(JSON.stringify({ error: "trip query failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let travelerNudges = 0;
  let operatorDigests = 0;

  for (const trip of trips ?? []) {
    const { data: stalled, error: rpcErr } = await supabase.rpc(
      "operator_stalled_onboarders",
      { p_trip_id: trip.id },
    );
    if (rpcErr) {
      // One bad trip must not stop the rest of the run.
      console.error(`[stalled ${reqId}] rpc failed for ${trip.id}`, rpcErr.message);
      continue;
    }

    const rows = (stalled ?? []) as Stalled[];
    if (rows.length === 0) continue;

    // ── The travelers ───────────────────────────────────────────────────────
    for (const row of rows) {
      // The LAST nudge whose threshold has passed, not the first. Someone who
      // shows up already 8 days stale gets the 7d message once, rather than
      // three messages on three consecutive days.
      const due = [...NUDGES].reverse().find((n) => row.stalled_hours >= n.afterHours);
      if (!due) continue;

      // Claim it. `.is(column, null)` is the whole guard: a second worker
      // updating the same row matches nothing and sends nothing.
      const { data: claimed, error: claimErr } = await supabase
        .from("group_trip_participants")
        .update({ [due.column]: new Date().toISOString() })
        .eq("trip_id", trip.id)
        .eq("user_id", row.user_id)
        .is(due.column, null)
        .select("user_id");

      if (claimErr) {
        console.error(`[stalled ${reqId}] claim failed`, claimErr.message);
        continue;
      }
      if (!claimed || claimed.length === 0) continue; // already sent

      const { error: notifyErr } = await supabase.from("notifications").insert({
        recipient_id: row.user_id,
        trip_id: trip.id,
        type: "onboarding_unfinished",
        audience: "user",
        entity_type: "group_trip",
        entity_id: trip.id,
        data: {
          trip_title: trip.title,
          stage: due.key,
          // Rendered into the body so the nudge says what is actually blocking
          // them. A reminder that does not name the step is no help to someone
          // who stopped BECAUSE they were unsure which step it was.
          missing: row.missing_titles ?? [],
        },
      });
      if (notifyErr) {
        console.error(`[stalled ${reqId}] traveler notify failed`, notifyErr.message);
        continue;
      }
      travelerNudges++;
    }

    // ── The operator ────────────────────────────────────────────────────────
    // One digest per trip, never one per stuck traveler: ten people stalling on
    // a big trip is one notification. Mirrors the "Remind N people" button they
    // already have on the dashboard.
    const worst = Math.max(...rows.map((r) => r.stalled_hours));
    if (worst < OPERATOR_FIRST_HOURS) continue;

    const lastSent = trip.operator_stall_digest_sent_at
      ? new Date(trip.operator_stall_digest_sent_at).getTime()
      : null;
    const hoursSince = lastSent === null
      ? Infinity
      : (Date.now() - lastSent) / 3_600_000;
    if (hoursSince < OPERATOR_REPEAT_HOURS) continue;

    // Claim on the same principle as the traveler nudge: the timestamp we are
    // replacing has to still be the one we read, or another worker got here.
    const claim = supabase
      .from("group_trips")
      .update({ operator_stall_digest_sent_at: new Date().toISOString() })
      .eq("id", trip.id);
    const { data: claimedTrip, error: tripClaimErr } = await (
      trip.operator_stall_digest_sent_at === null
        ? claim.is("operator_stall_digest_sent_at", null)
        : claim.eq("operator_stall_digest_sent_at", trip.operator_stall_digest_sent_at)
    ).select("id");

    if (tripClaimErr) {
      console.error(`[stalled ${reqId}] digest claim failed`, tripClaimErr.message);
      continue;
    }
    if (!claimedTrip || claimedTrip.length === 0) continue;

    const { error: digestErr } = await supabase.from("notifications").insert({
      recipient_id: trip.host_id,
      trip_id: trip.id,
      type: "operator_onboarding_stalled",
      audience: "admin",
      entity_type: "group_trip",
      entity_id: trip.id,
      data: {
        trip_title: trip.title,
        count: rows.length,
        worst_days: Math.floor(worst / 24),
      },
    });
    if (digestErr) {
      console.error(`[stalled ${reqId}] operator notify failed`, digestErr.message);
      continue;
    }
    operatorDigests++;
  }

  console.log(
    `[stalled ${reqId}] traveler_nudges=${travelerNudges} operator_digests=${operatorDigests}`,
  );
  return new Response(
    JSON.stringify({ travelerNudges, operatorDigests, request_id: reqId }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
