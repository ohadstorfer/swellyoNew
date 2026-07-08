# Images → AWS S3 migration — design

**Date:** 2026-07-07
**Status:** Approved (design), pending spec review
**Author:** Ohad + Claude

## Goal & drivers

Move **all** app images off Supabase Storage onto AWS S3, to relieve Supabase
Storage **cost** and **quota headroom** (same account/region as the existing
video pipeline). Videos already run on S3 (`swellyo-videos`, acct
`128009599743`, `us-east-1`); this extends the same stack to images.

## Scope

**In scope (eventually — all image types, all sizes):**
- `profile-images` — avatars, covers, video posters (public)
- `trip-images` / `surftrip-images` — trip hero photos (public)
- `message-images` — chat photos (private, access-controlled)
- `image-thumbnails` — the generated 48 / 320 / 1280w variants (derivative)
- `Countries`, `lifestyle-thumbnails` — curated/static (low volume, migrate last)

**Rollout is staged and canary-first** (see Rollout). We do **not** flip
everything at once.

**Non-goals (for now):**
- CloudFront (deferred — direct public S3 URLs first; add when egress shows up).
- Lambda / EventBridge / any new AWS compute (explicitly avoided).
- Changing thumbnail sizes or the client compression pipeline.

## Chosen architecture (the mechanism)

Decided after a best-practice research pass. We take the research recommendation
verbatim **except** thumbnail generation, where we reuse our existing
server-side generator instead of moving generation client-side — because (a) we
already own a committed, EXIF-correct, OOM-hardened `generate-thumbnail` edge
fn, and (b) backfill forces a server generation path regardless, so a second
client-side generator would be two implementations that must match byte-for-byte.

### 1. Upload path — presigned PUT, direct to S3
- Client compresses as today **and caps the longest edge to ~2048px** (this is
  the real fix for the ImageScript OOM we hit on large photos — cap before any
  server touch).
- Client calls an edge fn (`sign-image-upload`) → gets a short-lived
  **presigned PUT** URL for a specific key.
- Client `PUT`s the original bytes **straight to S3** — bytes never transit the
  edge fn (no Deno isolate memory/CPU cost, no payload ceilings).
- Presigned **PUT** (not POST) to start; revisit POST only if upload abuse
  becomes real (client compression already bounds payloads).

### 2. Thumbnail generation — reuse `generate-thumbnail`, re-pointed at S3
- After a successful PUT, client **fire-and-forgets** a call to the re-pointed
  `generate-thumbnail` edge fn, which now **reads the source from S3 and writes
  the `__48`/`__320`/`__1280w` variants back to S3** (same magick-wasm code,
  S3 in/out instead of Supabase Storage in/out). The Supabase `storage.objects`
  trigger does **not** exist for S3 — the client call replaces it.
- The same edge fn path is invoked by the **backfill** script for existing
  objects (which have no client to regenerate them).
- OOM is already guarded server-side (megapixel pre-check + pre-shrink to 1280,
  deployed & verified); the new 2048px client cap makes it doubly safe.

### 3. Read path — public images (avatars, covers, trips)
- DB stores the **S3 URL** in the existing url column (we overwrite the Supabase
  URL with the S3 URL when an object is migrated). "Which store" is encoded in
  the **hostname** — no new `s3_key` column needed for public images.
- `toThumbUrl` / `toWidthThumbUrl` (`src/services/media/thumbnails.ts`) gain an
  **S3-aware branch**: recognize the S3 object URL and rewrite to the
  `…__<size>.jpg` variant key on S3, exactly as they do today for the Supabase
  `/storage/v1/object/public/` marker. Key convention is unchanged
  (`<prefix>/<path>.jpg__<size>.jpg`), so the derived-URL model is preserved.
- `<Thumb>` already falls back to the original if a variant isn't ready — keep.

### 4. Read path — private images (chat photos) — LATER PHASE
- Mirror **DM-video signing** exactly. Chat images store the **S3 key** (not a
  public URL). Client calls an edge fn `sign-image` that checks
  `conversation_members` for the convId parsed from the key, returns a
  **short-lived (5–15 min) presigned GET**, fetched at view time and **never
  persisted**. Bucket keeps chat images under a `chat/` prefix that is **not**
  covered by the public read policy (default-deny; only IAM-signed reads work).
- Deferred until after the public canary proves out.

### 5. Delivery / CDN
- **Direct public S3 URLs** for public images, versioned with the existing
  `?v=` / `?t=updated_at` cache-busting (change the URL, never invalidate).
- **CloudFront deferred.** S3→CloudFront same-region transfer is now $0, so
  adding it later is cost-neutral-or-better; not a launch blocker.

## AWS setup

- **New bucket `swellyo-images`** (acct `128009599743`, `us-east-1`).
  Separate from `swellyo-videos` for independent lifecycle/policies.
- **Prefixes:**
  - Public: `profile/`, `trip/`, `surftrip/`, `lifestyle/`, `country/`
  - Private: `chat/`
- **Bucket policy:** public `s3:GetObject` on the public prefixes only; `chat/`
  left default-deny so only `swellyo-admin` (IAM-signed) can read it — same
  shape as the video bucket's public/deny split.
- **CORS:** allow `PUT` + `GET` from the app origins (web + native fetch) for
  presigned uploads.
- Reuse the existing `swellyo-admin` IAM user + signing code already in the edge
  fns (`supabase/functions/health-check/aws.ts` has the S3 signing helpers).

## DB changes

- Public images: **no schema change** — overwrite the existing url column with
  the S3 URL on migration; provider detected by hostname. Rollback = point the
  url back to the still-present Supabase object during the grace period.
- Private (chat) images: store the S3 key (a later phase; may need a column or
  reuse the existing attachment field — decide when we get there).

## Migration strategy (dual-write / dual-read / verified delete)

1. **Cut new writes to S3** (per bucket, when that bucket goes live) — new
   uploads go only to S3; stop writing that type to Supabase Storage.
2. **Dual-read fallback** — read helpers handle **both** hostnames throughout,
   so nothing breaks mid-migration; no big-bang cutover moment.
3. **Background backfill** — rate-limited script: for each not-yet-migrated
   object, copy Supabase→S3, generate variants via the edge fn, overwrite the
   DB url. Idempotent, resumable.
4. **Verify before delete** — after backfill hits 100% for a type and a sample
   loads correctly, keep the old Supabase objects for a **2–4 week grace
   period**, then bulk-delete.

## Rollout (canary-first)

### Phase 0 — Ohad-only canary (TODAY, careful)
Scope: only rows/objects belonging to **Ohad Storfer's user** — his profile
image, cover image, and his group-trip hero image (public images only; his chat
photos deferred). Goal: prove the full mechanism end-to-end on one real user
with zero blast radius and **nothing deleted**.

Steps:
1. Create `swellyo-images` bucket + public policy + CORS (non-destructive).
2. Build `sign-image-upload` edge fn (presigned PUT). Re-point
   `generate-thumbnail` to read/write S3 (behind a flag or a separate deploy so
   the live Supabase-trigger version is untouched).
3. Add the S3-aware branch to `toThumbUrl` / `toWidthThumbUrl` (pure, unit-
   tested; Supabase path unchanged).
4. **Backfill only Ohad's objects**: copy his avatar/cover/poster + his
   surftrip/trip hero to S3, generate variants, then overwrite **only his** DB
   url columns with the S3 URLs. Leave everyone else on Supabase. Leave Ohad's
   Supabase originals in place (rollback = restore his url columns).
5. **Ohad verifies on-device**: profile, cover, trip hero, and all the places
   they render (Explore, conversations avatar, notifications, OG preview) look
   right at every size.

Rollback: set Ohad's url columns back to the Supabase URLs (objects still
there). One SQL statement.

### Phase 1 — profile-images, all users
New profile uploads → S3; backfill all users; grace; delete from Supabase.

### Phase 2 — trip-images / surftrip-images
Same pattern; update `og-inject.ts` `toPreviewImage` to the S3 host.

### Phase 3 — message-images (private)
Add `sign-image` (membership-checked presigned GET) + `chat/` prefix; new chat
uploads → S3; backfill; grace; delete.

### Phase 4 — curated (`Countries`, `lifestyle-thumbnails`) + final Supabase
Storage teardown.

## Safety constraints ("careful today")
- **Nothing is deleted** in Phase 0. Supabase originals stay.
- Phase 0 touches **only Ohad's rows** — verified by user id in every write.
- The live `generate-thumbnail` (Supabase-trigger) stays untouched; the S3
  variant runs as a separate deploy/flag until proven.
- No commits by Claude — Ohad reviews and commits.
- No CloudFront/Lambda/schema migrations today.

## Open questions
- Exact DB column names for cover / poster / trip hero (resolve in the plan by
  reading the callers of the upload fns).
- Whether the re-pointed `generate-thumbnail` should be a new fn
  (`generate-thumbnail-s3`) or a flagged branch in the existing one — lean new
  fn to keep the live Supabase path pristine during canary.
- Bucket key scheme for chat images vs the conversation-membership parse (Phase
  3 detail).
