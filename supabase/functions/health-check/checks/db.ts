import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

export function dbCheck(): Check {
  return {
    name: "supabase_db",
    critical: true,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // --- probe round-trip with guaranteed cleanup ---
      let probeId: string | null = null;
      try {
        const { data: ins, error: insErr } = await supabase
          .from("health_check_log")
          .insert({ source: "probe" })
          .select("id")
          .single();
        if (insErr) throw new Error(`db insert: ${insErr.message}`);
        if (!ins?.id) throw new Error("db insert returned no id");
        probeId = ins.id as string;

        const { data, error: selErr } = await supabase
          .from("health_check_log")
          .select("id")
          .eq("id", probeId)
          .single();
        if (selErr) throw new Error(`db select: ${selErr.message}`);
        if (!data) throw new Error("db select returned no row");

        // prove DELETE works too
        const { error: delErr } = await supabase
          .from("health_check_log")
          .delete()
          .eq("id", probeId);
        if (delErr) throw new Error(`db delete: ${delErr.message}`);
        // deleted successfully — clear the id so finally doesn't re-delete
        probeId = null;
      } finally {
        // if something threw before the delete, clean up now (best-effort)
        if (probeId !== null) {
          await supabase
            .from("health_check_log")
            .delete()
            .eq("id", probeId)
            .then(() => {}, () => {});
        }
      }

      // --- real-table read: catch schema breakage early ---
      // head:true + count:"exact" fetches zero rows but validates the table/column exist
      const { error: surferErr } = await supabase
        .from("surfers")
        .select("user_id", { head: true, count: "exact" })
        .limit(1);
      if (surferErr) throw new Error(`surfers read: ${surferErr.message}`);
    },
  };
}
