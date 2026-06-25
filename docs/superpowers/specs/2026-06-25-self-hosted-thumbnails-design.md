# Self-hosted thumbnails — replace Supabase Storage Image Transformations

**Date:** 2026-06-25
**Status:** Built & deployed to prod 2026-06-25 (server live; client uncommitted)
**Author:** Ohad + Claude

## As-built deltas (deployed 2026-06-25)
- Square ladder is **[48, 320]** (768 dropped per Ohad). **Cap-to-source** instead of skip — never upscales, but the `__<size>.jpg` variant always exists so URLs don't 404. Sources **>5 MB skip** (ImageScript OOMs the isolate; uncatchable).
- Edge fn deployed **`--no-verify-jwt`**; the sole gate is the `x-thumb-secret` header (Vault `thumbnail_secret`). This project's Vault has **no `anon_key`**, so no Authorization is sent.
- The trigger function lives in **`public`** (even `postgres` lacks CREATE on the `storage` schema); `net.http_post` uses `timeout_milliseconds := 30000` (the 5 s default cut off the 4–12 s ImageScript runs).
- Backfill complete: **763 thumbs, 356/374 sources have `__320`** (lifestyle/trip/surftrip ~100%). The **18 misses are large (>5 MB)/corrupt legacy profile avatars** → client falls back to the original. New uploads are compressed at upload, so the tail won't grow.
- **EXIF orientation fix:** ImageScript ignores EXIF, so portrait photos (Orientation 6/8) came out rotated 90°. The fn now parses the EXIF Orientation tag and rotates before crop (orientation 6 → `rotate(270)`, since ImageScript rotate is CCW; verified). A `force:true` flag was added to bypass idempotency; all thumbnails were force-regenerated. Caveat: same-URL overwrite + 1-yr cache → clear the on-device image cache to re-verify.
- **Pending:** og-inject Netlify redeploy; client code commit.

## Problem

The Supabase Pro plan includes **100 Storage Image Transformations** per billing cycle, and
we exceeded it (101 / 100). The meter counts **distinct origin images transformed per cycle —
not requests, not sizes** (transforming one avatar at 24/96/144 px counts as 1). CDN cache hits
do not re-count; overage is **$5 per 1,000** origin images.

Because the meter scales with the number of **unique avatars + trip heroes** that get viewed as
thumbnails each month, it grows with our user/content base and will keep blowing past 100 forever.
The on-the-fly transform endpoint (`/storage/v1/render/image/...`) is the wrong primitive at scale.

Source: <https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations>

## Where it's used today

Three functions hit the billed `/render/image/` endpoint. Everything else (`getPublicUrl`, the
external `builder.io` URLs) is not a transform and does not count.

| # | Function | File | Transform | Shape | Volume |
|---|----------|------|-----------|-------|--------|
| 1 | `getStorageThumbUrl(url, size)` | `src/services/media/imageService.ts:562` | avatars + trip heroes → 24/96/144 px | **square cover** (`width=height&resize=cover`) | high, unbounded |
| 2 | `getLifestyleImageBucketUrlForFilename(file, size)` | `imageService.ts:541` | bounded allowlist of lifestyle images → 300 px | **square cover** | low/bounded |
| 3 | `toPreviewImage(url)` | `swellyo-invite-redirect/netlify/edge-functions/og-inject.ts:44` | shared trip hero → 1200 px | **width-bound, aspect-preserved** (og must be landscape) | low |

Call sites of `getStorageThumbUrl`: `NotificationCenter.tsx`, `trips/plan/PlanSections.tsx`,
`screens/trips/TripsScreen.tsx`, `screens/trips/TripMembersScreen.tsx`, `ConversationsScreen.tsx`.

Relevant existing facts:
- Avatars/covers are **already client-compressed** on upload (1024 / 2048 px, q≈0.85). Trip heroes
  are **not** compressed (`uploadToBucket` skips it → raw ~800 KB; matches the og-inject comment).
- Uploads use timestamped filenames + `cacheControl: '31536000'` (immutable, 1-yr cache).
- `pg_net` is enabled and is the established pattern for Postgres → Edge Function calls
  (health-check, notification dispatcher, onboarding cron all use `net.http_post`).
- A `lifestyle-thumbnails` bucket already exists (so a `-thumbnails` bucket convention exists), and
  `supabase/functions/backfill-lifestyle-images` is a precedent for one-time backfills.

## Chosen approach (approach 2 — pre-generate, server-side, background)

Stop calling `/render/image/` entirely. Generate fixed-size thumbnails **once, server-side, in the
background**, store them as plain static objects, and serve them via `getPublicUrl` (no transform →
the meter never moves). **The client upload path does not change at all**, so the uploader never
waits, by construction.

```
User uploads avatar/hero  ──►  Supabase Storage (original, unchanged)
                                      │
                    INSERT on storage.objects (image buckets, image/* only)
                                      │  net.http_post  ← async, non-blocking
                                      ▼
                       Edge fn: generate-thumbnail
                       • downloads original (service role)
                       • resizes to the fixed ladder (ImageScript)
                       • uploads to `image-thumbnails`, 1-yr cache
                       • idempotent (skip if exists); fails safe
                                      │
Client reads:  getStorageThumbUrl(url, 96)  ──►  static URL of the ladder thumb
               (if the thumb 404s — gen not finished / pre-backfill — <Thumb>
                falls back to the original via expo-image onError. Never broken.)
```

### Why server-trigger, not client-side generation
Client-side fire-and-forget would still need a server resizer for the backfill, can't produce the
og preview (runs in a Netlify edge, no RN libs), does work on the uploader's device, and is lost if
the app is killed mid-flight. The trigger path uses **one** resizer for new images, existing images,
*and* og — and leaves the client upload code untouched.

## Components

### 1. `image-thumbnails` storage bucket
Public read, service-role write. Thumb paths mirror the source so they're deterministic from the
original URL: `image-thumbnails/<sourceBucket>/<sourcePath>__<variant>.jpg`
(e.g. `image-thumbnails/profile-images/<userId>/avatar-123__320.jpg`).

### 2. `generate-thumbnail` edge function (Deno + ImageScript)
- Input: `{ bucket, path }` + a shared secret header. Reject if secret mismatch (prevents abuse that
  would run up storage/CPU). Mirrors the project's edge-fn auth hardening pattern.
- Download the original with the service-role client.
- Produce the ladder:
  - **Square cover** variants at **48 / 320 / 768 px** (used by all in-app thumbnails, which render
    square). Resize-to-fill + center-crop to a square.
  - **Width-bound** variant at **1280 px** (aspect preserved) — only for hero buckets
    (`trip-images`, `surftrip-images`), used by og previews. Skipped for avatars/lifestyle.
- Encode JPEG q≈75 (q≈80 for 1280w), upload to `image-thumbnails` with `cacheControl: '31536000'`.
- **Idempotent**: skip variants that already exist (so retries / backfill re-runs are cheap).
- **Fail safe**: any decode/resize error → log + return 200 without writing. The read path falls
  back to the original, so a generation failure never breaks display.
- Skip non-images (defensive: `profile-images` also holds video posters and may hold mp4s).

Ladder rationale (the "standard" ladder): 48 and ~1280 mirror Next.js's default
`imageSizes`/`deviceSizes`; 768 is the conventional tablet breakpoint; 320 covers a 96 px avatar at
~3× density. Tunable, but these cover every current slot with retina headroom.

### 3. Trigger on `storage.objects`
`AFTER INSERT` trigger, `WHEN`:
- `NEW.bucket_id IN ('profile-images','trip-images','surftrip-images','lifestyle-thumbnails')`
- `NEW.bucket_id <> 'image-thumbnails'` (no infinite loop)
- content-type is `image/%` (skip videos/audio)

Body: `net.http_post(<edge fn url>, body := {bucket, path}, headers := {secret})`. `pg_net` queues
the request and returns immediately → the upload is never blocked. INSERT-only is sufficient because
filenames are timestamped (every upload is a new path).

### 4. Client read-path swap
- `getStorageThumbUrl(url, size)` → if `url` is a Supabase public-object URL, return the
  `image-thumbnails` static URL at the nearest square ladder size ≥ requested (snap 24→48;
  96/144/300→320; >320→768). Non-Supabase URLs (Google avatars) returned unchanged.
- `getLifestyleImageBucketUrlForFilename(file, size)` → same, against `lifestyle-thumbnails` source.
- New shared **`<Thumb>`** wrapper (expo-image based): renders the thumb URL, and on `onError`
  swaps to the original (covers the post-upload gen window and any gen failure). Migrate the 5 call
  sites to it (they already hold the original URL alongside the thumb).
- `og-inject.ts` `toPreviewImage(url)` → point at the `__1280w` static thumb; keep the original as
  fallback if the rewrite can't apply.

### 5. One-time backfill
Invoke `generate-thumbnail` for every existing object in the four source buckets (a SQL loop over
`storage.objects` via `net.http_post`, or a small backfill edge fn mirroring
`backfill-lifestyle-images`). The function's idempotency makes this safe to re-run. This covers
current production avatars/heroes and makes og previews work for existing trips.

## Cost model after the change
- Image Transformations meter: **→ 0** (we never call `/render/image/` again).
- New costs: Edge Function invocations (2M/mo included on Pro; one invocation per uploaded image +
  one-time backfill) and `image-thumbnails` storage (~tens of KB per image × variants — trivial).
- Egress unchanged-to-lower (thumbnails are small static objects, long-cached).

## Risks & mitigations
- **Deno image resizing is the only new tech** (no precedent in repo). Mitigation: ImageScript is
  pure-TS, handles standard JPEG/PNG at our sizes; the function fails safe to the original so a bad
  decode never breaks the UI. If ImageScript proves unreliable in the edge runtime, fall back to
  `@imagemagick/magick-wasm`.
- **Gen window after upload** (seconds): `<Thumb>` onError fallback to original covers it.
- **Trigger abuse / loops**: secret-gated function + bucket/content-type `WHEN` filter excluding the
  thumbnails bucket.
- **Migrations are applied manually** (remote history frozen; never `supabase db push`). SQL is
  authored as files and applied by hand via the SQL editor.

## Out of scope
- Changing upload compression (heroes staying uncompressed is fine — thumbnails solve the read cost).
- Migrating to Cloudflare Images (revisit only if invocations/storage ever approach plan limits).
- Removing the `EXPO_PUBLIC_USE_V3_MATCHING`-style flags or any unrelated cleanup.
