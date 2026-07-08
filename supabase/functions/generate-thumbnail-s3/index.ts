// generate-thumbnail-s3 — S3 twin of `generate-thumbnail`. Same ImageScript
// ladder/EXIF/OOM logic; reads the source from swellyo-images (public) and
// writes variants back to swellyo-images via presigned PUT. Invoked by the
// client after an upload and by the Phase-0 backfill script. Fail-safe: any
// decode/IO error returns 200 WITHOUT writing, so the client read path
// (<Thumb>) falls back to the original and the caller never retry-storms.
//
// Image lib: ImageScript (WASM/pure-TS). Pin deno.land/x 1.2.15 (NOT npm).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { generatePresignedUrl } from "./aws.ts";

const THUMB_SECRET = Deno.env.get("THUMBNAIL_SECRET") ?? "";
const S3_BASE = "https://swellyo-images.s3.us-east-1.amazonaws.com";

// Source prefixes mirror the Supabase bucket names (see plan Global Constraints).
const SOURCE_PREFIXES = new Set([
  "profile-images", "trip-images", "surftrip-images", "lifestyle-thumbnails",
]);
const HERO_PREFIXES = new Set(["trip-images", "surftrip-images"]);
const SQUARE_LADDER = [48, 320]; // keep in sync with src/services/media/thumbnails.ts
const WIDTH_VARIANT = 1280;
// Shrink source to this long edge BEFORE any clone → the OOM fix (see live fn).
const WORK_MAX_EDGE = WIDTH_VARIANT;
// Skip before decode above ~40 MP (RGBA = w*h*4 ≈ 160 MB); client falls back.
const MAX_DECODE_MEGAPIXELS = 40;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const publicUrl = (key: string) =>
  `${S3_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** HEAD the public variant URL to test existence (idempotency). */
async function variantExists(key: string): Promise<boolean> {
  const res = await fetch(publicUrl(key), { method: "HEAD" });
  return res.status === 200;
}

async function putJpeg(key: string, bytes: Uint8Array): Promise<void> {
  const url = await generatePresignedUrl("PUT", key, 3600, "image/jpeg");
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`PUT ${key} → ${res.status}`);
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
 * Read pixel dimensions from a JPEG's SOF marker without decoding (cheap header
 * scan). ImageScript decodes to uncompressed RGBA (w*h*4 bytes) and clones the
 * bitmap several times while laddering, so a high-megapixel source can OOM the
 * isolate even when the *compressed* file is small. Returns null for non-JPEG /
 * parse error (caller then relies on the byte guard).
 */
function readJpegDimensions(buf: Uint8Array): { w: number; h: number } | null {
  try {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (v.getUint16(0, false) !== 0xffd8) return null; // not a JPEG
    let o = 2;
    while (o + 8 <= v.byteLength) {
      if (v.getUint8(o) !== 0xff) { o++; continue; }
      const marker = v.getUint8(o + 1);
      // SOF0..SOF15 carry the frame dimensions, except DHT(C4)/JPG(C8)/DAC(CC).
      if (
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      ) {
        return { h: v.getUint16(o + 5, false), w: v.getUint16(o + 7, false) };
      }
      // Standalone markers (SOI/EOI/RSTn) have no length payload.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      o += 2 + v.getUint16(o + 2, false); // skip this segment by its length
    }
  } catch {
    /* malformed → unknown */
  }
  return null;
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
    const key = (body as { key?: string }).key;
    const force = (body as { force?: boolean }).force === true;
    if (!key) return ok({ skipped: true, reason: "bad_input" });

    const prefix = key.split("/")[0];
    if (!SOURCE_PREFIXES.has(prefix)) return ok({ skipped: true, reason: "bad_prefix" });

    // Cover photos are wide and never rendered as square avatars — skip squares.
    const isCover = key.includes("/cover-") || key.includes("cover-");
    const squareNames = isCover ? [] : SQUARE_LADDER.map((s) => `${key}__${s}.jpg`);
    // Wide `__1280w` variant: hero prefixes AND cover photos (both wide, rendered
    // full-width; the client reads them via toWidthThumbUrl). Covers get ONLY this.
    const widthName = (HERO_PREFIXES.has(prefix) || isCover) ? `${key}__${WIDTH_VARIANT}w.jpg` : null;
    const allNames = [...squareNames, ...(widthName ? [widthName] : [])];
    if (allNames.length === 0) return ok({ done: true, generated: 0, reason: "cover_no_square" });

    // Idempotency: bail before download/decode if everything already exists.
    const missing = new Set<string>();
    for (const n of allNames) if (force || !(await variantExists(n))) missing.add(n);
    if (missing.size === 0) return ok({ done: true, generated: 0 });

    const srcRes = await fetch(publicUrl(key));
    if (!srcRes.ok) return ok({ skipped: true, reason: "download_failed", status: srcRes.status });
    const srcBytes = new Uint8Array(await srcRes.arrayBuffer());
    if (srcBytes.length > 5_000_000) return ok({ skipped: true, reason: "too_large" });

    const dims = readJpegDimensions(srcBytes);
    if (dims && dims.w * dims.h > MAX_DECODE_MEGAPIXELS * 1_000_000) {
      return ok({ skipped: true, reason: "too_many_pixels", w: dims.w, h: dims.h });
    }

    let base: Image;
    try {
      base = await Image.decode(srcBytes);
    } catch {
      return ok({ skipped: true, reason: "not_decodable" });
    }

    applyExifOrientation(base, readExifOrientation(srcBytes));

    // Shrink working bitmap to WORK_MAX_EDGE on its long edge BEFORE any clone.
    const longEdge = Math.max(base.width, base.height);
    if (longEdge > WORK_MAX_EDGE) {
      if (base.width >= base.height) base.resize(WORK_MAX_EDGE, Image.RESIZE_AUTO);
      else base.resize(Image.RESIZE_AUTO, WORK_MAX_EDGE);
    }

    let generated = 0;

    if (!isCover) {
      const side = Math.min(base.width, base.height);
      const x = Math.floor((base.width - side) / 2);
      const y = Math.floor((base.height - side) / 2);
      const square = base.clone().crop(x, y, side, side); // ImageScript: crop(x,y,w,h)
      for (const s of SQUARE_LADDER) {
        const name = `${key}__${s}.jpg`;
        if (!missing.has(name)) continue;
        const dim = Math.min(s, side); // cap to source: never upscale
        const img = square.clone().resize(dim, dim);
        await putJpeg(name, await img.encodeJPEG(75));
        generated++;
      }
    }

    if (widthName && missing.has(widthName)) {
      const img = base.clone();
      if (img.width > WIDTH_VARIANT) img.resize(WIDTH_VARIANT, Image.RESIZE_AUTO);
      await putJpeg(widthName, await img.encodeJPEG(80));
      generated++;
    }

    return ok({ done: true, generated });
  } catch (e) {
    // Fail safe — never surface an error that would retry-storm the caller.
    return ok({ skipped: true, error: String(e) });
  }
});
