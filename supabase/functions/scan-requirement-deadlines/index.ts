// ⚠️ MANUAL DEPLOY (CLI). Daily cron.
//
// Closes docs/operator-trips-checklist.html §4, "Deadline reminders never fire
// on their own". operator_requirement_due_soon and operator_requirement_overdue
// have existed since July with real copy, but the only thing that ever wrote
// them was the operator pressing "Remind N people" on the dashboard. A
// traveler could sail past every document deadline in total silence, and the
// operator was never told either — operator_requirement_overdue_operator had
// no producer at all.
//
// Reads public.operator_requirement_deadline_owed (20260820000000), a
// service-role-only RPC that mirrors operator_remind_requirement's own
// "who still owes this" logic. This function decides WHEN to nag from that,
// same split as scan-trip-reminders / scan-stalled-onboarding.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Matches the plan (docs/trip-notifications-plan.html DOC-2 / DOC-3) exactly.
// DOC-2 lists -14,-7,-3,-2,-1; DOC-3 lists +1,+3 after due date.
const DUE_SOON_DAYS = new Set([14, 7, 3, 2, 1]);
const OVERDUE_DAYS = new Set([1, 3]); // days_until_due is negated to compare

// The operator digest fires once due date is effectively imminent (tomorrow
// or sooner, including overdue) and then at most once a day per requirement
// while anyone is still stuck — same cadence scan-stalled-onboarding uses for
// its own operator digest, just without a dedicated column: there is one row
// per requirement here, not one per trip, so a cooldown read off the last
// notification is simpler than adding N stamp columns.
const OPERATOR_DIGEST_THRESHOLD_DAYS = 1;
const OPERATOR_DIGEST_COOLDOWN_HOURS = 20;

interface OwedRow {
  requirement_id: string;
  requirement_title: string;
  due_date: string;
  user_id: string;
  days_until_due: number;
}

function dueDateLabel(dateStr: string): string {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
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

  // Requirements only exist on type-C trips, but there is no cheap way to
  // filter to "has an active requirement with a due date" before calling the
  // RPC, so — like scan-stalled-onboarding — this asks every active trip and
  // lets an empty RPC result be free. hosting_style isn't read here on
  // purpose: a peer trip (A/B) simply has no rows in
  // organized_trip_requirements and the RPC returns nothing for it.
  const { data: trips, error: tripsErr } = await supabase
    .from("group_trips")
    .select("id, title, host_id")
    .eq("status", "active");

  if (tripsErr) {
    console.error(`[req-deadlines ${reqId}] trip query failed`, tripsErr.message);
    return new Response(JSON.stringify({ error: "trip query failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let travelerNudges = 0;
  let operatorDigests = 0;

  for (const trip of trips ?? []) {
    const { data: owed, error: rpcErr } = await supabase.rpc(
      "operator_requirement_deadline_owed",
      { p_trip_id: trip.id },
    );
    if (rpcErr) {
      // One bad trip must not stop the rest of the run.
      console.error(`[req-deadlines ${reqId}] rpc failed for ${trip.id}`, rpcErr.message);
      continue;
    }

    const rows = (owed ?? []) as OwedRow[];
    if (rows.length === 0) continue;

    // ── Travelers: due-soon / overdue, one requirement at a time ────────────
    for (const row of rows) {
      const daysUntil = row.days_until_due;
      const isDueSoon = daysUntil >= 0 && DUE_SOON_DAYS.has(daysUntil);
      const isOverdue = daysUntil < 0 && OVERDUE_DAYS.has(-daysUntil);
      if (!isDueSoon && !isOverdue) continue;

      const type = isOverdue ? "operator_requirement_overdue" : "operator_requirement_due_soon";

      // Idempotency: one notification per (recipient, requirement, exact day
      // offset). Re-running the cron the same day, or a retry, matches an
      // existing row and inserts nothing — no claim column needed because the
      // day offset itself is the dedup key.
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("recipient_id", row.user_id)
        .eq("type", type)
        .eq("entity_id", row.requirement_id)
        .eq("data->>day_offset", String(daysUntil))
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      const { error: notifyErr } = await supabase.from("notifications").insert({
        recipient_id: row.user_id,
        trip_id: trip.id,
        type,
        audience: "user",
        entity_type: "requirement",
        entity_id: row.requirement_id,
        data: {
          trip_title: trip.title,
          requirement_title: row.requirement_title,
          item_name: row.requirement_title, // template's {item}
          due_date_label: dueDateLabel(row.due_date),
          day_offset: daysUntil,
        },
      });
      if (notifyErr) {
        console.error(`[req-deadlines ${reqId}] traveler notify failed`, notifyErr.message);
        continue;
      }
      travelerNudges++;
    }

    // ── Operator: one digest per requirement, not per stuck traveler ────────
    const byRequirement = new Map<string, OwedRow[]>();
    for (const row of rows) {
      if (row.days_until_due > OPERATOR_DIGEST_THRESHOLD_DAYS) continue;
      const list = byRequirement.get(row.requirement_id) ?? [];
      list.push(row);
      byRequirement.set(row.requirement_id, list);
    }

    for (const [requirementId, group] of byRequirement) {
      const { data: last } = await supabase
        .from("notifications")
        .select("created_at")
        .eq("recipient_id", trip.host_id)
        .eq("type", "operator_requirement_overdue_operator")
        .eq("entity_id", requirementId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (last) {
        const hoursSince = (Date.now() - new Date(last.created_at).getTime()) / 3_600_000;
        if (hoursSince < OPERATOR_DIGEST_COOLDOWN_HOURS) continue;
      }

      const { error: digestErr } = await supabase.from("notifications").insert({
        recipient_id: trip.host_id,
        trip_id: trip.id,
        type: "operator_requirement_overdue_operator",
        audience: "admin",
        entity_type: "requirement",
        entity_id: requirementId,
        data: {
          trip_title: trip.title,
          requirement_title: group[0].requirement_title,
          item_name: group[0].requirement_title,
          count: group.length,
        },
      });
      if (digestErr) {
        console.error(`[req-deadlines ${reqId}] operator notify failed`, digestErr.message);
        continue;
      }
      operatorDigests++;
    }
  }

  console.log(
    `[req-deadlines ${reqId}] traveler_nudges=${travelerNudges} operator_digests=${operatorDigests}`,
  );
  return new Response(
    JSON.stringify({ travelerNudges, operatorDigests, request_id: reqId }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
