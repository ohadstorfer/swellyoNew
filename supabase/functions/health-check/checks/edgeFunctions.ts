import type { Check } from "../types.ts";

// Only DEEP-tier checks remain. The SWEEP tier was removed entirely.
//
// WHY SWEEP WAS REMOVED:
// The SWEEP strategy relied on the assumption that functions deployed without auth
// would receive a 401 from the gateway before their handler runs. However,
// `verify_jwt` is configured per-function in the Supabase dashboard and is not
// verifiable from outside. If any sender/blast/mutation function were accidentally
// deployed without `verify_jwt`, a no-auth ping from this health check would
// trigger it (firing pushes, emails, or data mutations). The risk outweighs the
// benefit of "is the gateway alive?" checks — the DEEP tier already proves that.
//
// DEEP tier: request/response functions with no side effects on an invalid body.
// We pass service-role credentials so the handler runs past verify_jwt, then send
// a deliberately-invalid body so the handler validates, rejects, and returns ~400.
// This proves the handler code actually executes. Fail on 404 or >=500.
//
// Each ping has a ~5s AbortController timeout so a slow function cannot exhaust
// the overall 8s budget.

const DEEP = [
  "swelly-chat",
  "swelly-chat-demo",
  "swelly-trip-planning",
  "swelly-shaper",
  "estimate-trip-budget",
  "process-profile-video",
  "process-profile-video-s3",
  "lifestyle-image-query",
  "analytics-dashboard",
];

const PING_TIMEOUT_MS = 5000;

// Returns a failure string (`fn:reason`) or null if the function is healthy.
async function ping(
  base: string,
  fn: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ healthcheck: true }),
      signal: ac.signal,
    });
    await res.body?.cancel();
    if (res.status === 404) return `${fn}:404 (not deployed)`;
    if (res.status >= 500) return `${fn}:${res.status}`;
    return null;
  } catch (e) {
    if ((e as Error).name === "AbortError") return `${fn}:timeout (>${PING_TIMEOUT_MS}ms)`;
    return `${fn}:${e instanceof Error ? e.message : "network error"}`;
  } finally {
    clearTimeout(timer);
  }
}

export function edgeFunctionsCheck(): Check {
  return {
    name: "edge_functions",
    critical: false,
    run: async () => {
      const base = Deno.env.get("SUPABASE_URL")!;
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      // DEEP: pass service-role creds so the handler runs past verify_jwt.
      const deepHeaders = { authorization: `Bearer ${key}`, apikey: key };

      const results = await Promise.all(
        DEEP.map(async (fn) => {
          const r = await ping(base, fn, deepHeaders);
          // A cold start can take ~5s and trip the ping timeout even though the
          // function is healthy; retry once — the second hit lands on the warm
          // isolate. Only timeouts retry; 404/5xx are real failures.
          if (r === `${fn}:timeout (>${PING_TIMEOUT_MS}ms)`) {
            return ping(base, fn, deepHeaders);
          }
          return r;
        }),
      );

      const broken = results.filter((r): r is string => r !== null);
      if (broken.length) throw new Error(broken.join(", "));
    },
  };
}
