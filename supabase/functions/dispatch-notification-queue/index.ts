// ⚠️ MANUAL DEPLOY: copy-paste into the Supabase dashboard OR deploy via CLI.
// Cron-driven (~1 min). Drains notification_queue, applies the NOW smart rules
// (SR8 priority via send_after, SR4 dedup-vs-feed, SR6 mute, SR5 collapse), sends to Expo.
// SHADOW MODE: if env NOTIFICATIONS_QUEUE_SHADOW='true', renders + marks rows
// skipped:'shadow' WITHOUT calling Expo (legacy push path still serves users).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderPush, type PushTemplateMap } from "./render.ts";
import {
  chunk,
  resolveSkips,
  buildExpoMessages,
  type DrainRow,
  type Skip,
  type SkipReason,
} from "./batching.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN");
const SHADOW = (Deno.env.get("NOTIFICATIONS_QUEUE_SHADOW") || "").toLowerCase() === "true";
// Drain wide so one cron run clears far more than the old ~100/min ceiling.
// All checks are batched (.in()), and sends go out in ≤100-msg Expo bulk POSTs.
const BATCH = 500;
const EXPO_CHUNK = 100;

/** Bulk-mark many queue rows to one (status, skip_reason) in a single update. */
async function markBulk(supabase: any, ids: string[], status: string, skip_reason: string | null) {
  if (ids.length === 0) return;
  await supabase.from("notification_queue").update({
    status, skip_reason,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  }).in("id", ids);
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

  const drained = (rows ?? []) as any[];
  if (drained.length === 0) {
    console.log(`[dispatch ${reqId}] empty drain shadow=${SHADOW}`);
    return new Response(JSON.stringify({ sent: 0, skipped: 0, shadow: SHADOW, request_id: reqId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // CLAIM: flip every drained row to 'sending' BEFORE any send. An overlapping cron
  // run (we drain 'pending' only) then can't re-pick these — prevents double-send when
  // a run nears the 60s boundary. Every row below resolves to a terminal state.
  const allIds = drained.map((r) => r.id as string);
  {
    const { error: claimErr } = await supabase
      .from("notification_queue").update({ status: "sending" }).in("id", allIds);
    if (claimErr) {
      return new Response(JSON.stringify({ error: claimErr.message, request_id: reqId }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  const recipientIds = [...new Set(drained.map((r) => r.recipient_id as string))];
  const notificationIds = [...new Set(drained.map((r) => r.notification_id).filter(Boolean))] as string[];
  const tripIds = [...new Set(drained.map((r) => r.trip_id).filter(Boolean))] as string[];

  // Editable texts: one fetch per run; missing table/rows → hardcoded defaults.
  const templates: PushTemplateMap = {};
  try {
    const { data: tplRows } = await supabase
      .from("notification_templates").select("key, push_title, push_body");
    for (const t of tplRows ?? []) templates[t.key] = t;
  } catch (_) { /* fall back to defaults */ }

  // ---- 5 batched SET reads replace the old 5 per-row queries ----

  // feedMap: notification read_at + data, in one .in() read (SR4 + render data).
  const feedMap = new Map<string, { read_at: string | null; data: Record<string, any> }>();
  if (notificationIds.length > 0) {
    const { data: notifs } = await supabase
      .from("notifications").select("id, read_at, data").in("id", notificationIds);
    for (const n of notifs ?? []) feedMap.set(n.id, { read_at: n.read_at, data: n.data ?? {} });
  }

  // muteMap: `${recipient}|${trip}` → muted_until epoch ms (SR6). Two batched reads:
  // conversations by trip_id, then conversation_members for those convs.
  const muteMap = new Map<string, number | true>();
  if (tripIds.length > 0) {
    const { data: convs } = await supabase
      .from("conversations").select("id, metadata").in("metadata->>trip_id", tripIds);
    const convIdToTrip = new Map<string, string>();
    const convIds: string[] = [];
    for (const c of convs ?? []) {
      const tid = c.metadata?.trip_id;
      if (tid) { convIdToTrip.set(c.id, tid); convIds.push(c.id); }
    }
    if (convIds.length > 0) {
      const { data: members } = await supabase
        .from("conversation_members").select("conversation_id, user_id, preferences")
        .in("conversation_id", convIds).in("user_id", recipientIds);
      for (const m of members ?? []) {
        const tid = convIdToTrip.get(m.conversation_id);
        const raw = m.preferences?.muted_until;
        if (!tid || !raw) continue;
        const ms = Date.parse(raw);
        if (!isNaN(ms)) muteMap.set(`${m.user_id}|${tid}`, ms);
      }
    }
  }

  // capCounts: pushes already sent per recipient in the rolling 24h window (SR2).
  // Tally in JS from one .in() read instead of a per-row count() round-trip.
  const capCounts = new Map<string, number>();
  {
    const since = new Date(Date.now() - 86400000).toISOString();
    const { data: sentRows } = await supabase
      .from("notification_queue").select("recipient_id")
      .in("recipient_id", recipientIds).eq("status", "sent").gte("sent_at", since);
    for (const s of sentRows ?? []) capCounts.set(s.recipient_id, (capCounts.get(s.recipient_id) ?? 0) + 1);
  }

  // titleMap: trip titles in one .in() read (render fallback when not in data).
  const titleMap = new Map<string, string>();
  if (tripIds.length > 0) {
    const { data: trips } = await supabase.from("group_trips").select("id, title").in("id", tripIds);
    for (const t of trips ?? []) titleMap.set(t.id, t.title || "");
  }

  // tokenMap: push tokens in one .in() read.
  const tokenMap = new Map<string, string | null>();
  {
    const { data: surfers } = await supabase
      .from("surfers").select("user_id, expo_push_token").in("user_id", recipientIds);
    for (const s of surfers ?? []) tokenMap.set(s.user_id, s.expo_push_token ?? null);
  }

  // ---- SR1 batch (in JS): non-urgent rows for the same (recipient, trip) collapse
  // into one digest push; followers are marked skipped:'batched'. Kept here because
  // it's an aggregation over the drain set, not a per-row decision. ----
  const groups: Record<string, any[]> = {};
  for (const r of drained) {
    if (r.priority === 1 && r.trip_id) (groups[`${r.recipient_id}|${r.trip_id}`] ||= []).push(r);
  }
  const batchLeader = new Map<string, number>(); // leader row.id -> group size
  const batchedAway = new Set<string>();          // follower row ids (skipped:'batched')
  for (const k in groups) {
    const g = groups[k];
    if (g.length >= 2) { batchLeader.set(g[0].id, g.length); for (let i = 1; i < g.length; i++) batchedAway.add(g[i].id); }
  }

  // Build DrainRows (with rendered text) for the non-follower rows; collect followers.
  const batchedIds: string[] = [];
  const prepared: DrainRow[] = [];
  for (const r of drained) {
    if (batchedAway.has(r.id)) { batchedIds.push(r.id); continue; }
    const feed = feedMap.get(r.notification_id);
    const feedData: Record<string, any> = feed?.data ?? {};
    const tripTitle = feedData.trip_title || (r.trip_id ? titleMap.get(r.trip_id) : "") || "";
    const batchCount = batchLeader.get(r.id);
    const text = batchCount
      ? { title: tripTitle || "Your trip", body: `${batchCount} updates in ${tripTitle || "your trip"}` }
      : renderPush(r.type, feedData, tripTitle, templates);
    prepared.push({
      id: r.id, recipient_id: r.recipient_id, trip_id: r.trip_id, type: r.type,
      priority: r.priority, notification_id: r.notification_id, text, data: feedData,
    });
  }

  // ---- All skip/send decisions live in the tested pure module ----
  const { toSend, skips } = resolveSkips(prepared, { feedMap, muteMap, capCounts, tokenMap });

  // Group skip ids by reason for one bulk update each. 'over_cap' is special:
  // the legacy code DEFERRED those rows (send_after += 6h, status stays pending)
  // rather than terminally skipping them — preserve that.
  const skipIdsByReason = new Map<SkipReason, string[]>();
  const overCapIds: string[] = [];
  for (const s of skips) {
    if (s.reason === "over_cap") { overCapIds.push(s.id); continue; }
    (skipIdsByReason.get(s.reason) ?? skipIdsByReason.set(s.reason, []).get(s.reason)!).push(s.id);
  }
  const markedSkippedCount = batchedIds.length + skips.length - overCapIds.length;
  let skipped = markedSkippedCount;

  // Defer over-cap rows back to pending (NOT a claim/send candidate this run).
  if (overCapIds.length > 0) {
    await supabase.from("notification_queue")
      .update({ status: "pending", send_after: new Date(Date.now() + 6 * 3600000).toISOString() })
      .in("id", overCapIds);
  }

  // SHADOW: render + mark everything skipped:'shadow' WITHOUT touching Expo.
  if (SHADOW) {
    await markBulk(supabase, batchedIds, "skipped", "batched");
    for (const [reason, ids] of skipIdsByReason) await markBulk(supabase, ids, "skipped", reason as string);
    await markBulk(supabase, toSend.map((r) => r.id), "skipped", "shadow");
    const shadowSkipped = skipped + toSend.length;
    console.log(`[dispatch ${reqId}] shadow drain=${drained.length} skipped=${shadowSkipped} deferred=${overCapIds.length}`);
    return new Response(JSON.stringify({ sent: 0, skipped: shadowSkipped, shadow: true, request_id: reqId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Apply skip marks (batched followers + each skip reason).
  await markBulk(supabase, batchedIds, "skipped", "batched");
  // invalid_token rows: self-heal the surfer token before marking.
  const invalidTokenIds = skipIdsByReason.get("invalid_token") ?? [];
  if (invalidTokenIds.length > 0) {
    const invalidSet = new Set(invalidTokenIds);
    const invalidRecipients = [...new Set(
      prepared.filter((p) => invalidSet.has(p.id)).map((p) => p.recipient_id),
    )];
    await supabase.from("surfers").update({ expo_push_token: null }).in("user_id", invalidRecipients);
  }
  for (const [reason, ids] of skipIdsByReason) await markBulk(supabase, ids, "skipped", reason as string);

  // ---- Bulk Expo send: ≤100-msg POSTs, tickets index-aligned (see notify-onboarding-blast) ----
  const messages = buildExpoMessages(toSend);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (EXPO_ACCESS_TOKEN) headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;

  const msgChunks = chunk(messages, EXPO_CHUNK);
  const rowChunks = chunk(toSend, EXPO_CHUNK);
  let sent = 0;
  const sentIds: string[] = [];
  const expoErrorIds: string[] = [];
  const unregisteredIds: string[] = [];
  const staleTokens: string[] = [];

  for (let c = 0; c < msgChunks.length; c++) {
    const batchMsgs = msgChunks[c];
    const batchRows = rowChunks[c];
    let resp: Response;
    try {
      resp = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers, body: JSON.stringify(batchMsgs),
      });
    } catch (err) {
      console.error(`[dispatch ${reqId}] Expo fetch threw for chunk ${c}:`, err);
      for (const r of batchRows) expoErrorIds.push(r.id);
      continue;
    }
    if (!resp.ok) {
      // Transient Expo failure (5xx / network). Don't lie about it as "sent".
      console.error(`[dispatch ${reqId}] Expo HTTP ${resp.status} for chunk ${c}`);
      for (const r of batchRows) expoErrorIds.push(r.id);
      continue;
    }
    const result = await resp.json().catch(() => ({}));
    const tickets = (result?.data ?? []) as { status?: string; details?: { error?: string } }[];
    for (let j = 0; j < batchRows.length; j++) {
      const ticket = tickets[j];
      const r = batchRows[j];
      if (!ticket) { expoErrorIds.push(r.id); continue; }
      if (ticket.status === "error") {
        if (ticket.details?.error === "DeviceNotRegistered") {
          unregisteredIds.push(r.id);
          staleTokens.push(r.token);
        } else {
          expoErrorIds.push(r.id);
        }
        continue;
      }
      sentIds.push(r.id);
      sent++;
    }
  }

  // Clear all dead tokens in one update.
  if (staleTokens.length > 0) {
    await supabase.from("surfers").update({ expo_push_token: null }).in("expo_push_token", staleTokens);
  }

  // Bulk-mark send results by status.
  await markBulk(supabase, sentIds, "sent", null);
  await markBulk(supabase, unregisteredIds, "skipped", "device_unregistered");
  await markBulk(supabase, expoErrorIds, "skipped", "expo_error");
  skipped += unregisteredIds.length + expoErrorIds.length;

  console.log(`[dispatch ${reqId}] sent=${sent} skipped=${skipped} drain=${drained.length} shadow=${SHADOW}`);
  return new Response(JSON.stringify({ sent, skipped, shadow: SHADOW, request_id: reqId }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
