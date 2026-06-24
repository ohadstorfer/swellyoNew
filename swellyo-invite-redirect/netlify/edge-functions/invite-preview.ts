// Netlify Edge Function: inject per-trip Open Graph preview tags.
//
// WHY: WhatsApp / iMessage / Telegram build a link preview by fetching this
// page's HTML and reading its og:image / og:title tags — they never open the
// app. The static index.html ships a generic Swellyo logo as the default. When
// the shared link carries ?grouptrip=<id>, this function looks that trip up and
// rewrites the preview tags to the trip's own cover photo + title, so the chat
// preview shows the actual trip.
//
// Real users are unaffected: the page body and the redirect <script> are
// returned untouched — only the <head> preview tags change. Lookups use the
// Supabase service-role key (a server-side secret env var, never shipped to the
// client), so no public RLS change is needed and nothing extra is exposed.

import type { Config, Context } from "https://edge.netlify.com";

// These literals must match the defaults in index.html exactly — they are the
// strings we swap out. If you edit index.html's preview tags, update these too.
const DEFAULT_IMAGE = "https://swellyo-invite.netlify.app/swellyo-logo.png";
const DEFAULT_TITLE = "You're invited to a Swellyo Surftrip";
const DEFAULT_DESC = "Tap to open the trip in the Swellyo app.";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default async function handler(
  req: Request,
  context: Context,
): Promise<Response> {
  // Always start from the static asset so the redirect logic stays intact.
  const res = await context.next();

  const tripId = new URL(req.url).searchParams.get("grouptrip");
  if (!tripId) return res; // surftrip / no param → keep default logo preview

  const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
  const SERVICE_KEY = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return res; // misconfigured → safe fallback

  let trip:
    | {
        title: string | null;
        hero_image_url: string | null;
        destination_country: string | null;
        destination_area: string | null;
        destination_spot: string | null;
      }
    | null = null;

  try {
    const q =
      `${SUPABASE_URL}/rest/v1/group_trips?id=eq.${encodeURIComponent(tripId)}` +
      `&select=title,hero_image_url,destination_country,destination_area,destination_spot`;
    const r = await fetch(q, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (r.ok) {
      const rows = await r.json();
      trip = Array.isArray(rows) && rows.length ? rows[0] : null;
    }
  } catch (_e) {
    return res; // network error → safe fallback to the default preview
  }

  if (!trip || !trip.hero_image_url) return res;

  const image = trip.hero_image_url;
  const name = (trip.title || "").trim() || "a surf trip";
  const where = [
    trip.destination_spot,
    trip.destination_area,
    trip.destination_country,
  ].find((v) => v && v.trim());
  const title = `${name} on Swellyo`;
  const desc = where
    ? `A surf trip in ${where}. Tap to open it in the Swellyo app.`
    : DEFAULT_DESC;

  let html = await res.text();
  html = html
    .split(DEFAULT_IMAGE).join(image)
    .split(DEFAULT_TITLE).join(escapeHtml(title))
    .split(DEFAULT_DESC).join(escapeHtml(desc))
    // Hero photos are landscape, not the 768² logo — advertise a standard
    // large-image ratio so the preview renders as a wide card.
    .replaceAll(
      '<meta property="og:image:width" content="768" />',
      '<meta property="og:image:width" content="1200" />',
    )
    .replaceAll(
      '<meta property="og:image:height" content="768" />',
      '<meta property="og:image:height" content="630" />',
    );

  const headers = new Headers(res.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  // Body length/encoding changed after the rewrite — drop the stale values.
  headers.delete("content-length");
  headers.delete("content-encoding");
  // Let preview crawlers re-fetch within a few minutes if a host swaps the photo.
  headers.set("cache-control", "public, max-age=300");

  return new Response(html, { status: res.status, headers });
}

export const config: Config = { path: "/" };
