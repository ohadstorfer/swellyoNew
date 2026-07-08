# Images → S3, Phase 0 (Ohad canary) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate only Ohad Storfer's own public images (avatar, cover, group-trip hero) to a new `swellyo-images` S3 bucket end-to-end, proving the upload/generate/read mechanism with zero blast radius and nothing deleted.

**Architecture:** New `swellyo-images` S3 bucket (public-read on the mirrored source prefixes). A new `generate-thumbnail-s3` edge fn resizes S3 sources into S3 variants (same ImageScript/EXIF/OOM logic as the live `generate-thumbnail`, S3 I/O instead of Supabase). The client `toThumbUrl`/`toWidthThumbUrl` helpers gain an S3-aware branch so an S3 source URL derives its variant on S3. A one-off backfill copies Ohad's three objects Supabase→S3, generates variants, then flips only his DB URL columns.

**Tech Stack:** Supabase Edge Functions (Deno), ImageScript 1.2.15, AWS S3 (SigV4 presigned URLs), AWS CLI, React Native (TypeScript), Jest.

## Global Constraints

- **Account/region:** AWS `128009599743`, `us-east-1`, IAM user `swellyo-admin` (already `aws configure`d locally). Same account as `swellyo-videos`.
- **New bucket name:** `swellyo-images` (verbatim).
- **S3 key convention = mirror the Supabase bucket name as a prefix.** Source object key `= <supabaseBucket>/<supabasePath>` (e.g. `profile-images/<path>`, `surftrip-images/<path>`). Variant key `= <sourceKey>__<size>.jpg` (square) or `<sourceKey>__1280w.jpg` (hero width). Same suffix convention as today's `image-thumbnails` bucket, so the read helpers stay near-identical.
- **Ladder:** square `[48, 320]`, hero width `1280`. Keep in sync with `src/services/media/thumbnails.ts` and the live `generate-thumbnail`.
- **Cache version:** `THUMB_CACHE_VERSION = 2` (from `thumbnails.ts`); S3 variant URLs carry `?v=2`.
- **S3 base URL (client detection + construction):** `https://swellyo-images.s3.us-east-1.amazonaws.com`. Detect S3 image URLs by the substring `swellyo-images.s3` — **no new env var**, so the client change is OTA-safe.
- **NOTHING is deleted in Phase 0.** Supabase originals + Supabase thumbnails stay. Only Ohad's rows are touched.
- **No Claude commits** — Ohad reviews and commits. Steps show `git add`/`commit` for the record; Ohad runs them.
- **Live `generate-thumbnail` (Supabase-trigger) is untouched** — the S3 generator is a brand-new separate function.
- **Accepted canary side effect:** production shipped builds (without the new read-helper branch) will render Ohad's flipped images as the **full-size S3 original** (public, so it renders — just not thumbnailed) and og-inject will preview his trip hero at full size. Acceptable for one user; fully resolved when the client change ships/backfill completes.

---

### Task 1: Create the `swellyo-images` bucket (public-read source prefixes + CORS)

**Files:**
- Create: `scripts/s3/swellyo-images-bucket-policy.json`
- Create: `scripts/s3/swellyo-images-cors.json`

**Interfaces:**
- Produces: a public bucket `swellyo-images` in `us-east-1`; objects under `profile-images/*`, `trip-images/*`, `surftrip-images/*`, `lifestyle-thumbnails/*`, `Countries/*` are anonymously GET-able; `message-images/*` is NOT (default-deny, reserved for Phase 3).

- [ ] **Step 1: Create the bucket**

Run:
```bash
aws s3api create-bucket --bucket swellyo-images --region us-east-1
```
Expected: JSON with `"Location": "/swellyo-images"`. (us-east-1 needs no LocationConstraint.)

- [ ] **Step 2: Relax public-access block so a bucket policy can grant public read**

Run:
```bash
aws s3api put-public-access-block --bucket swellyo-images \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
```
Expected: no output (exit 0). (ACLs stay blocked; only a bucket *policy* can make objects public — same posture as `swellyo-videos`.)

- [ ] **Step 3: Write the bucket policy file**

Create `scripts/s3/swellyo-images-bucket-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadSourcePrefixes",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::swellyo-images/profile-images/*",
        "arn:aws:s3:::swellyo-images/trip-images/*",
        "arn:aws:s3:::swellyo-images/surftrip-images/*",
        "arn:aws:s3:::swellyo-images/lifestyle-thumbnails/*",
        "arn:aws:s3:::swellyo-images/Countries/*"
      ]
    }
  ]
}
```

- [ ] **Step 4: Apply the policy**

Run:
```bash
aws s3api put-bucket-policy --bucket swellyo-images \
  --policy file://scripts/s3/swellyo-images-bucket-policy.json
```
Expected: no output (exit 0).

- [ ] **Step 5: Write + apply CORS (presigned PUT from web/native, GET for reads)**

Create `scripts/s3/swellyo-images-cors.json`:
```json
{
  "CORSRules": [
    {
      "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedOrigins": ["*"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```
Run:
```bash
aws s3api put-bucket-cors --bucket swellyo-images \
  --cors-configuration file://scripts/s3/swellyo-images-cors.json
```
Expected: no output (exit 0).

- [ ] **Step 6: Verify — upload a probe object and fetch it publicly**

Run:
```bash
echo "ok" > /tmp/probe.txt
aws s3 cp /tmp/probe.txt s3://swellyo-images/profile-images/_probe.txt --content-type text/plain
curl -s -o /dev/null -w "%{http_code}\n" \
  https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/_probe.txt
```
Expected: `200`. Then confirm the private prefix is denied:
```bash
aws s3 cp /tmp/probe.txt s3://swellyo-images/message-images/_probe.txt --content-type text/plain
curl -s -o /dev/null -w "%{http_code}\n" \
  https://swellyo-images.s3.us-east-1.amazonaws.com/message-images/_probe.txt
```
Expected: `403`.

- [ ] **Step 7: Clean up probes**

Run:
```bash
aws s3 rm s3://swellyo-images/profile-images/_probe.txt
aws s3 rm s3://swellyo-images/message-images/_probe.txt
```

- [ ] **Step 8: Commit the policy/CORS files (Ohad runs)**

```bash
git add scripts/s3/swellyo-images-bucket-policy.json scripts/s3/swellyo-images-cors.json
git commit -m "chore(s3): swellyo-images bucket policy + CORS (images-to-s3 phase 0)"
```

---

### Task 2: S3-aware branch in `toThumbUrl` / `toWidthThumbUrl`

**Files:**
- Modify: `src/services/media/thumbnails.ts`
- Test: `src/services/media/__tests__/thumbnails.test.ts`

**Interfaces:**
- Consumes: existing `toThumbUrl(url, px, baseUrl?)`, `toWidthThumbUrl(url, width?, baseUrl?)`, `snapSquareSize`, `THUMB_CACHE_VERSION`, `THUMBNAILS_BUCKET`.
- Produces: same signatures, now also handling S3 (`swellyo-images.s3`) source URLs by appending the variant suffix in place. Behavior for Supabase URLs and non-Supabase URLs is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/media/__tests__/thumbnails.test.ts`:
```ts
import { toThumbUrl, toWidthThumbUrl, THUMB_CACHE_VERSION } from '../thumbnails';

const S3 = 'https://swellyo-images.s3.us-east-1.amazonaws.com';

describe('S3 source URLs', () => {
  const src = `${S3}/profile-images/u1/avatar-9.jpg`;

  it('toThumbUrl appends the square variant suffix in the same bucket', () => {
    expect(toThumbUrl(src, 96)).toBe(`${src}__320.jpg?v=${THUMB_CACHE_VERSION}`);
    expect(toThumbUrl(src, 24)).toBe(`${src}__48.jpg?v=${THUMB_CACHE_VERSION}`);
  });

  it('toWidthThumbUrl appends the width variant suffix', () => {
    const hero = `${S3}/surftrip-images/t1/hero-1.jpg`;
    expect(toWidthThumbUrl(hero, 1280)).toBe(`${hero}__1280w.jpg?v=${THUMB_CACHE_VERSION}`);
  });

  it('is idempotent — an already-variant S3 URL is returned unchanged', () => {
    const variant = `${src}__320.jpg?v=${THUMB_CACHE_VERSION}`;
    expect(toThumbUrl(variant, 96)).toBe(variant);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/services/media/__tests__/thumbnails.test.ts -t "S3 source URLs"`
Expected: FAIL (current code returns the S3 URL unchanged — the `OBJECT_MARKER` isn't present, so `toThumbUrl` returns `url` as-is, not the `__320.jpg` variant).

- [ ] **Step 3: Add the S3 branch to `thumbnails.ts`**

Add near the top, after `const OBJECT_MARKER = ...`:
```ts
// S3 image bucket (images-to-s3 migration). Variants live in the SAME bucket at
// `<sourceKey>__<size>.jpg`, so — unlike the Supabase path — there is no bucket
// swap: we just append the suffix. Detected by host substring (no env var, so
// this stays OTA-safe). Keep in sync with EXPLORE/scripts backfill key scheme.
const S3_IMAGES_MARKER = 'swellyo-images.s3';
const VARIANT_RE = /__(?:\d+|\d+w)\.jpg(?:\?|$)/;

/** Append a variant suffix to an S3 source URL, or return it unchanged if it
 *  is already a variant. `suffix` is e.g. `__320.jpg` or `__1280w.jpg`. */
const appendS3Variant = (url: string, suffix: string): string => {
  if (VARIANT_RE.test(url)) return url; // already a variant
  return `${url}${suffix}?v=${THUMB_CACHE_VERSION}`;
};
```

In `toThumbUrl`, add an S3 short-circuit **before** the `OBJECT_MARKER` lookup:
```ts
export const toThumbUrl = (
  url: string | null | undefined,
  px: number,
  baseUrl: string = defaultBase(),
): string | null => {
  if (!url) return null;
  if (url.includes(S3_IMAGES_MARKER)) return appendS3Variant(url, `__${snapSquareSize(px)}.jpg`);
  const i = url.indexOf(OBJECT_MARKER);
  // ...unchanged Supabase logic below...
```

In `toWidthThumbUrl`, add the same short-circuit:
```ts
export const toWidthThumbUrl = (
  url: string | null | undefined,
  width: number = WIDTH_VARIANT,
  baseUrl: string = defaultBase(),
): string | null => {
  if (!url) return null;
  if (url.includes(S3_IMAGES_MARKER)) return appendS3Variant(url, `__${width}w.jpg`);
  const i = url.indexOf(OBJECT_MARKER);
  // ...unchanged Supabase logic below...
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/services/media/__tests__/thumbnails.test.ts`
Expected: PASS (new S3 block + all existing Supabase/non-Supabase tests still green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `thumbnails.ts`.

- [ ] **Step 6: Commit (Ohad runs)**

```bash
git add src/services/media/thumbnails.ts src/services/media/__tests__/thumbnails.test.ts
git commit -m "feat(media): S3-aware thumbnail URL derivation (images-to-s3 phase 0)"
```

---

### Task 3: `generate-thumbnail-s3` edge function

**Files:**
- Create: `supabase/functions/generate-thumbnail-s3/index.ts`
- Create: `supabase/functions/generate-thumbnail-s3/aws.ts` (copy of `health-check/aws.ts`, bucket-parameterized)

**Interfaces:**
- Consumes: env secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (already set for the video fn), `THUMBNAIL_SECRET` (already set). Bucket hardcoded to `swellyo-images`.
- Produces: `POST { key: string, force?: boolean }` where `key` is the S3 source key (e.g. `profile-images/<path>`). Reads the public source, writes `<key>__48.jpg`/`__320.jpg` (square, unless cover) and `<key>__1280w.jpg` (hero prefixes only) to `swellyo-images`. Returns `{ done, generated }` or `{ skipped, reason }`. Fail-safe (never throws to caller).

- [ ] **Step 1: Copy + parameterize the signer**

Create `supabase/functions/generate-thumbnail-s3/aws.ts` as a copy of `supabase/functions/health-check/aws.ts`, with two changes: hardcode the bucket and drop the env fallback to the video bucket. Replace line 4 and line 41:
```ts
// line 4 →
const AWS_S3_BUCKET = 'swellyo-images'
```
(The rest of `generatePresignedUrl` is unchanged and already supports `'PUT'` with `contentType`.)

- [ ] **Step 2: Write the edge function**

Create `supabase/functions/generate-thumbnail-s3/index.ts`. It reuses the proven ImageScript resize/EXIF/OOM logic from `generate-thumbnail` verbatim; only the I/O (source read + variant write + existence check) is swapped from Supabase Storage to S3.
```ts
// generate-thumbnail-s3 — S3 twin of `generate-thumbnail`. Same ImageScript
// ladder/EXIF/OOM logic; reads the source from swellyo-images (public) and
// writes variants back to swellyo-images via presigned PUT. Invoked by the
// client after an upload and by the Phase-0 backfill script. Fail-safe.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { generatePresignedUrl } from "./aws.ts";

const THUMB_SECRET = Deno.env.get("THUMBNAIL_SECRET") ?? "";
const S3_BASE = "https://swellyo-images.s3.us-east-1.amazonaws.com";

const SOURCE_PREFIXES = new Set([
  "profile-images", "trip-images", "surftrip-images", "lifestyle-thumbnails",
]);
const HERO_PREFIXES = new Set(["trip-images", "surftrip-images"]);
const SQUARE_LADDER = [48, 320];
const WIDTH_VARIANT = 1280;
const WORK_MAX_EDGE = WIDTH_VARIANT;
const MAX_DECODE_MEGAPIXELS = 40;

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

/** HEAD the public variant URL to test existence (idempotency). */
async function variantExists(key: string): Promise<boolean> {
  const res = await fetch(`${S3_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "HEAD",
  });
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

// ── EXIF + dimension helpers: copy VERBATIM from generate-thumbnail/index.ts ──
//   readExifOrientation, readJpegDimensions, applyExifOrientation
//   (paste the three functions unchanged from lines 87-170 of that file).

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

    const isCover = key.includes("/cover-") || key.includes("cover-");
    const squareNames = isCover ? [] : SQUARE_LADDER.map((s) => `${key}__${s}.jpg`);
    const widthName = HERO_PREFIXES.has(prefix) ? `${key}__${WIDTH_VARIANT}w.jpg` : null;
    const allNames = [...squareNames, ...(widthName ? [widthName] : [])];
    if (allNames.length === 0) return ok({ done: true, generated: 0, reason: "cover_no_square" });

    const missing = new Set<string>();
    for (const n of allNames) if (force || !(await variantExists(n))) missing.add(n);
    if (missing.size === 0) return ok({ done: true, generated: 0 });

    const srcRes = await fetch(`${S3_BASE}/${key.split("/").map(encodeURIComponent).join("/")}`);
    if (!srcRes.ok) return ok({ skipped: true, reason: "download_failed", status: srcRes.status });
    const srcBytes = new Uint8Array(await srcRes.arrayBuffer());
    if (srcBytes.length > 5_000_000) return ok({ skipped: true, reason: "too_large" });

    const dims = readJpegDimensions(srcBytes);
    if (dims && dims.w * dims.h > MAX_DECODE_MEGAPIXELS * 1_000_000) {
      return ok({ skipped: true, reason: "too_many_pixels", w: dims.w, h: dims.h });
    }

    let base: Image;
    try { base = await Image.decode(srcBytes); }
    catch { return ok({ skipped: true, reason: "not_decodable" }); }

    applyExifOrientation(base, readExifOrientation(srcBytes));
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
      const square = base.clone().crop(x, y, side, side);
      for (const s of SQUARE_LADDER) {
        const name = `${key}__${s}.jpg`;
        if (!missing.has(name)) continue;
        const dim = Math.min(s, side);
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
    return ok({ skipped: true, error: String(e) });
  }
});
```
Then paste `readExifOrientation`, `readJpegDimensions`, `applyExifOrientation` verbatim from `generate-thumbnail/index.ts` (lines 87–170) where the comment marks.

- [ ] **Step 3: Deploy (no Docker needed; `--no-verify-jwt` so the secret is the sole gate)**

Run:
```bash
supabase functions deploy generate-thumbnail-s3 --no-verify-jwt
```
Expected: `Deployed Function generate-thumbnail-s3`. (CLI is logged in; project linked in `supabase/.temp/project-ref`. Deploy works despite any "Docker not running" warning — see memory `project_self_hosted_thumbnails`.)

- [ ] **Step 4: Verify against a real S3 source (uses the probe from Task 1 pattern)**

Upload a small real JPEG to a source prefix, invoke the fn, confirm the `__320.jpg` variant appears. Get the function URL + secret from the Supabase dashboard (`THUMBNAIL_SECRET`), then:
```bash
# put a test jpeg (any small jpg on disk)
aws s3 cp ./some-test.jpg s3://swellyo-images/profile-images/_t/test.jpg --content-type image/jpeg
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/generate-thumbnail-s3" \
  -H "x-thumb-secret: <THUMBNAIL_SECRET>" -H "Content-Type: application/json" \
  -d '{"key":"profile-images/_t/test.jpg","force":true}'
```
Expected: `{"done":true,"generated":2}`. Confirm the variant is public:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/_t/test.jpg__320.jpg
```
Expected: `200`. Then clean up: `aws s3 rm s3://swellyo-images/profile-images/_t/ --recursive`.

- [ ] **Step 5: Commit (Ohad runs)**

```bash
git add supabase/functions/generate-thumbnail-s3
git commit -m "feat(edge): generate-thumbnail-s3 (S3 twin of generate-thumbnail)"
```

---

### Task 4: Backfill Ohad's three objects to S3 + generate variants

**Files:**
- Create: `scripts/s3/backfill-ohad-images.sh`

**Interfaces:**
- Consumes: Task 1 bucket, Task 3 fn. Ohad's current Supabase image URLs (discovered in Step 1).
- Produces: Ohad's avatar/cover/trip-hero originals + variants present in `swellyo-images`. **No DB writes here** (that's Task 5). No deletes.

- [ ] **Step 1: Discover Ohad's current image URLs (read-only)**

Run (Supabase SQL editor, or MCP `execute_sql` — read-only) and record the three URLs + his `user_id` and group-trip id:
```sql
select id, profile_image_url, profile_cover_url
from surfers
where email = 'ohad.storfer@gmail.com';
-- his hosted group trip hero:
select id, image_url
from group_trips
where host_id = '<ohad_user_id>'
order by created_at desc;
```
Note the exact Supabase object paths (everything after `/storage/v1/object/public/<bucket>/`). Column names may differ (`profile_cover_url` / `cover_image_url`, `group_trips.image_url` / `hero_image_url`) — use whatever the query returns.

- [ ] **Step 2: Write the backfill script**

Create `scripts/s3/backfill-ohad-images.sh`. Fill the three `SUPA_*` paths from Step 1. It downloads each Supabase public object, uploads it to the mirrored S3 key, then invokes `generate-thumbnail-s3`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SUPA_BASE="https://<project-ref>.supabase.co/storage/v1/object/public"
FN="https://<project-ref>.supabase.co/functions/v1/generate-thumbnail-s3"
SECRET="<THUMBNAIL_SECRET>"

# "<supabaseBucket>/<path>" pairs — the S3 key mirrors this exactly.
KEYS=(
  "profile-images/<ohad-avatar-path>.jpg"
  "profile-images/<ohad-cover-path>.jpg"
  "surftrip-images/<ohad-trip-hero-path>.jpg"
)

tmp="$(mktemp -d)"
for key in "${KEYS[@]}"; do
  echo "→ $key"
  curl -fsSL "$SUPA_BASE/$key" -o "$tmp/obj.jpg"
  aws s3 cp "$tmp/obj.jpg" "s3://swellyo-images/$key" --content-type image/jpeg \
    --cache-control "public, max-age=31536000"
  curl -fsS -X POST "$FN" -H "x-thumb-secret: $SECRET" \
    -H "Content-Type: application/json" -d "{\"key\":\"$key\",\"force\":true}"
  echo
done
rm -rf "$tmp"
echo "done"
```

- [ ] **Step 3: Run it**

Run:
```bash
bash scripts/s3/backfill-ohad-images.sh
```
Expected: each key prints an upload line and a JSON `{"done":true,"generated":N}` (avatar → 2, cover → 0 `cover_no_square`, trip hero → 3 incl. `__1280w`).

- [ ] **Step 4: Verify all objects + variants are public and load**

Run:
```bash
for key in \
  "profile-images/<ohad-avatar-path>.jpg" \
  "profile-images/<ohad-avatar-path>.jpg__320.jpg" \
  "profile-images/<ohad-cover-path>.jpg" \
  "surftrip-images/<ohad-trip-hero-path>.jpg" \
  "surftrip-images/<ohad-trip-hero-path>.jpg__320.jpg" \
  "surftrip-images/<ohad-trip-hero-path>.jpg__1280w.jpg"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://swellyo-images.s3.us-east-1.amazonaws.com/$(echo "$key" | sed 's/ /%20/g')")
  echo "$code  $key"
done
```
Expected: `200` for every line.

- [ ] **Step 5: Commit the script (Ohad runs)**

```bash
git add scripts/s3/backfill-ohad-images.sh
git commit -m "chore(s3): Ohad-canary image backfill script (images-to-s3 phase 0)"
```

---

### Task 5: Flip Ohad's DB URLs to S3 + on-device verification

**Files:**
- Create: `scripts/s3/flip-ohad-urls.sql`
- Create: `scripts/s3/rollback-ohad-urls.sql`

**Interfaces:**
- Consumes: Task 4 objects in S3, Task 2 client read helpers. Ohad's row ids/columns from Task 4 Step 1.
- Produces: Ohad's `profile_image_url`, cover, and trip-hero columns now point at `https://swellyo-images.s3.us-east-1.amazonaws.com/<mirrored-key>`. Fully reversible.

- [ ] **Step 1: Write the flip SQL (fill exact columns/ids/paths from Task 4 Step 1)**

Create `scripts/s3/flip-ohad-urls.sql`:
```sql
-- Ohad canary: point ONLY his rows at S3. Reversible via rollback-ohad-urls.sql.
-- The S3 base + mirrored key match the backfill; the client read helpers derive
-- the __<size>.jpg variants on the fly.
update surfers set
  profile_image_url = 'https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/<ohad-avatar-path>.jpg',
  profile_cover_url = 'https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/<ohad-cover-path>.jpg'
where email = 'ohad.storfer@gmail.com';

update group_trips set
  image_url = 'https://swellyo-images.s3.us-east-1.amazonaws.com/surftrip-images/<ohad-trip-hero-path>.jpg'
where id = '<ohad-group-trip-id>';
```

- [ ] **Step 2: Write the rollback SQL (capture the ORIGINAL Supabase URLs from Task 4 Step 1)**

Create `scripts/s3/rollback-ohad-urls.sql`:
```sql
-- Revert the canary: point Ohad's rows back at the Supabase originals (still present).
update surfers set
  profile_image_url = '<original-supabase-avatar-url>',
  profile_cover_url = '<original-supabase-cover-url>'
where email = 'ohad.storfer@gmail.com';

update group_trips set
  image_url = '<original-supabase-trip-hero-url>'
where id = '<ohad-group-trip-id>';
```

- [ ] **Step 3: Apply the flip**

Run `scripts/s3/flip-ohad-urls.sql` in the Supabase SQL editor (manual apply — never `db push`, per memory `project_migrations_applied_manually`). Expected: `UPDATE 1` for each statement.

- [ ] **Step 4: On-device verification (Ohad)**

With the Task-2 client change running locally (Expo), confirm every render surface of Ohad's images is correct at every size:
- Profile screen — avatar + cover load, correct orientation, sharp.
- Explore — his group trip hero card loads (thumbnail).
- Conversations / group avatar — his avatar thumbnail loads (no silhouette).
- Notifications bell — his avatar thumbnail loads.
- Trip detail — hero loads.
- Network tab / logs: image requests hit `swellyo-images.s3...` and return 200; variant URLs end in `__48/__320/__1280w.jpg?v=2`.

If anything is wrong → run `scripts/s3/rollback-ohad-urls.sql` (instant revert) and debug before proceeding.

- [ ] **Step 5: Commit the SQL artifacts (Ohad runs)**

```bash
git add scripts/s3/flip-ohad-urls.sql scripts/s3/rollback-ohad-urls.sql
git commit -m "chore(s3): Ohad-canary URL flip + rollback SQL (images-to-s3 phase 0)"
```

---

## Definition of done (Phase 0)

- `swellyo-images` bucket live; public prefixes readable, `message-images/*` denied.
- `generate-thumbnail-s3` deployed and generating correct, upright variants.
- Client derives S3 variants; Supabase path unchanged; all thumbnail tests green.
- Ohad's avatar/cover/trip-hero serve from S3 with variants; verified on-device.
- Nothing deleted; one-statement rollback proven to exist.
- **Gate to Phase 1:** Ohad confirms it all looks right → then generalize (new-upload presigned-PUT wiring + fleet backfill per the spec's Phase 1+).

## Self-review notes

- **Spec coverage:** upload path (presigned PUT) is intentionally **deferred to Phase 1** — the canary migrates *existing* objects (backfill uses direct `swallyo-admin` `aws s3 cp`, no presigned PUT needed), so `sign-image-upload` is not built today. This is a deliberate scope trim for "careful today," noted here so it isn't mistaken for a gap. Private/chat signing = Phase 3. CloudFront = deferred. All other spec mechanism elements (S3 bucket, S3 generator, S3 read path, dual-read via hostname, verified-no-delete) are implemented in Tasks 1–5.
- **Placeholder scan:** the only `< >` placeholders are runtime values (Ohad's user id, object paths, project-ref, `THUMBNAIL_SECRET`) discovered in Task 4 Step 1 — these are data, not undefined code.
- **Type consistency:** `key`-based contract for `generate-thumbnail-s3` (not `{bucket,path}` like the Supabase fn) is used consistently in Tasks 3 & 4. Variant suffix scheme (`__<size>.jpg`, `__1280w.jpg`, `?v=2`) matches between the read helper (Task 2) and the generator (Task 3).
