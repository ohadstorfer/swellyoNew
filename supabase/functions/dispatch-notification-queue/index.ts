// ⚠️ MANUAL DEPLOY: copy-paste into the Supabase dashboard OR deploy via CLI.
// Cron-driven (~1 min). Drains notification_queue, applies the NOW smart rules
// (SR8 priority via send_after, SR4 dedup-vs-feed, SR6 mute, SR5 collapse), sends to Expo.
// SHADOW MODE: if env NOTIFICATIONS_QUEUE_SHADOW='true', renders + marks rows
// skipped:'shadow' WITHOUT calling Expo (legacy push path still serves users).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderPush, type PushTemplateMap } from "./render.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN");
const SHADOW = (Deno.env.get("NOTIFICATIONS_QUEUE_SHADOW") || "").toLowerCase() === "true";
const BATCH = 100;

async function isTripMuted(supabase: any, tripId: string | null, userId: string): Promise<boolean> {
  if (!tripId) return false;
  const { data: conv } = await supabase
    .from("conversations").select("id").eq("metadata->>trip_id", tripId).maybeSingle();
  if (!conv?.id) return false; // no conversation → nothing muted → send
  const { data: member } = await supabase
    .from("conversation_members").select("preferences")
    .eq("conversation_id", conv.id).eq("user_id", userId).maybeSingle();
  const raw = member?.preferences?.muted_until;
  if (!raw) return false;
  const ms = Date.parse(raw);
  return !isNaN(ms) && ms > Date.now();
}

async function mark(supabase: any, id: string, status: string, skip_reason: string | null, payload?: any) {
  await supabase.from("notification_queue").update({
    status, skip_reason,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    payload: payload ?? {},
  }).eq("id", id);
}

serve(async (req) => {
  const reqId = crypto.randomUUID().substring(0, 8);
  // Auth: accept service-role bearer OR x-internal-secret == ADMIN_FUNCTION_SECRET. Fails closed.
  const authHeader = req.headers.get("Authorization") || "";
  const bearerOk = SUPABASE_SERVICE_ROLE_KEY.length > 0 && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("ADMIN_FUNCTION_SECRET") || "";
  const secretOk = expected.length > 0 && provided === expected;
  if (!bearerOk && !secretOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Drain: pending + due, urgent first.
  const { data: rows, error } = await supabase
    .from("notification_queue")
    .select("id, recipient_id, trip_id, type, priority, notification_id")
    .eq("status", "pending")
    .lte("send_after", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Editable texts: one fetch per run; missing table/rows → hardcoded defaults.
  const templates: PushTemplateMap = {};
  try {
    const { data: tplRows } = await supabase
      .from("notification_templates").select("key, push_title, push_body");
    for (const t of tplRows ?? []) templates[t.key] = t;
  } catch (_) { /* fall back to defaults */ }

  // SR1 batch: non-urgent rows for the same (recipient, trip) collapse into one digest push.
  const groups: Record<string, any[]> = {};
  for (const r of rows ?? []) {
    if (r.priority === 1 && r.trip_id) (groups[`${r.recipient_id}|${r.trip_id}`] ||= []).push(r);
  }
  const batchLeader = new Map<string, number>(); // leader row.id -> group size
  const batchedAway = new Set<string>();         // follower row ids (skipped:'batched')
  for (const k in groups) {
    const g = groups[k];
    if (g.length >= 2) { batchLeader.set(g[0].id, g.length); for (let i = 1; i < g.length; i++) batchedAway.add(g[i].id); }
  }

  let sent = 0, skipped = 0;
  for (const row of rows ?? []) {
    // SR1: followers of a batch are represented by the leader's single digest push.
    if (batchedAway.has(row.id)) { await mark(supabase, row.id, "skipped", "batched"); skipped++; continue; }
    // SR4 dedup-vs-feed: if they already read the linked feed row, drop the push.
    let feedData: Record<string, any> = {};
    if (row.notification_id) {
      const { data: notif } = await supabase
        .from("notifications").select("read_at, data").eq("id", row.notification_id).maybeSingle();
      if (notif?.read_at) { await mark(supabase, row.id, "skipped", "read_in_feed"); skipped++; continue; }
      feedData = notif?.data ?? {};
    }
    // SR6 mute
    if (await isTripMuted(supabase, row.trip_id, row.recipient_id)) {
      await mark(supabase, row.id, "skipped", "muted"); skipped++; continue;
    }
    // SR2 frequency cap: <=3 non-urgent pushes sent per recipient per rolling 24h; defer the rest 6h.
    if (row.priority > 0) {
      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await supabase.from("notification_queue")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", row.recipient_id).eq("status", "sent").gte("sent_at", since);
      if ((count ?? 0) >= 3) {
        await supabase.from("notification_queue")
          .update({ send_after: new Date(Date.now() + 6 * 3600000).toISOString() }).eq("id", row.id);
        skipped++; continue;
      }
    }
    // Trip title for the render (some triggers don't store it in data)
    let tripTitle = feedData.trip_title || "";
    if (!tripTitle && row.trip_id) {
      const { data: trip } = await supabase.from("group_trips").select("title").eq("id", row.trip_id).maybeSingle();
      tripTitle = trip?.title || "";
    }
    // SR1: a batch leader sends one digest in place of its group; otherwise normal copy.
    const batchCount = batchLeader.get(row.id);
    const text = batchCount
      ? { title: tripTitle || "Your trip", body: `${batchCount} updates in ${tripTitle || "your trip"}` }
      : renderPush(row.type, feedData, tripTitle, templates);

    if (SHADOW) { await mark(supabase, row.id, "skipped", "shadow", text); skipped++; continue; }

    // Token
    const { data: surfer } = await supabase
      .from("surfers").select("expo_push_token").eq("user_id", row.recipient_id).maybeSingle();
    const token = surfer?.expo_push_token;
    if (!token) { await mark(supabase, row.id, "skipped", "no_token"); skipped++; continue; }
    // Self-heal: a raw APNs/FCM hex (not ExponentPushToken[...]) can't be sent
    // through the Expo API — clear it like a dead token so the app re-registers.
    if (!token.startsWith("ExponentPushToken[")) {
      await supabase.from("surfers").update({ expo_push_token: null }).eq("user_id", row.recipient_id);
      await mark(supabase, row.id, "skipped", "invalid_token"); skipped++; continue;
    }

    // SR5 collapse: one live push per trip.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (EXPO_ACCESS_TOKEN) headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers,
      body: JSON.stringify({
        to: token, title: text.title, body: text.body, sound: "default",
        collapseId: row.trip_id || undefined,
        // stage/decision let the app deep-link to the right section on tap
        // (e.g. trip_reminder:gear → Plan tab → Packing & Gear).
        data: {
          type: row.type, tripId: row.trip_id, notificationId: row.notification_id,
          stage: feedData.stage ?? undefined, decision: feedData.decision ?? undefined,
        },
      }),
    });
    if (!resp.ok) {
      // Transient Expo failure (5xx / network). Don't lie about it as "sent" —
      // record it so it's visible and not silently lost. (No auto-retry in Phase 1.)
      console.error(`[dispatch ${reqId}] Expo HTTP ${resp.status} for queue ${row.id}`);
      await mark(supabase, row.id, "skipped", "expo_error", text); skipped++; continue;
    }
    const result = await resp.json().catch(() => ({}));
    if (result?.data?.status === "error" && result?.data?.details?.error === "DeviceNotRegistered") {
      await supabase.from("surfers").update({ expo_push_token: null }).eq("user_id", row.recipient_id);
      await mark(supabase, row.id, "skipped", "device_unregistered"); skipped++; continue;
    }
    await mark(supabase, row.id, "sent", null, text); sent++;
  }

  console.log(`[dispatch ${reqId}] sent=${sent} skipped=${skipped} shadow=${SHADOW}`);
  return new Response(JSON.stringify({ sent, skipped, shadow: SHADOW, request_id: reqId }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
