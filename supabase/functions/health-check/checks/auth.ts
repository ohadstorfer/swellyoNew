import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

// Validates the auth surfaces that real user login depends on:
//  1. Auth service health endpoint
//  2. Auth settings — Google OAuth must be enabled (it's the app's primary login)
//  3. Admin listUsers — secondary liveness assertion
//
// Apple sign-in is not checked here: it is not yet the primary mobile login path.
export function authCheck(): Check {
  return {
    name: "supabase_auth",
    critical: true,
    run: async () => {
      const url = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // --- 1. Auth service health ---
      {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4000);
        try {
          const res = await fetch(`${url}/auth/v1/health`, {
            headers: { apikey: anonKey },
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`auth health: HTTP ${res.status}`);
          await res.body?.cancel();
        } catch (e) {
          if ((e as Error).name === "AbortError") throw new Error("auth health: timeout");
          throw e;
        } finally {
          clearTimeout(timer);
        }
      }

      // --- 2. Auth settings — Google OAuth must be enabled ---
      {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4000);
        try {
          const res = await fetch(`${url}/auth/v1/settings`, {
            headers: { apikey: anonKey },
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`auth settings: HTTP ${res.status}`);
          // deno-lint-ignore no-explicit-any
          const json: any = await res.json();
          if (json?.external?.google !== true) {
            throw new Error("auth settings: Google OAuth is not enabled");
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw new Error("auth settings: timeout");
          throw e;
        } finally {
          clearTimeout(timer);
        }
      }

      // --- 3. Admin listUsers — secondary liveness assertion ---
      const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw new Error(`auth admin: ${error.message}`);
      if (!data?.users) throw new Error("auth admin returned no users array");
    },
  };
}
