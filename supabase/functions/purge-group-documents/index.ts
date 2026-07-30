// ⚠️ MANUAL DEPLOY (CLI). Daily cron. Deletes traveler documents 30 days after
// a trip ends, and wipes the encrypted passport number with them.
//
// Until this shipped, nothing deleted anything -- the "we delete your file
// within 30 days" promise in the traveler disclosure was a document, not a
// behaviour. This is the job that makes it true.
//
// What it purges (three cases, one rule -- 30 days):
//   1. the trip ended more than 30 days ago
//   2. the uploader is no longer a participant, and the file is 30+ days old
//      (spec: "someone who leaves or is removed follows the same clock")
//   3. the document was rejected and the host's client-side delete did not
//      land, leaving an orphan file with rejected_at set
//
// What survives: the typed APIS fields (surname, given names, DOB, sex,
// nationality, issuing country, expiry) stay on the row so a repeat traveler
// does not retype them. The passport NUMBER does not -- it is wiped here,
// alongside the file. That is the deal that made storing it acceptable.
//
// The `<trip_id>/operator/` prefix is skipped entirely: waivers are the
// operator's own materials, not personal traveler data, and the waiver is the
// only legal record that someone agreed. Those rows live in
// organized_trip_operator_documents and are never touched by this job.
//
// Logs counts only. Never a path, never a URL, never a name.
// Spec: docs/specs/operator-trips/documents-storage.md §8
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "group-trip-documents";
const RETENTION_DAYS = 30;

// Supabase `.in()` degrades badly on long lists -- chunk every one of them.
const CHUNK = 100;
function chunk<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

serve(async (req) => {
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("ADMIN_FUNCTION_SECRET") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const bearerOk = SERVICE.length > 0 && authHeader === `Bearer ${SERVICE}`;
  if (!(expected.length > 0 && provided === expected) && !bearerOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const cutoffTs = cutoff.toISOString();

  type Doc = { id: string; trip_id: string; user_id: string; storage_path: string };
  const due = new Map<string, Doc>();   // id -> doc, so the three cases cannot double-count

  // ── case 1: trip ended more than 30 days ago ────────────────────────────
  const { data: endedTrips, error: tripErr } = await supabase
    .from("group_trips").select("id").lt("end_date", cutoffDate);
  if (tripErr) {
    console.error("purge: trip query failed", tripErr.message);
    return new Response(JSON.stringify({ error: "query failed" }), { status: 500 });
  }
  for (const ids of chunk((endedTrips ?? []).map((t) => t.id))) {
    const { data } = await supabase
      .from("organized_trip_travelers_documents")
      .select("id, trip_id, user_id, storage_path")
      .in("trip_id", ids)
      .is("file_deleted_at", null);
    for (const d of data ?? []) due.set(d.id, d as Doc);
  }

  // ── case 3 first (cheap, no join): rejected files that were never removed ──
  const { data: rejected } = await supabase
    .from("organized_trip_travelers_documents")
    .select("id, trip_id, user_id, storage_path, uploaded_at, rejected_at")
    .not("rejected_at", "is", null)
    .is("file_deleted_at", null);
  for (const d of rejected ?? []) {
    // Guard against eating a fresh file. A re-upload is supposed to clear
    // rejected_at, but if a client ever forgets to, the new file would look
    // like an orphan. A file uploaded AFTER the rejection is never an orphan.
    if (new Date(d.uploaded_at) > new Date(d.rejected_at)) continue;
    due.set(d.id, d as Doc);
  }

  // ── case 2: uploader is no longer a participant, file is 30+ days old ────
  // Checked per trip rather than per document: one membership query covers
  // every document in that trip.
  const { data: aged } = await supabase
    .from("organized_trip_travelers_documents")
    .select("id, trip_id, user_id, storage_path")
    .lt("uploaded_at", cutoffTs)
    .is("file_deleted_at", null);
  const agedByTrip = new Map<string, Doc[]>();
  for (const d of (aged ?? []) as Doc[]) {
    if (due.has(d.id)) continue;                    // already covered by case 1 or 3
    const list = agedByTrip.get(d.trip_id) ?? [];
    list.push(d);
    agedByTrip.set(d.trip_id, list);
  }
  for (const [tripId, docs] of agedByTrip) {
    const { data: members } = await supabase
      .from("group_trip_participants").select("user_id").eq("trip_id", tripId);
    const active = new Set((members ?? []).map((m) => m.user_id));
    for (const d of docs) if (!active.has(d.user_id)) due.set(d.id, d);
  }

  // ── delete the objects, then mark the rows ──────────────────────────────
  // Order matters: the object goes first. If the row update fails afterwards
  // the file is already gone and the next run retries the row -- harmless.
  // Marking first could leave a live file that nothing ever sweeps again.
  let deleted = 0, failed = 0;
  const docs = [...due.values()];

  for (const batch of chunk(docs, 50)) {
    const paths = batch.map((d) => d.storage_path).filter(Boolean);
    if (paths.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (rmErr) {
        // Do not log rmErr.message -- Supabase puts the object path in it.
        console.error(`purge: storage remove failed for ${paths.length} objects`);
        failed += batch.length;
        continue;
      }
    }
    const { error: updErr } = await supabase
      .from("organized_trip_travelers_documents")
      .update({ file_deleted_at: new Date().toISOString(), passport_number_enc: null })
      .in("id", batch.map((d) => d.id));
    if (updErr) {
      console.error("purge: row update failed", updErr.code ?? "");
      failed += batch.length;
      continue;
    }
    deleted += batch.length;
  }

  console.log(`purge-group-documents: deleted=${deleted} failed=${failed}`);
  return new Response(JSON.stringify({ deleted, failed }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
