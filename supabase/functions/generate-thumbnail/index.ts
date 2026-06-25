// generate-thumbnail — resize a freshly-uploaded image into a fixed ladder and
// store the variants as static objects in the `image-thumbnails` bucket. This
// replaces Supabase Storage Image Transformations (/render/image/), whose meter
// counts distinct origin images per cycle and does not scale with our content.
//
// Invoked async (pg_net) by an AFTER INSERT trigger on storage.objects, and by
// the one-time backfill (supabase/migrations/20260625000200_thumbnail_backfill.sql).
//
//   • Idempotent — skips variants that already exist, so retries / backfill
//     re-runs are cheap and decode is skipped when nothing is missing.
//   • Fail-safe — any decode/resize/IO error returns 200 WITHOUT writing. The
//     client read path (<Thumb>) falls back to the original, so a generation
//     failure never breaks display and never retry-storms the trigger.
//
// Image lib: ImageScript (WASM/pure-TS, no native deps — the only kind Supabase
// Edge Functions support). NOTE: pin the deno.land/x version (1.2.15), NOT the
// npm version (those version numbers differ). If ImageScript ever misbehaves in
// the edge runtime, the official Supabase example uses magick-wasm as a fallback:
// https://supabase.com/docs/guides/functions/examples/image-manipulation
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_SECRET = Deno.env.get("THUMBNAIL_SECRET") ?? "";

const THUMBS_BUCKET = "image-thumbnails";
const SOURCE_BUCKETS = new Set([
  "profile-images",
  "trip-images",
  "surftrip-images",
  "lifestyle-thumbnails",
]);
const HERO_BUCKETS = new Set(["trip-images", "surftrip-images"]);
const SQUARE_LADDER = [48, 320]; // keep in sync with src/services/media/thumbnails.ts
const WIDTH_VARIANT = 1280;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

/** True if the thumbnail object already exists (idempotency). */
async function thumbExists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const file = slash === -1 ? path : path.slice(slash + 1);
  const { data } = await admin.storage.from(THUMBS_BUCKET).list(dir, {
    search: file,
    limit: 1,
  });
  return !!data?.some((o) => o.name === file);
}

async function putJpeg(path: string, bytes: Uint8Array): Promise<void> {
  await admin.storage.from(THUMBS_BUCKET).upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: true,
    cacheControl: "31536000",
  });
}

/**
 * Read the EXIF Orientation tag (1-8) from a JPEG by scanning APP1 segments.
 * ImageScript is fully EXIF-unaware, so without this, portrait phone photos
 * (stored landscape + Orientation 6/8) come out rotated 90° in the thumbnail.
 * The EXIF APP1 segment is often NOT the first marker (JFIF/APP0 comes first),
 * so we walk all segments. Returns 1 for non-JPEG / missing tag / parse error.
 */
function readExifOrientation(buf: Uint8Array): number {
  try {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (v.getUint16(0, false) !== 0xffd8) return 1; // not a JPEG (e.g. PNG)
    let o = 2;
    while (o + 4 <= v.byteLength) {
      const marker = v.getUint16(o, false);
      if (marker === 0xffda) break; // start of scan — pixel data follows
      const len = v.getUint16(o + 2, false);
      if (
        marker === 0xffe1 && o + 10 <= v.byteLength &&
        v.getUint32(o + 4, false) === 0x45786966 && // "Exif"
        v.getUint16(o + 8, false) === 0x0000
      ) {
        const tiff = o + 10;
        const le = v.getUint16(tiff, false) === 0x4949; // II = little-endian
        const ifd = v.getUint32(tiff + 4, le);
        const n = v.getUint16(tiff + ifd, le);
        for (let i = 0; i < n; i++) {
          const tag = tiff + ifd + 2 + i * 12;
          if (v.getUint16(tag, le) === 0x0112) return v.getUint16(tag + 8, le);
        }
        break;
      }
      o += 2 + len;
    }
  } catch {
    /* malformed EXIF → treat as normal */
  }
  return 1;
}

/**
 * Normalize an ImageScript image to upright per its EXIF orientation.
 * ImageScript `rotate(deg)` is COUNTER-clockwise for positive deg, so a 90° CW
 * correction (orientation 6) is `rotate(270)`.
 */
function applyExifOrientation(img: Image, orientation: number): void {
  switch (orientation) {
    case 2: img.flip("horizontal"); break;
    case 3: img.rotate(180); break;
    case 4: img.flip("vertical"); break;
    case 5: img.flip("horizontal"); img.rotate(270); break;
    case 6: img.rotate(270); break;
    case 7: img.flip("horizontal"); img.rotate(90); break;
    case 8: img.rotate(90); break;
  }
}

serve(async (req) => {
  try {
    if (THUMB_SECRET && req.headers.get("x-thumb-secret") !== THUMB_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { bucket, path } = body as { bucket?: string; path?: string };
    const force = (body as { force?: boolean }).force === true; // regenerate even if exists
    if (!bucket || !path || !SOURCE_BUCKETS.has(bucket)) {
      return ok({ skipped: true, reason: "bad_input" });
    }

    // Cover photos are wide and never rendered as square avatars — skip them.
    const isCover = typeof path === "string" && path.includes("/cover-");
    const prefix = `${bucket}/${path}`;

    const squareNames = isCover ? [] : SQUARE_LADDER.map((s) => `${prefix}__${s}.jpg`);
    const widthName = HERO_BUCKETS.has(bucket) ? `${prefix}__${WIDTH_VARIANT}w.jpg` : null;
    const allNames = [...squareNames, ...(widthName ? [widthName] : [])];

    // Idempotency: bail before downloading/decoding if everything already exists.
    const missing = new Set<string>();
    for (const n of allNames) if (force || !(await thumbExists(n))) missing.add(n);
    if (missing.size === 0) return ok({ done: true, generated: 0 });

    const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
    if (dlErr || !blob) return ok({ skipped: true, reason: "download_failed" });
    const srcBytes = new Uint8Array(await blob.arrayBuffer());

    // ImageScript is pure-JS and decodes to uncompressed RGBA, so a very large
    // source OOMs the isolate (which can't be caught — it kills the worker).
    // Skip oversized sources cleanly; the client falls back to the original.
    // New uploads are compressed at upload time, so this is rare/legacy-only.
    if (srcBytes.length > 5_000_000) return ok({ skipped: true, reason: "too_large" });

    // ImageScript auto-detects JPEG/PNG. A non-image (e.g. mp4) throws → fail safe.
    let base: Image;
    try {
      base = await Image.decode(srcBytes);
    } catch {
      return ok({ skipped: true, reason: "not_decodable" });
    }

    // ImageScript ignores EXIF — bake the orientation in so portrait phone
    // photos aren't rotated 90° in the thumbnail. Applied to `base` before any
    // crop/resize so both the square ladder and the 1280w variant come out
    // upright. PNGs and orientation-1 JPEGs are no-ops.
    applyExifOrientation(base, readExifOrientation(srcBytes));

    let generated = 0;

    // Square cover variants: crop the centre square ONCE, then resize that
    // (smaller) square to each ladder size.
    if (!isCover) {
      const side = Math.min(base.width, base.height);
      const x = Math.floor((base.width - side) / 2);
      const y = Math.floor((base.height - side) / 2);
      const square = base.clone().crop(x, y, side, side); // ImageScript: crop(x,y,w,h)
      for (const s of SQUARE_LADDER) {
        const name = `${prefix}__${s}.jpg`;
        if (!missing.has(name)) continue;
        // Cap to the source size: never upscale, but the target-named variant
        // always exists (a <320px source yields a <320px __320.jpg), so the
        // client's URL never 404s for already-small images.
        const dim = Math.min(s, side);
        const img = square.clone().resize(dim, dim);
        await putJpeg(name, await img.encodeJPEG(75));
        generated++;
      }
    }

    // Width-bound variant (aspect preserved) for og previews — hero buckets only.
    if (widthName && missing.has(widthName)) {
      const img = base.clone();
      if (img.width > WIDTH_VARIANT) img.resize(WIDTH_VARIANT, Image.RESIZE_AUTO);
      await putJpeg(widthName, await img.encodeJPEG(80));
      generated++;
    }

    return ok({ done: true, generated });
  } catch (e) {
    // Fail safe — never surface an error that would retry-storm the trigger.
    return ok({ skipped: true, error: String(e) });
  }
});
