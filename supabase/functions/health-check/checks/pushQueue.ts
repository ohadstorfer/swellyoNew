import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

// The 18 Aug outage, as a check.
//
// dispatch-notification-queue jammed on its first row for nine hours (the
// 'sending' claim violated the status CHECK) and every signal read healthy:
// the failing branch logged nothing, pg_cron said `succeeded`, the function
// itself said `booted`. The one observable symptom — rows sitting `pending`
// past their send_after while a 1-minute cron supposedly drains them — is what
// this reads.
//
//  - pending past send_after by >10 min → the dispatcher is not draining.
//    Deferrals are excluded by construction: quiet-hours and over-cap rows
//    carry a FUTURE send_after, so they never trip this.
//  - sending claimed >30 min ago → the unstick sweep (10-min cron) is broken
//    too; three sweep cycles have failed to return the row.

const PENDING_STALE_MINUTES = 10;
const SENDING_STALE_MINUTES = 30;

export function pushQueueCheck(): Check {
  return {
    name: "push_queue",
    critical: true,
    run: async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      const pendingCutoff = new Date(Date.now() - PENDING_STALE_MINUTES * 60 * 1000).toISOString();
      const { count: stuckPending, error: pendingErr } = await supabase
        .from("notification_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("send_after", pendingCutoff);
      if (pendingErr) throw new Error(`pending read: ${pendingErr.message}`);

      const sendingCutoff = new Date(Date.now() - SENDING_STALE_MINUTES * 60 * 1000).toISOString();
      const { count: stuckSending, error: sendingErr } = await supabase
        .from("notification_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "sending")
        .lt("claimed_at", sendingCutoff);
      if (sendingErr) throw new Error(`sending read: ${sendingErr.message}`);

      const pending = stuckPending ?? 0;
      const sending = stuckSending ?? 0;
      if (pending > 0 || sending > 0) {
        throw new Error(
          `${pending} row(s) pending past send_after >${PENDING_STALE_MINUTES}m (dispatcher not draining), ` +
            `${sending} row(s) stuck in sending >${SENDING_STALE_MINUTES}m (unstick sweep not returning them)`,
        );
      }
      return "queue draining";
    },
  };
}
