// ⚠️ MANUAL DEPLOY (CLI). Daily cron. Enqueues reminders/nudges as trip_reminder/trip_ended feed rows.
// The Phase-1 enqueue trigger turns push-channel rows into queue rows with quiet-hours send_after.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reminderStagesForTrip } from "./reminders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function daysBetweenUTC(dateStr: string, b: Date): number {
  const da = new Date(dateStr + "T00:00:00Z").getTime();
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((da - db) / 86400000);
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("ADMIN_FUNCTION_SECRET") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const bearerOk = SERVICE.length > 0 && authHeader === `Bearer ${SERVICE}`;
  if (!(expected.length > 0 && provided === expected) && !bearerOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = new Date();

  const { data: trips } = await supabase
    .from("group_trips").select("id, title, start_date, end_date, status")
    .eq("status", "active").not("start_date", "is", null);

  let inserted = 0;
  for (const trip of trips ?? []) {
    const daysToStart = daysBetweenUTC(trip.start_date, now);
    const daysSinceEnd = trip.end_date ? -daysBetweenUTC(trip.end_date, now) : undefined;

    // Gear unclaimed? needed_qty vs summed claims.
    const { data: items } = await supabase
      .from("group_trip_gear_items").select("id, needed_qty").eq("trip_id", trip.id);
    let gearUnclaimed: boolean | null = null;
    if (items && items.length) {
      const ids = items.map((i: any) => i.id);
      const { data: claims } = await supabase
        .from("group_trip_gear_claims").select("item_id, quantity").in("item_id", ids);
      const claimed: Record<string, number> = {};
      for (const c of claims ?? []) claimed[c.item_id] = (claimed[c.item_id] || 0) + (c.quantity || 0);
      gearUnclaimed = items.some((i: any) => (i.needed_qty || 0) > (claimed[i.id] || 0));
    }

    const { data: parts } = await supabase
      .from("group_trip_participants").select("user_id, role, commitment_status").eq("trip_id", trip.id);

    for (const p of parts ?? []) {
      const stages = reminderStagesForTrip(daysToStart, gearUnclaimed, p.commitment_status !== "approved", daysSinceEnd);
      for (const stage of stages) {
        const type = stage === "ended" ? "trip_ended" : "trip_reminder";
        // Idempotency: already sent this (recipient, trip, type, stage)?
        const { data: existing } = await supabase
          .from("notifications").select("id")
          .eq("recipient_id", p.user_id).eq("trip_id", trip.id).eq("type", type)
          .eq("data->>stage", stage).limit(1).maybeSingle();
        if (existing) continue;
        await supabase.from("notifications").insert({
          recipient_id: p.user_id, trip_id: trip.id, type,
          audience: (p.role === "host" || p.role === "admin") ? "admin" : "user",
          entity_type: "group_trip", entity_id: trip.id,
          data: { trip_title: trip.title, stage },
        });
        inserted++;
      }
    }
  }
  console.log(`[scan-reminders ${reqId}] inserted=${inserted}`);
  return new Response(JSON.stringify({ inserted, request_id: reqId }), { status: 200, headers: { "Content-Type": "application/json" } });
});
