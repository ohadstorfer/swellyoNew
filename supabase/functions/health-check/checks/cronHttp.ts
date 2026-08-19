import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

// Never trust cron status as proof a job worked.
//
// pg_cron records `succeeded` the moment net.http_post fires; the 401/500 that
// comes BACK lands in net._http_response, which nothing watched. Twice that
// silence swallowed an outage whole:
//   · 18 Aug — the push dispatcher answered 500 every minute for nine hours.
//   · 7 Jun → 19 Aug — notify-abandoned-onboarding answered 401 hourly for 73
//     DAYS (a line-broken JWT in the job command). 1,753 "successful" runs,
//     zero reminders ever delivered.
// Both were diagnosed by finally reading the HTTP answers. This check reads
// them every hour, via the health_cron_http_failures RPC (SECURITY DEFINER —
// PostgREST does not expose the `net` schema).
//
// The 60-min window matches the hourly cadence: each run covers everything
// since the last. Timeouts get a small tolerance — the messages→push webhook
// trigger occasionally cold-starts past its 5s pg_net timeout, and that push
// is retried nowhere but also lost rarely; 3+ in one hour is a real problem.

const WINDOW_MINUTES = 60;
const TIMEOUT_TOLERANCE = 2;

type FailureRow = {
  status_code: number | null;
  timed_out: boolean;
  error_msg: string | null;
  body_head: string | null;
  created: string;
};

export function cronHttpCheck(): Check {
  return {
    name: "cron_http",
    critical: true,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      const { data, error } = await supabase.rpc("health_cron_http_failures", {
        window_minutes: WINDOW_MINUTES,
      });
      if (error) throw new Error(`rpc health_cron_http_failures: ${error.message}`);

      const rows = (data ?? []) as FailureRow[];
      const httpErrors = rows.filter((r) => r.status_code !== null && r.status_code >= 400);
      const timeouts = rows.filter((r) => r.status_code === null || r.timed_out);

      if (httpErrors.length > 0) {
        const sample = httpErrors
          .slice(0, 3)
          .map((r) => `${r.status_code} at ${r.created}: ${r.body_head ?? r.error_msg ?? "?"}`)
          .join(" | ");
        throw new Error(
          `${httpErrors.length} cron HTTP error(s) in ${WINDOW_MINUTES}m — ${sample}${httpErrors.length > 3 ? " | …" : ""}`,
        );
      }
      if (timeouts.length > TIMEOUT_TOLERANCE) {
        throw new Error(
          `${timeouts.length} pg_net timeouts in ${WINDOW_MINUTES}m (tolerance ${TIMEOUT_TOLERANCE}): ` +
            `${timeouts[0]?.error_msg ?? "?"}`,
        );
      }
      return timeouts.length > 0
        ? `clean (${timeouts.length} tolerated timeout(s))`
        : "all cron HTTP answers healthy";
    },
  };
}
