import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Check } from "../types.ts";

export function realtimeCheck(): Check {
  return {
    name: "realtime",
    critical: false,
    run: () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      return new Promise<void>((resolve, reject) => {
        let settled = false;

        const channel = supabase.channel("healthcheck", {
          config: { broadcast: { self: true } },
        });

        const cleanup = () => {
          supabase.removeChannel(channel).catch(() => {});
        };

        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn();
        };

        // Internal 6s timeout — fires before the outer 8s isolate timeout.
        const timer = setTimeout(() => {
          done(() => reject(new Error("realtime: no echo within 6s")));
        }, 6000);

        channel.on("broadcast", { event: "ping" }, () => {
          clearTimeout(timer);
          done(() => resolve());
        });

        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channel
              .send({
                type: "broadcast",
                event: "ping",
                payload: { t: Date.now() },
              })
              .catch((err: unknown) => {
                clearTimeout(timer);
                done(() =>
                  reject(
                    new Error(
                      `realtime: send failed: ${err instanceof Error ? err.message : String(err)}`,
                    ),
                  )
                );
              });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timer);
            done(() => reject(new Error(`realtime status: ${status}`)));
          }
        });
      });
    },
  };
}
