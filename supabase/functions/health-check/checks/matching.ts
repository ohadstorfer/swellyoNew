import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

// Verifies the matching SQL function (find_and_connect_matches) is intact and
// executable — WITHOUT side effects. We call it with a non-existent user id; a
// healthy function raises its own "Surfer not found" guard BEFORE the part that
// would INSERT a swelly_chat_history row. So hitting that specific guard error
// proves the function compiled and ran, and nothing was written. Any OTHER
// outcome (no error, or a different error) means the function is broken.
const NONEXISTENT_USER = "00000000-0000-0000-0000-000000000000";

export function matchingCheck(): Check {
  return {
    name: "matching",
    critical: false,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { error } = await supabase.rpc("find_and_connect_matches", {
        input_user_id: NONEXISTENT_USER,
      });
      if (!error) {
        throw new Error("matching: expected 'Surfer not found' guard, got success");
      }
      if (!error.message?.includes("Surfer not found")) {
        throw new Error(`matching rpc error: ${error.message}`);
      }
      // else: function executed and hit its own guard => healthy, no side effects
    },
  };
}
