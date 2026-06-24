// Netlify Edge Function — inject per-trip Open Graph tags into the invite page.
//
// WHY: Link-preview crawlers (WhatsApp, iMessage, Telegram, Facebook) do NOT
// run JavaScript — they read the raw HTML <meta> tags only. index.html ships a
// fixed og:image (the Swellyo logo), so without this every shared trip shows
// the logo. This runs at the edge for `/?grouptrip=<id>`, fetches the trip's
// hero image + title from Supabase (anon RPC get_group_trip_invite_preview),
// and rewrites the OG/Twitter tags before the HTML reaches the crawler. The
// in-app / store redirect JS in index.html is left untouched.
//
// FAILS OPEN: any error (bad id, RPC down, non-HTML, cancelled trip) → original
// static HTML with the logo preview. The redirect must never break.

import type { Context } from "https://edge.netlify.com";

// Public values — the anon key already ships inside the mobile app bundle.
const SUPABASE_URL = "https://rfdhtvcmagsbxqntnepv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmZGh0dmNtYWdzYnhxbnRuZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDc3MTYsImV4cCI6MjA3ODI4MzcxNn0.4z4IEjIGpI1kHonQQnHnddF9vrSCHLveiJ64TMwTipk";

interface Preview {
  title: string | null;
  hero_image_url: string | null;
  host_display_name: string | null;
  member_count: number | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Downscale heavy hero photos via Supabase's image-transform (render) endpoint.
// Originals run ~800KB+; some WhatsApp versions silently drop thumbnails over
// ~600KB. width=1200 keeps OG-quality while landing well under that (a real
// 864KB hero comes back ~370KB). Only rewrites Supabase public-object URLs;
// anything else is passed through untouched.
function toPreviewImage(url: string): string {
  const marker = "/storage/v1/object/public/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const rendered =
    url.slice(0, i) +
    "/storage/v1/render/image/public/" +
    url.slice(i + marker.length);
  const sep = rendered.includes("?") ? "&" : "?";
  return `${rendered}${sep}width=1200&quality=80`;
}

export default async function handler(
  request: Request,
  context: Context,
): Promise<Response> {
  // Always serve the static page; we only *augment* it.
  const res = await context.next();

  try {
    const tripId = new URL(request.url).searchParams.get("grouptrip");
    if (!tripId || !UUID_RE.test(tripId)) return res;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return res;

    const rpc = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_group_trip_invite_preview`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ p_trip_id: tripId }),
      },
    );
    if (!rpc.ok) return res;

    const data = (await rpc.json()) as Preview;
    const rawImage = data?.hero_image_url;
    if (!rawImage) return res; // missing / cancelled trip → keep the logo preview
    const image = toPreviewImage(rawImage); // resize heavy heroes for previews

    const tripTitle = (data.title || "").trim() || "A Swellyo surf trip";
    const host = (data.host_display_name || "").trim();
    const n = typeof data.member_count === "number" ? data.member_count : null;

    const ogTitle = host
      ? `Join ${host}'s trip on Swellyo 🌊`
      : `Join ${tripTitle} on Swellyo 🌊`;
    const ogDesc =
      n && n > 0
        ? `${tripTitle} · ${n} ${n === 1 ? "person" : "people"} going. Tap to open in the Swellyo app.`
        : `${tripTitle} · Tap to open in the Swellyo app.`;

    const html = (await res.text())
      .replace(
        /(<meta\s+property="og:image"\s+content=")[^"]*(")/i,
        `$1${escAttr(image)}$2`,
      )
      .replace(
        /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/i,
        `$1${escAttr(image)}$2`,
      )
      .replace(
        /(<meta\s+property="og:title"\s+content=")[^"]*(")/i,
        `$1${escAttr(ogTitle)}$2`,
      )
      .replace(
        /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i,
        `$1${escAttr(ogTitle)}$2`,
      )
      .replace(
        /(<meta\s+property="og:description"\s+content=")[^"]*(")/i,
        `$1${escAttr(ogDesc)}$2`,
      )
      .replace(
        /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i,
        `$1${escAttr(ogDesc)}$2`,
      )
      // Drop the logo's fixed 768×768 dimensions — the hero image differs.
      .replace(/\s*<meta\s+property="og:image:(?:width|height)"[^>]*>/gi, "");

    const headers = new Headers(res.headers);
    headers.delete("content-length"); // body length changed
    headers.delete("content-encoding"); // body is now plain text, not gzipped
    headers.delete("etag"); // stale for the rewritten body
    headers.set("cache-control", "public, max-age=300");
    return new Response(html, { status: res.status, headers });
  } catch (_e) {
    // Fail open — never break the redirect because of a preview error.
    return res;
  }
}

export const config = { path: "/" };
