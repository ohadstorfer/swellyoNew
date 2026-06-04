import type { Check } from "../types.ts";

// Reachability + account-auth check — does NOT send a real push.
//
// We POST an obviously-invalid token. Expo returns HTTP 200 with a per-ticket
// error under json.data[].status = "error" for a bad token. That is the EXPECTED
// outcome and counts as a PASS — it proves the API is reachable and our request
// is structurally valid.
//
// We FAIL on:
//   - HTTP >= 500 (server error)
//   - Network error
//   - Top-level auth/account problem in the JSON response:
//       json.errors array present (API-level error, not per-ticket)
//       json.code is "UNAUTHENTICATED" or "UNAUTHORIZED"
//
// NOTE: Without EXPO_ACCESS_TOKEN we cannot validate FCM/APNs credentials —
// this check only proves the Expo Push API is reachable and not account-auth-broken.
export function expoPushCheck(): Check {
  return {
    name: "expo_push",
    critical: false,
    run: async () => {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: "ExponentPushToken[healthcheck]", title: "noop" }),
      });

      if (res.status >= 500) throw new Error(`expo ${res.status}`);

      // Parse the response to detect account/auth problems at the API level.
      // deno-lint-ignore no-explicit-any
      let json: any;
      try {
        json = await res.json();
      } catch {
        // Non-JSON body on a non-5xx is unusual but not an auth failure — pass.
        return;
      }

      // Top-level errors array indicates an API-level (account/auth) rejection,
      // distinct from the per-ticket data[].status errors we expect for bad tokens.
      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        const detail = json.errors.map((e: { message?: string }) => e?.message ?? String(e)).join("; ");
        throw new Error(`expo API error: ${detail}`);
      }

      // Top-level code indicating auth/account rejection
      const code: string | undefined = json?.code;
      if (code === "UNAUTHENTICATED" || code === "UNAUTHORIZED") {
        throw new Error(`expo auth rejected: ${code}`);
      }

      // Per-ticket error in data[].status === "error" → EXPECTED, do not fail.
      // Example: { data: [{ status: "error", message: "...", details: { error: "DeviceNotRegistered" } }] }
    },
  };
}
