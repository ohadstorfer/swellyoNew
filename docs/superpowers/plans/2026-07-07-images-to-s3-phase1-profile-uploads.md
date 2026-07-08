# Images → S3, Phase 1 (profile-images upload path) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Route new profile-image uploads (avatar, cover, video-poster) straight to `swellyo-images` S3 via presigned PUT, generate variants server-side, and store the S3 URL — so uploads never revert to Supabase Storage.

**Architecture:** New JWT-verified edge fn `image-upload-s3` mirrors `process-profile-video-s3`: `get-upload-url` returns a presigned PUT for a server-derived key; `generate-thumbnails` (called after the PUT) forwards to `generate-thumbnail-s3` with the server-side secret. Client gets a shared `uploadImageToS3()` helper; the three profile upload fns call it instead of `supabase.storage.upload`. Callers that persist the returned URL are unchanged.

**Tech Stack:** Supabase Edge Functions (Deno), AWS S3 SigV4 presign, React Native (expo-file-system for native PUT), Jest.

## Global Constraints

- **Scope this pass = profile-images only** (`uploadProfileImage`, `uploadCoverImage`, `uploadProfileVideoThumbnail`). Trip/surftrip (`uploadToBucket`) and chat images are deliberately NOT rewired yet — the shared helper is built bucket-agnostic so they're a one-line follow-on.
- **Key scheme (unchanged, mirror Supabase):** `<bucket>/<userId>/<kind>-<timestamp>.jpg`. S3 base `https://swellyo-images.s3.us-east-1.amazonaws.com`.
- **Security:** the edge fn derives/validates `userId` from the JWT (`auth.getUser`), rejects `userId !== user.id`, and only ever signs keys under `<bucket>/<userId>/`. Bucket + kind are allowlisted server-side.
- **Secret stays server-side:** the client never holds `THUMBNAIL_SECRET`; `image-upload-s3.generate-thumbnails` forwards to `generate-thumbnail-s3` with it.
- **Thumbnail call is fire-and-forget** (like today); `<Thumb>` falls back to the original until variants exist.
- **Compression caps unchanged** (avatar 1024/q0.75, cover 2048/q0.85) — already ≤2048, so the OOM guard is satisfied; the edge fn also pre-shrinks to 1280.
- **No deletes, no Supabase-path removal.** Old Supabase upload code is replaced, not the stored objects.
- **No Claude commits.** Deploy uses Ohad's access token (already provided this session).

---

### Task 1: `image-upload-s3` edge function

**Files:**
- Create: `supabase/functions/image-upload-s3/index.ts`
- Create: `supabase/functions/image-upload-s3/aws.ts` (copy of `generate-thumbnail-s3/aws.ts` — bucket `swellyo-images`, exposes `generatePresignedUrl`)

**Interfaces:**
- Produces (client contract):
  - `POST { action: 'get-upload-url', userId, bucket, kind }` → `{ uploadUrl, key, publicUrl }`
  - `POST { action: 'generate-thumbnails', userId, key }` → `{ done, generated }` (or `{ skipped }`)
  - Auth: `Authorization: Bearer <user access_token>` + `apikey` (same as the video fn).

- [ ] **Step 1: Copy the signer**

`cp supabase/functions/generate-thumbnail-s3/aws.ts supabase/functions/image-upload-s3/aws.ts` (identical — hardcoded to `swellyo-images`, exports `generatePresignedUrl('PUT'|'GET', key, expiresIn, contentType?)`).

- [ ] **Step 2: Write the function**

Create `supabase/functions/image-upload-s3/index.ts`:
```ts
// image-upload-s3 — issue presigned PUTs for profile images and trigger S3
// thumbnail generation. Mirrors process-profile-video-s3's auth pattern:
// validate the caller's JWT, reject when body.userId != token user, then
// dispatch by action. The client never sees THUMBNAIL_SECRET.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generatePresignedUrl } from "./aws.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_SECRET = Deno.env.get("THUMBNAIL_SECRET") ?? "";
const S3_BASE = "https://swellyo-images.s3.us-east-1.amazonaws.com";

// Public buckets this fn may sign uploads for, and the allowed filename kinds.
const ALLOWED: Record<string, Set<string>> = {
  "profile-images": new Set(["profile", "cover", "video-thumbnail"]),
  "trip-images": new Set(["hero", "accommodation"]),
  "surftrip-images": new Set(["hero"]),
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return json({ error: "missing token" }, 401);
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action, userId, bucket, kind, key } = body as {
      action?: string; userId?: string; bucket?: string; kind?: string; key?: string;
    };
    if (userId !== user.id) return json({ error: "user mismatch" }, 403);

    if (action === "get-upload-url") {
      if (!bucket || !kind || !ALLOWED[bucket]?.has(kind)) {
        return json({ error: "bad bucket/kind" }, 400);
      }
      const objectKey = `${bucket}/${userId}/${kind}-${Date.now()}.jpg`;
      const uploadUrl = await generatePresignedUrl("PUT", objectKey, 3600, "image/jpeg");
      return json({ uploadUrl, key: objectKey, publicUrl: `${S3_BASE}/${objectKey}` });
    }

    if (action === "generate-thumbnails") {
      // Only ever generate for a key under this user's own folder.
      if (!key || !/^[a-z-]+\/[^/]+\//.test(key) || !key.includes(`/${userId}/`)) {
        return json({ error: "bad key" }, 400);
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-thumbnail-s3`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-thumb-secret": THUMB_SECRET },
        body: JSON.stringify({ key }),
      });
      return json(await res.json().catch(() => ({ skipped: true })));
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
```

- [ ] **Step 3: Deploy (JWT-verified — do NOT pass --no-verify-jwt)**

Run:
```bash
SUPABASE_ACCESS_TOKEN=<ohad_token> supabase functions deploy image-upload-s3
```
Expected: `Deployed Functions … image-upload-s3`. (JWT verification ON so the gateway rejects anon calls; the fn also validates the user.)

- [ ] **Step 4: Verify auth gating (no token → 401)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/image-upload-s3" \
  -H "Content-Type: application/json" -d '{"action":"get-upload-url"}'
```
Expected: `401` (gateway rejects without a JWT). Full happy-path is exercised on-device in Task 3.

---

### Task 2: client `uploadImageToS3` helper + rewire profile fns

**Files:**
- Modify: `src/services/storage/storageService.ts`

**Interfaces:**
- Consumes: `image-upload-s3` contract from Task 1; existing `getAuthHeaders`, `compressImage`, `uriToBlob`, `dataURLtoBlob`, `nativeFileFormData`.
- Produces: `uploadImageToS3(imageUri, userId, bucket, kind, opts?) → Promise<UploadResult>`. `uploadProfileImage` / `uploadCoverImage` / `uploadProfileVideoThumbnail` now return S3 URLs.

- [ ] **Step 1: Add the shared helper** (near the top of the profile upload section)

```ts
const getImageUploadFunctionUrl = (): string =>
  `${process.env.EXPO_PUBLIC_SUPABASE_URL || ''}/functions/v1/image-upload-s3`;

/**
 * Upload an image to swellyo-images S3 via presigned PUT, then fire-and-forget
 * server-side thumbnail generation. Returns the permanent public S3 URL.
 * bucket/kind are validated server-side against the caller's JWT.
 */
export const uploadImageToS3 = async (
  imageUri: string,
  userId: string,
  bucket: 'profile-images' | 'trip-images' | 'surftrip-images',
  kind: string,
  opts?: { maxDimension?: number; quality?: number },
): Promise<UploadResult> => {
  try {
    if (!imageUri || !userId) return { success: false, error: 'Missing image or user ID' };

    if (opts?.maxDimension) {
      try {
        imageUri = await compressImage(imageUri, {
          maxDimension: opts.maxDimension, quality: opts.quality ?? 0.8,
        });
      } catch (e) {
        console.warn('[StorageService/S3img] compression failed, uploading raw:', e);
      }
    }

    const fnUrl = getImageUploadFunctionUrl();
    const headers = await getAuthHeaders();

    const signRes = await fetch(fnUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'get-upload-url', userId, bucket, kind }),
    });
    if (!signRes.ok) {
      return { success: false, error: `Failed to get upload URL (${signRes.status})` };
    }
    const { uploadUrl, key, publicUrl } = await signRes.json();

    const isNativeFileUri = Platform.OS !== 'web' &&
      (imageUri.startsWith('file://') || imageUri.startsWith('content://') || imageUri.startsWith('ph://'));

    if (isNativeFileUri) {
      const LegacyFS = require('expo-file-system/legacy');
      const result = await LegacyFS.uploadAsync(uploadUrl, imageUri, {
        httpMethod: 'PUT',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      if (result.status < 200 || result.status >= 300) {
        return { success: false, error: `S3 upload failed (${result.status})` };
      }
    } else {
      const uploadBody = imageUri.startsWith('data:') ? dataURLtoBlob(imageUri) : await uriToBlob(imageUri);
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: uploadBody,
      });
      if (!s3Res.ok) return { success: false, error: 'S3 upload failed' };
    }

    // Fire-and-forget thumbnail generation — <Thumb> falls back to original meanwhile.
    fetch(fnUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'generate-thumbnails', userId, key }),
    }).catch((e) => console.warn('[StorageService/S3img] thumb trigger failed:', e));

    return { success: true, url: publicUrl };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
};
```

- [ ] **Step 2: Rewire `uploadProfileImage`** — replace its whole body with a delegation:

```ts
export const uploadProfileImage = async (
  imageUri: string, userId: string,
): Promise<UploadResult> =>
  uploadImageToS3(imageUri, userId, 'profile-images', 'profile', { maxDimension: 1024, quality: 0.75 });
```

- [ ] **Step 3: Rewire `uploadCoverImage`**:

```ts
export const uploadCoverImage = async (
  imageUri: string, userId: string,
): Promise<UploadResult> =>
  uploadImageToS3(imageUri, userId, 'profile-images', 'cover', { maxDimension: 2048, quality: 0.85 });
```

- [ ] **Step 4: Rewire `uploadProfileVideoThumbnail`** (keeps its `string | null` return):

```ts
export const uploadProfileVideoThumbnail = async (
  thumbnailUri: string, userId: string,
): Promise<string | null> => {
  const r = await uploadImageToS3(thumbnailUri, userId, 'profile-images', 'video-thumbnail');
  return r.success ? (r.url ?? null) : null;
};
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "storageService" || echo "clean"`
Expected: `clean`. (Old helpers `dataURLtoBlob`/`uriToBlob`/`nativeFileFormData` are still used by the video path — no unused-import breakage.)

---

### Task 3: On-device verification (Ohad)

- [ ] **Step 1: Upload a new avatar in the running app** (local build with these changes).

- [ ] **Step 2: Confirm it landed on S3, not Supabase** — I run via MCP:
```sql
select profile_image_url from surfers where user_id = 'ecaaa678-974a-4641-895a-12cf12e74599';
```
Expected: a `https://swellyo-images.s3.us-east-1.amazonaws.com/profile-images/…` URL.

- [ ] **Step 3: Confirm object + variants exist** — I `curl -I` the new key + `__48/__320` → all `200`.

- [ ] **Step 4: Confirm it renders** across profile / conversations / notifications at correct sizes.

Rollback if needed: revert the three storageService fns (git), and re-flip that row with `rollback` SQL. Old Supabase path still intact.

## Definition of done (Phase 1, profile-images)
- New avatar/cover/poster uploads write to S3, generate variants, store S3 URLs.
- Uploading no longer reverts your avatar to Supabase.
- Gate to next: rewire `uploadToBucket` (trip/surftrip) the same way, then fleet backfill + grace-delete per the spec.
