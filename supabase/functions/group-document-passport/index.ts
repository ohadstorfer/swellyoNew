// ⚠️ MANUAL DEPLOY (CLI). group-document-passport — read/write the typed APIS
// fields on a passport document row.
//
// WHY this is an Edge Function and not an RPC: the passport number is encrypted
// with a key that must NOT live in the database. AES-256-GCM, key in the
// DOCUMENT_ENCRYPTION_KEY function secret. A database dump therefore does not
// contain passport numbers -- it contains ciphertext and nothing that opens it.
//
// Everything else about access control is unchanged: the row is guarded by RLS
// (`otd_select`), the file by the storage policies in
// 20260724000300_operator_documents_bucket.sql. This function re-checks
// authorization itself because it runs under the service role, which bypasses
// both.
//
// Actions:
//   save    -- the traveler writes their own passport fields
//   reveal  -- the traveler, or a host of the trip, reads the number back
//
// Deliberately NOT here: view logging. Decided 2026-07-29 -- RLS is the gate,
// there is no audit trail. If that is revisited, this is the file to change.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_B64 = Deno.env.get("DOCUMENT_ENCRYPTION_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ── crypto ────────────────────────────────────────────────────────────────
// Format: "v1:<base64( iv[12] || ciphertext||tag )>". The version prefix is
// what makes key rotation possible later without guessing at old rows.
let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const raw = Uint8Array.from(atob(ENC_KEY_B64), (c) => c.charCodeAt(0));
    if (raw.length !== 32) {
      throw new Error("DOCUMENT_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    }
    keyPromise = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return keyPromise;
}

async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(),
      new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return `v1:${btoa(String.fromCharCode(...out))}`;
}

async function decrypt(stored: string): Promise<string> {
  if (!stored.startsWith("v1:")) throw new Error("unknown ciphertext version");
  const bytes = Uint8Array.from(atob(stored.slice(3)), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) }, await getKey(), bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

// ── validation ────────────────────────────────────────────────────────────
// Mirrors the CHECK constraints in 20260729000000_passport_apis_fields.sql.
// Duplicated on purpose: a 400 with a field name is a usable error, a 23514 is
// not. The constraints stay as the real floor.
const NAME_RE = /^[A-Z][A-Z ]*$/;
const ISO3_RE = /^[A-Z]{3}$/;
// Passport numbers vary by country: alphanumeric, 6-12 in practice. No
// country-specific rules -- rejecting a valid foreign passport is worse than
// accepting a typo the operator will see anyway.
const NUMBER_RE = /^[A-Z0-9]{5,15}$/;

type Fields = {
  surname?: string; givenNames?: string; dateOfBirth?: string;
  sex?: string; nationality?: string; issuingCountry?: string;
  expiryDate?: string; passportNumber?: string;
};

function validate(f: Fields): string | null {
  if (!f.surname || !NAME_RE.test(f.surname)) return "surname";
  if (!f.givenNames || !NAME_RE.test(f.givenNames)) return "givenNames";
  if (!f.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(f.dateOfBirth)) return "dateOfBirth";
  if (!f.sex || !["M", "F", "X"].includes(f.sex)) return "sex";
  if (!f.nationality || !ISO3_RE.test(f.nationality)) return "nationality";
  if (!f.issuingCountry || !ISO3_RE.test(f.issuingCountry)) return "issuingCountry";
  if (!f.expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(f.expiryDate)) return "expiryDate";
  if (!f.passportNumber || !NUMBER_RE.test(f.passportNumber)) return "passportNumber";

  // The CHECK constraint can only hold a static range (current_date is not
  // IMMUTABLE), so the "relative to today" rules live here.
  const today = new Date().toISOString().slice(0, 10);
  if (f.dateOfBirth >= today) return "dateOfBirth";     // born in the future
  if (f.expiryDate <= today) return "expiryDate";       // already expired
  return null;
}

serve(async (req) => {
  try {
    if (!ENC_KEY_B64) return json({ error: "server not configured" }, 500);

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return json({ error: "missing token" }, 401);
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action, documentId } = body as { action?: string; documentId?: string };
    if (!documentId) return json({ error: "bad input" }, 400);

    // One read of the row for both actions. Service role, so RLS does not apply
    // -- the checks below are the real gate.
    const { data: doc } = await admin
      .from("organized_trip_travelers_documents")
      .select("id, trip_id, user_id, passport_number_enc")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) return json({ error: "not found" }, 404);

    if (action === "save") {
      // Only the traveler fills in their own passport. A host approves or
      // rejects; a host never types someone else's details.
      if (doc.user_id !== user.id) return json({ error: "not your document" }, 403);

      const bad = validate(body as Fields);
      if (bad) return json({ error: "invalid field", field: bad }, 400);
      const f = body as Fields;

      const { error: updErr } = await admin
        .from("organized_trip_travelers_documents")
        .update({
          surname: f.surname,
          given_names: f.givenNames,
          date_of_birth: f.dateOfBirth,
          sex: f.sex,
          nationality: f.nationality,
          issuing_country: f.issuingCountry,
          expiry_date: f.expiryDate,
          passport_number_enc: await encrypt(f.passportNumber!),
        })
        .eq("id", documentId);
      if (updErr) return json({ error: "save failed" }, 500);

      // Many countries require the passport to stay valid for 6 months past the
      // return date. A warning, never a block -- plenty of destinations do not
      // require it, and guessing wrong would stop a legitimate traveler.
      const { data: trip } = await admin
        .from("group_trips").select("end_date").eq("id", doc.trip_id).maybeSingle();
      let expiryWarning = false;
      if (trip?.end_date) {
        const sixMonthsAfter = new Date(trip.end_date + "T00:00:00Z");
        sixMonthsAfter.setUTCMonth(sixMonthsAfter.getUTCMonth() + 6);
        expiryWarning = new Date(f.expiryDate + "T00:00:00Z") < sixMonthsAfter;
      }
      return json({ ok: true, expiryWarning });
    }

    if (action === "reveal") {
      // The owner, or any host of the trip -- the same rule the storage policy
      // applies to the file itself (can_access_group_document).
      let allowed = doc.user_id === user.id;
      if (!allowed) {
        const { data: host } = await admin
          .from("group_trip_participants")
          .select("user_id")
          .eq("trip_id", doc.trip_id)
          .eq("user_id", user.id)
          .eq("role", "host")
          .maybeSingle();
        allowed = !!host;
      }
      if (!allowed) return json({ error: "forbidden" }, 403);

      if (!doc.passport_number_enc) return json({ passportNumber: null });
      return json({ passportNumber: await decrypt(doc.passport_number_enc) });
    }

    return json({ error: "unknown action" }, 400);
  } catch (_e) {
    // Never echo the error: the message can carry a passport number or a path.
    return json({ error: "server error" }, 500);
  }
});
