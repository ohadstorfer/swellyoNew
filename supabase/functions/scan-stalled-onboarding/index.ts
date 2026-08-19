// ⚠️ MANUAL DEPLOY (CLI). HOURLY cron — cron.job 8, `20 * * * *`.
//
// ⚠️ The hourly schedule is load-bearing, not tidiness. The first nudge is due
// four hours after the traveler's last action; on the daily schedule this job
// used to run, "4 hours" would have meant "some time tomorrow morning" and the
// whole re-timing would have been silently inert.
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
import { dueStage, effectiveLastStage, stageKey } from "./ladder.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * The traveler ladder: 4 hours, 24 hours, then every 24 hours, with no last
 * rung.
 *
 * Four hours is short on purpose. They have paid and they hold no spot, and
 * most people who stop mid-form stopped inside the same sitting — a nudge that
 * arrives while they still remember what they were doing is worth more than
 * three polite ones spread over a week.
 *
 * The daily repeat does not run away with itself, because the only thing that
 * silences it is the problem going away: the moment the traveler acts, their
 * clock restarts and `operator_stalled_onboarders` stops returning them, and it
 * already drops anyone whose trip has started or been cancelled.
 *
 * The arithmetic lives in ladder.ts so it can be tested — `serve()` below runs
 * at module load, so nothing declared in this file is importable.
 */

/** The operator joins at the 24-hour mark — the same one the traveler crosses. */
const OPERATOR_FIRST_HOURS = 24;
/** Then daily, while anyone is still stuck. */
const OPERATOR_REPEAT_HOURS = 24;

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

    // Where each traveler is on the ladder. The RPC deliberately does not carry
    // this — it is the one definition shared with the dashboard, and the
    // dashboard has no business knowing what we have already sent.
    const { data: ladder, error: ladderErr } = await supabase
      .from("group_trip_participants")
      .select("user_id, stall_nudge_stage, stall_nudge_anchor_at")
      .eq("trip_id", trip.id)
      .in("user_id", rows.map((r) => r.user_id));

    if (ladderErr) {
      console.error(`[stalled ${reqId}] ladder read failed`, ladderErr.message);
      continue;
    }
    const ladderByUser = new Map(
      (ladder ?? []).map((l: any) => [l.user_id as string, l]),
    );

    // ── The travelers ───────────────────────────────────────────────────────
    for (const row of rows) {
      const stage = dueStage(row.stalled_hours);
      if (stage === null) continue;

      const state = ladderByUser.get(row.user_id);
      // The two columns are always written together, so a half-set pair can
      // only come from a hand-written row. Treat it as unset rather than as
      // state to match: `.eq(col, null)` is `eq.null` to PostgREST, which
      // matches nothing, and that traveler would go silent forever.
      const priorStage = typeof state?.stall_nudge_stage === "number"
        ? state.stall_nudge_stage
        : null;
      const anchor = priorStage === null
        ? null
        : (state?.stall_nudge_anchor_at ?? null);

      const lastStage = effectiveLastStage(
        priorStage,
        anchor,
        row.last_activity_at,
      );
      if (stage <= lastStage) continue;

      // Claim it by compare-and-set on the pair we just read: a second worker
      // re-evaluates this after our update commits, finds the row changed, and
      // matches nothing. Stamping BEFORE sending means a retry loses a nudge
      // rather than duplicating a push — the same trade stripe-connect-webhook
      // makes, and the same shape as the digest claim below.
      const claim = supabase
        .from("group_trip_participants")
        .update({
          stall_nudge_stage: stage,
          stall_nudge_anchor_at: row.last_activity_at,
        })
        .eq("trip_id", trip.id)
        .eq("user_id", row.user_id);
      const { data: claimed, error: claimErr } = await (
        anchor === null
          ? claim.is("stall_nudge_anchor_at", null)
          : claim
            .eq("stall_nudge_anchor_at", anchor)
            .eq("stall_nudge_stage", priorStage)
      ).select("user_id");

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
          stage: stageKey(stage),
          stalled_days: Math.floor(row.stalled_hours / 24),
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
    //
    // The first four hours are the traveler's alone. Someone who wandered off
    // mid-form and comes back after lunch was never the operator's problem, and
    // handing them a chore that usually resolves itself is how a to-do list
    // stops being read. Past 24 hours it is real, and from then on they hear
    // about it daily, for as long as it stays true.
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
