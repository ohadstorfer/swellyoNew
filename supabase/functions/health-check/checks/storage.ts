import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

const REQUIRED_BUCKETS = ["profile-surf-videos", "message-images"];

export function storageCheck(): Check {
  return {
    name: "supabase_storage",
    critical: false,
    // This check makes 6 SEQUENTIAL round trips, so it is structurally the
    // slowest one. On 2026-07-09 ~01:00 UTC its runtime step-changed from
    // ~1.4s to ~4-6s and stayed there, with no code change on our side — the
    // other 9 checks were unaffected, and storage measured from outside the
    // edge runtime is still ~270ms/op. So the extra ~4s is on the edge
    // runtime -> Supabase Storage path, not something we introduced.
    //
    // 8s left almost no headroom over a 4-6s baseline, so normal jitter tripped
    // it 1-3x/day and emailed everyone. 15s restores the same ratio of headroom
    // the check had before the regression. This is noise suppression, NOT a
    // fix: if this ever needs raising again, find out which of the 6 ops is
    // slow first (per-op timing) instead of raising it a third time.
    timeoutMs: 15000,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // Create healthcheck bucket, only ignore "already exists" (409) errors.
      const { error: bucketErr } = await supabase.storage.createBucket("healthcheck", {
        public: false,
      });
      if (bucketErr) {
        const msg = bucketErr.message ?? "";
        // @ts-ignore: statusCode may exist on StorageError at runtime
        const code = (bucketErr as { statusCode?: string | number; status?: number }).statusCode ??
          // @ts-ignore
          (bucketErr as { status?: number }).status;
        const is409 = Number(code) === 409 || msg.toLowerCase().includes("already exists");
        if (!is409) throw new Error(`storage createBucket: ${msg}`);
      }

      // Unique path per run to avoid overlapping-run collisions.
      const path = `ping-${crypto.randomUUID()}.txt`;

      // Upload
      const up = await supabase.storage
        .from("healthcheck")
        .upload(path, new Blob(["ok"]), { upsert: true, contentType: "text/plain" });
      if (up.error) throw new Error(`storage upload: ${up.error.message}`);

      // Signed-URL read — exercises the real read path users rely on.
      const { data: signedData, error: signedErr } = await supabase.storage
        .from("healthcheck")
        .createSignedUrl(path, 60);
      if (signedErr || !signedData?.signedUrl) {
        throw new Error(`storage signedUrl: ${signedErr?.message ?? "no url returned"}`);
      }
      const fetchRes = await fetch(signedData.signedUrl);
      if (!fetchRes.ok) {
        throw new Error(`storage signed fetch ${fetchRes.status}: ${await fetchRes.text().catch(() => "")}`);
      }
      const body = await fetchRes.text();
      if (body.trim() !== "ok") {
        throw new Error(`storage signed body mismatch: ${body.slice(0, 80)}`);
      }

      // Remove the test object.
      const del = await supabase.storage.from("healthcheck").remove([path]);
      if (del.error) throw new Error(`storage remove: ${del.error.message}`);

      // Assert that real production buckets exist.
      const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
      if (listErr) throw new Error(`storage listBuckets: ${listErr.message}`);

      const names = new Set((buckets ?? []).map((b) => b.name));
      const missing = REQUIRED_BUCKETS.filter((b) => !names.has(b));
      if (missing.length > 0) {
        throw new Error(`storage: missing bucket(s): ${missing.join(", ")}`);
      }
    },
  };
}
