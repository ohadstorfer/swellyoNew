import type { Check } from "../types.ts";

// Validates the Google dependency the app's place picker ACTUALLY uses: Places
// API (New) autocomplete (places.googleapis.com/v1/places:autocomplete). The app
// calls this from the destination/place pickers. We reuse GOOGLE_GEOCODING_API_KEY
// — confirmed to have Places API enabled — so no extra secret is needed.
//
// We distinguish key/billing failures (REQUEST_DENIED / 403, quota) from real
// outages so the alert is actionable.
export function googleGeocodeCheck(): Check {
  return {
    name: "google_geocode",
    critical: false,
    run: async () => {
      const key = Deno.env.get("GOOGLE_GEOCODING_API_KEY");
      if (!key) throw new Error("GOOGLE_GEOCODING_API_KEY not set");

      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": key },
        body: JSON.stringify({ input: "Tel Aviv" }),
      });

      if (!res.ok) {
        // 403 typically means the key/Places API is disabled, restricted, or billing is off.
        const body = await res.text();
        let detail = `places ${res.status}`;
        try {
          const j = JSON.parse(body);
          if (j?.error?.status || j?.error?.message) {
            detail += `: ${j.error.status ?? ""} ${String(j.error.message ?? "").slice(0, 120)}`;
          }
        } catch {
          /* non-JSON error body — status code is enough */
        }
        throw new Error(detail);
      }

      const json = await res.json();
      if (!Array.isArray(json?.suggestions) || json.suggestions.length === 0) {
        throw new Error("places: no suggestions returned");
      }
    },
  };
}
