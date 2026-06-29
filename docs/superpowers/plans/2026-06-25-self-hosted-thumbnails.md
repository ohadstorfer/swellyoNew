# Self-hosted Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** Ohad reviews and commits manually — do NOT run `git commit`. "Commit" steps are omitted intentionally.
> **Deploys:** Edge functions are copy-pasted into the Supabase dashboard; SQL is applied by hand in the SQL editor (remote migration history is frozen — never `supabase db push`). Steps that deploy/apply are flagged **[OHAD — MANUAL]**.

> **STATUS (2026-06-25): server side BUILT, DEPLOYED & BACKFILLED to prod by Claude.** Edge fn live (`--no-verify-jwt`, trigger fn in `public` schema, 30 s pg_net timeout); bucket + trigger applied via `execute_sql`; 763 thumbs backfilled (356/374 have `__320`; 18 large/corrupt legacy avatars fall back to original). Ladder is **[48, 320]** with **cap-to-source** (not [48,320,768]); sources >5 MB skip. Client code uncommitted; **og-inject Netlify redeploy pending**. The task-by-task steps below are the original plan; see the spec's "As-built deltas" for what changed.

**Goal:** Stop using Supabase Storage Image Transformations (`/render/image/`) by generating fixed-size thumbnails once, server-side, in the background, and serving them as plain static objects.

**Architecture:** A trigger on `storage.objects` fires `pg_net` (async, non-blocking) at a `generate-thumbnail` edge function on every image upload. The function resizes the original (ImageScript) into a fixed ladder and stores the variants in a public `image-thumbnails` bucket. The client read helpers return those static URLs; expo-image falls back to the original if a thumb isn't generated yet.

**Tech Stack:** Supabase Storage + Edge Functions (Deno), ImageScript, `pg_net`, React Native + expo-image, jest-expo.

**Design doc:** `docs/superpowers/specs/2026-06-25-self-hosted-thumbnails-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `supabase/functions/generate-thumbnail/index.ts` | Resize an original into the ladder, upload to `image-thumbnails`, idempotent, secret-gated, fail-safe | Create |
| `supabase/migrations/20260625000000_image_thumbnails_bucket.sql` | Create public `image-thumbnails` bucket + RLS policies | Create |
| `supabase/migrations/20260625000100_thumbnail_trigger.sql` | `storage.objects` AFTER INSERT trigger → `net.http_post` to the edge fn | Create |
| `supabase/migrations/20260625000200_thumbnail_backfill.sql` | One-time backfill over existing objects | Create |
| `src/services/media/thumbnails.ts` | Pure URL helpers: ladder, snap-to-size, source-URL → thumb-URL mapping | Create |
| `src/services/media/__tests__/thumbnails.test.ts` | Unit tests for the URL mapping | Create |
| `src/services/media/imageService.ts` | Re-point `getStorageThumbUrl` + `getLifestyleImageBucketUrlForFilename` at the static thumbnails | Modify |
| `src/components/Thumb.tsx` | expo-image wrapper: render thumb, `onError` → original | Create |
| `src/screens/trips/TripMembersScreen.tsx` | Use `<Thumb>` for member avatars | Modify |
| `src/components/trips/plan/PlanSections.tsx` | Use `<Thumb>` for member avatars | Modify |
| `src/screens/ConversationsScreen.tsx` | Use `<Thumb>` for surftrip hero | Modify |
| `src/screens/trips/TripsScreen.tsx` | Point the 24 px blur placeholder at the static thumb | Modify |
| `src/components/notifications/NotificationCenter.tsx` | No structural change — already degrades to initial/icon on error; just inherits the new URL | (verify) |
| `swellyo-invite-redirect/netlify/edge-functions/og-inject.ts` | Point `toPreviewImage` at the `__1280w` static thumb, original as fallback | Modify |

### Naming / shapes (used across tasks)
- Source buckets: `profile-images`, `trip-images`, `surftrip-images`, `lifestyle-thumbnails`.
- Hero buckets (get the extra `1280w` variant): `trip-images`, `surftrip-images`.
- Thumbnails bucket: `image-thumbnails` (public).
- Thumb object path: `<sourceBucket>/<sourcePath>__<variant>.jpg`
  - square variants: `__48.jpg`, `__320.jpg`, `__768.jpg`
  - width variant: `__1280w.jpg`
- Square ladder: `[48, 320, 768]`. Snap = smallest ladder size ≥ requested px (≥768 → 768).
- Edge fn URL: `https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/generate-thumbnail`
- Shared secret header: `x-thumb-secret` (value stored in Vault as `thumbnail_secret`).

---

## Task 1: `image-thumbnails` bucket + policies

**Files:**
- Create: `supabase/migrations/20260625000000_image_thumbnails_bucket.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- Public bucket holding pre-generated static thumbnails. Read is public;
-- writes are service-role only (the generate-thumbnail edge fn). Replaces the
-- Supabase Storage Image Transformation endpoint (/render/image/...).
insert into storage.buckets (id, name, public)
values ('image-thumbnails', 'image-thumbnails', true)
on conflict (id) do update set public = true;

-- Public read.
drop policy if exists "image-thumbnails public read" on storage.objects;
create policy "image-thumbnails public read"
  on storage.objects for select
  using (bucket_id = 'image-thumbnails');

-- No anon/authenticated write policy → only the service role (which bypasses
-- RLS) can write. The edge fn uses the service-role key.
```

- [ ] **Step 2: [OHAD — MANUAL] Apply in the Supabase SQL editor**

Run the file's contents. Verify:

```sql
select id, public from storage.buckets where id = 'image-thumbnails';
-- Expected: image-thumbnails | t
```

---

## Task 2: `generate-thumbnail` edge function

**Files:**
- Create: `supabase/functions/generate-thumbnail/index.ts`

- [ ] **Step 1: Write the function**

```ts
// generate-thumbnail — resize a freshly-uploaded image into a fixed ladder and
// store the variants as static objects in the `image-thumbnails` bucket. This
// replaces Supabase Storage Image Transformations (/render/image/), whose meter
// counts distinct origin images per cycle and does not scale with our content.
//
// Invoked async (pg_net) by an AFTER INSERT trigger on storage.objects, and by
// the one-time backfill. Idempotent (skips variants that already exist) and
// fail-safe (any decode/resize error → 200 without writing; the client read
// path falls back to the original, so a failure never breaks display).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts"; // deno.land/x version (NOT npm's)

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
const SQUARE_LADDER = [48, 320, 768];
const WIDTH_VARIANT = 1280;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

async function exists(path: string): Promise<boolean> {
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

serve(async (req) => {
  try {
    if (THUMB_SECRET && req.headers.get("x-thumb-secret") !== THUMB_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const { bucket, path } = await req.json();
    if (!bucket || !path || !SOURCE_BUCKETS.has(bucket)) return ok({ skipped: true });

    // Cover photos are wide and never rendered as square avatars — skip them.
    const isCover = path.includes("/cover-");

    const variants: { name: string; bytes: Uint8Array }[] = [];
    const prefix = `${bucket}/${path}`;

    // Decode once; skip work if every needed variant already exists.
    const needed = [
      ...(isCover ? [] : SQUARE_LADDER.map((s) => `${prefix}__${s}.jpg`)),
      ...(HERO_BUCKETS.has(bucket) ? [`${prefix}__${WIDTH_VARIANT}w.jpg`] : []),
    ];
    const missing: string[] = [];
    for (const n of needed) if (!(await exists(n))) missing.push(n);
    if (missing.length === 0) return ok({ done: true, generated: 0 });

    const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
    if (dlErr || !blob) return ok({ skipped: true, reason: "download_failed" });
    const srcBytes = new Uint8Array(await blob.arrayBuffer());

    // ImageScript decodes JPEG/PNG. A non-image (e.g. mp4) throws → fail safe.
    let base: Image;
    try {
      base = await Image.decode(srcBytes);
    } catch {
      return ok({ skipped: true, reason: "not_decodable" });
    }

    if (!isCover) {
      for (const s of SQUARE_LADDER) {
        const name = `${prefix}__${s}.jpg`;
        if (!missing.includes(name)) continue;
        const img = base.clone().cover(s, s); // resize-to-fill + center-crop
        variants.push({ name, bytes: await img.encodeJPEG(75) });
      }
    }
    if (HERO_BUCKETS.has(bucket)) {
      const name = `${prefix}__${WIDTH_VARIANT}w.jpg`;
      if (missing.includes(name)) {
        const img = base.clone();
        if (img.width > WIDTH_VARIANT) img.resize(WIDTH_VARIANT, Image.RESIZE_AUTO);
        variants.push({ name, bytes: await img.encodeJPEG(80) });
      }
    }

    for (const v of variants) await putJpeg(v.name, v.bytes);
    return ok({ done: true, generated: variants.length });
  } catch (e) {
    // Fail safe — never surface an error that would retry-storm the trigger.
    return ok({ skipped: true, error: String(e) });
  }
});
```

- [ ] **Step 2: [OHAD — MANUAL] Deploy + set secrets**

- Copy the file into a new `generate-thumbnail` function in the Supabase dashboard (keep JWT verification ON).
- Set function secret `THUMBNAIL_SECRET` to a random string (also stored in Vault as `thumbnail_secret`, Task 3). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
- Smoke test (replace `<secret>`):

```bash
curl -s -X POST \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "x-thumb-secret: <secret>" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"profile-images","path":"<an-existing-avatar-path>.jpg"}' \
  https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/generate-thumbnail
# Expected: {"done":true,"generated":3}
# Then confirm objects exist under image-thumbnails/profile-images/<path>__48.jpg etc.
```

---

## Task 3: `storage.objects` trigger

**Files:**
- Create: `supabase/migrations/20260625000100_thumbnail_trigger.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- Fire-and-forget thumbnail generation on every image upload. pg_net queues the
-- request and returns immediately, so the upload is never blocked (background).
-- Mirrors the project's existing pg_net + Vault pattern (cron / notifications).
create extension if not exists pg_net;

create or replace function storage.enqueue_thumbnail()
returns trigger
language plpgsql
security definer
set search_path = storage, public, extensions, pg_temp
as $$
declare
  v_secret text;
  v_anon   text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'thumbnail_secret';
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'anon_key';

  perform net.http_post(
    url     := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/generate-thumbnail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_anon, ''),
      'x-thumb-secret', coalesce(v_secret, '')
    ),
    body    := jsonb_build_object('bucket', NEW.bucket_id, 'path', NEW.name)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_enqueue_thumbnail on storage.objects;
create trigger trg_enqueue_thumbnail
  after insert on storage.objects
  for each row
  when (
    NEW.bucket_id in ('profile-images','trip-images','surftrip-images','lifestyle-thumbnails')
    and coalesce(NEW.metadata->>'mimetype','') like 'image/%'
  )
  execute function storage.enqueue_thumbnail();
```

- [ ] **Step 2: [OHAD — MANUAL] Add Vault secrets, then apply**

In the SQL editor (once):

```sql
select vault.create_secret('<the THUMBNAIL_SECRET value>', 'thumbnail_secret');
select vault.create_secret('<the project anon key>', 'anon_key'); -- skip if it already exists
```

Then apply the migration. Verify by uploading a new avatar in the app and confirming
`image-thumbnails/profile-images/<userId>/avatar-<ts>__320.jpg` appears within a few seconds.

---

## Task 4: pure thumbnail URL helpers (+ unit tests)

**Files:**
- Create: `src/services/media/thumbnails.ts`
- Create: `src/services/media/__tests__/thumbnails.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { snapSquareSize, toThumbUrl, THUMBNAILS_BUCKET } from '../thumbnails';

const BASE = 'https://proj.supabase.co';
const OBJ = `${BASE}/storage/v1/object/public/profile-images/u1/avatar-9.jpg`;

describe('snapSquareSize', () => {
  it('snaps up to the smallest ladder size >= the requested px', () => {
    expect(snapSquareSize(24)).toBe(48);
    expect(snapSquareSize(48)).toBe(48);
    expect(snapSquareSize(96)).toBe(320);
    expect(snapSquareSize(144)).toBe(320);
    expect(snapSquareSize(300)).toBe(320);
    expect(snapSquareSize(320)).toBe(320);
    expect(snapSquareSize(321)).toBe(768);
    expect(snapSquareSize(5000)).toBe(768);
  });
});

describe('toThumbUrl', () => {
  it('rewrites a public object URL to the static square thumb', () => {
    expect(toThumbUrl(OBJ, 96, BASE)).toBe(
      `${BASE}/storage/v1/object/public/${THUMBNAILS_BUCKET}/profile-images/u1/avatar-9.jpg__320.jpg`,
    );
  });
  it('returns non-Supabase URLs unchanged', () => {
    expect(toThumbUrl('https://lh3.googleusercontent.com/a/x', 96, BASE)).toBe(
      'https://lh3.googleusercontent.com/a/x',
    );
  });
  it('returns null for empty input', () => {
    expect(toThumbUrl(null, 96, BASE)).toBeNull();
  });
  it('does not double-rewrite an already-thumb URL', () => {
    const t = `${BASE}/storage/v1/object/public/${THUMBNAILS_BUCKET}/profile-images/u1/avatar-9.jpg__320.jpg`;
    expect(toThumbUrl(t, 96, BASE)).toBe(t);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/media/__tests__/thumbnails.test.ts`
Expected: FAIL — `Cannot find module '../thumbnails'`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure helpers that map a Supabase public-object URL to the matching static
// thumbnail URL in the `image-thumbnails` bucket. No network, no transform —
// this is the replacement for the /render/image/ endpoint.

export const THUMBNAILS_BUCKET = 'image-thumbnails';
export const SQUARE_LADDER = [48, 320, 768] as const;

const OBJECT_MARKER = '/storage/v1/object/public/';

/** Smallest ladder size >= requested px (caps at the largest ladder size). */
export const snapSquareSize = (px: number): number =>
  SQUARE_LADDER.find((s) => s >= px) ?? SQUARE_LADDER[SQUARE_LADDER.length - 1];

/**
 * Rewrite a Supabase public-object URL into its static square thumbnail URL.
 * - Non-Supabase URLs (e.g. Google avatars) are returned unchanged.
 * - URLs already pointing at the thumbnails bucket are returned unchanged.
 * - `null`/empty → `null`.
 * `baseUrl` defaults to EXPO_PUBLIC_SUPABASE_URL; injectable for tests.
 */
export const toThumbUrl = (
  url: string | null | undefined,
  px: number,
  baseUrl: string = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '',
): string | null => {
  if (!url) return null;
  const i = url.indexOf(OBJECT_MARKER);
  if (i === -1) return url; // not a Supabase public object
  const rest = url.slice(i + OBJECT_MARKER.length); // "<bucket>/<path>"
  if (rest.startsWith(`${THUMBNAILS_BUCKET}/`)) return url; // already a thumb
  const base = baseUrl || url.slice(0, i);
  const size = snapSquareSize(px);
  return `${base}${OBJECT_MARKER}${THUMBNAILS_BUCKET}/${rest}__${size}.jpg`;
};

/** Width-bound (aspect-preserved) variant, used by og previews. */
export const toWidthThumbUrl = (
  url: string | null | undefined,
  width = 1280,
  baseUrl: string = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '',
): string | null => {
  if (!url) return null;
  const i = url.indexOf(OBJECT_MARKER);
  if (i === -1) return url;
  const rest = url.slice(i + OBJECT_MARKER.length);
  if (rest.startsWith(`${THUMBNAILS_BUCKET}/`)) return url;
  const base = baseUrl || url.slice(0, i);
  return `${base}${OBJECT_MARKER}${THUMBNAILS_BUCKET}/${rest}__${width}w.jpg`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/media/__tests__/thumbnails.test.ts`
Expected: PASS (all cases).

---

## Task 5: re-point `imageService.ts` helpers

**Files:**
- Modify: `src/services/media/imageService.ts` (`getStorageThumbUrl` ~562, `getLifestyleImageBucketUrlForFilename` ~541)

- [ ] **Step 1: Add the import (top of file, with the other imports)**

```ts
import { toThumbUrl, snapSquareSize, THUMBNAILS_BUCKET } from './thumbnails';
```

- [ ] **Step 2: Replace `getStorageThumbUrl` body**

```ts
export const getStorageThumbUrl = (url?: string | null, size = 96): string | null => {
  // Static thumbnail from the image-thumbnails bucket (no /render/image/ — that
  // endpoint is metered per origin image and does not scale). Non-Supabase URLs
  // are returned unchanged. The caller's <Thumb> wrapper falls back to the
  // original if the thumb isn't generated yet.
  return toThumbUrl(url, size, SUPABASE_URL);
};
```

- [ ] **Step 3: Replace `getLifestyleImageBucketUrlForFilename` return line**

```ts
  // Was: `${SUPABASE_URL}/storage/v1/render/image/public/${path}?width=...`
  const objectUrl = `${SUPABASE_URL}/storage/v1/object/public/${path}`;
  return toThumbUrl(objectUrl, size, SUPABASE_URL);
```

(`path` is already `${LIFESTYLE_IMAGES_BUCKET}/${encodeURIComponent(trimmed)}`, so the
resulting thumb is `image-thumbnails/lifestyle-thumbnails/<file>__<size>.jpg`.)

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

## Task 6: `<Thumb>` wrapper + main-image call sites

**Files:**
- Create: `src/components/Thumb.tsx`
- Modify: `src/screens/trips/TripMembersScreen.tsx`, `src/components/trips/plan/PlanSections.tsx`, `src/screens/ConversationsScreen.tsx`

- [ ] **Step 1: Write `Thumb.tsx`**

```tsx
import React, { useState } from 'react';
import { Image, ImageProps } from 'expo-image';
import { getStorageThumbUrl } from '../services/media/imageService';

type ThumbProps = Omit<ImageProps, 'source'> & {
  /** Original Supabase public URL (or any URL). */
  uri?: string | null;
  /** Rendered px size; snapped to the nearest thumbnail ladder size. */
  size: number;
};

/**
 * expo-image that loads the static thumbnail for `uri` and falls back to the
 * original on error (covers the brief post-upload generation window and any
 * generation failure). Use anywhere a small remote avatar/hero is rendered.
 */
export const Thumb: React.FC<ThumbProps> = ({ uri, size, ...rest }) => {
  const thumb = getStorageThumbUrl(uri, size);
  const [src, setSrc] = useState<string | null | undefined>(thumb ?? uri);
  return (
    <Image
      {...rest}
      source={src ? { uri: src } : undefined}
      onError={(e) => {
        if (src !== uri && uri) setSrc(uri); // thumb missing → original
        rest.onError?.(e);
      }}
    />
  );
};

export default Thumb;
```

- [ ] **Step 2: Migrate the three main-image sites**

At each site, replace the `<CachedImage source={{ uri: getStorageThumbUrl(X, N) ?? X }} ... />`
with `<Thumb uri={X} size={N} ... />` (keep all existing style/contentFit/etc. props):

- `TripMembersScreen.tsx:180` and `:242` — member avatars, `size={96}`, `uri` = the
  `profile_image_url` that was being passed to `getStorageThumbUrl`.
- `PlanSections.tsx:340` — member avatar, `size={96}`, `uri={m.avatarUrl}`.
- `ConversationsScreen.tsx:869` — surftrip hero, `size={144}`, `uri={surftripHeroImages[conv.id]}`.

Remove the now-unused `getStorageThumbUrl` import from any site that no longer calls it
directly, and add `import Thumb from '.../components/Thumb';` (correct relative depth per file).

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

## Task 7: low-risk call sites (placeholder + notifications + og)

**Files:**
- Modify: `src/screens/trips/TripsScreen.tsx` (~388)
- Verify (no change): `src/components/notifications/NotificationCenter.tsx`
- Modify: `swellyo-invite-redirect/netlify/edge-functions/og-inject.ts` (`toPreviewImage` ~44)

- [ ] **Step 1: TripsScreen blur placeholder**

The 24 px value is used only as a low-res `placeholder` behind the full hero. `getStorageThumbUrl`
now returns the static `__48.jpg` thumb (24 snaps to 48). No code change required beyond confirming
the call still reads `getStorageThumbUrl(trip.hero_image_url, 24)` — a 404 here is harmless (no
placeholder, full image still loads). Leave as-is.

- [ ] **Step 2: NotificationCenter — confirm only the URL changed**

`NotificationAvatar`/`RemoteCircle` already render the initial/icon on image error, so a not-yet-
generated thumb degrades gracefully. No structural change. Confirm `getStorageThumbUrl(...)` calls
at `:531/:532/:571/:572` now resolve to `image-thumbnails/...__<size>.jpg` (they will, via Task 5).

- [ ] **Step 3: og-inject `toPreviewImage` → static 1280w thumb**

```ts
// Point at the pre-generated 1280px-wide static thumbnail (aspect preserved) in
// the image-thumbnails bucket instead of the metered /render/image/ endpoint.
// Falls back to the original if the URL isn't a Supabase public object.
function toPreviewImage(url: string): string {
  const marker = "/storage/v1/object/public/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const rest = url.slice(i + marker.length); // "<bucket>/<path>"
  if (rest.startsWith("image-thumbnails/")) return url;
  return `${url.slice(0, i)}${marker}image-thumbnails/${rest}__1280w.jpg`;
}
```

(After the backfill, every existing surftrip hero has a `__1280w.jpg`. If a brand-new trip is shared
in the gen window, the crawler may briefly fetch a 404 and fall back to the static logo — acceptable
and self-heals.)

- [ ] **Step 4: [OHAD — MANUAL] Redeploy the Netlify edge function** (push to repo → Netlify auto-deploys, or redeploy the `swellyo-invite-redirect` site).

---

## Task 8: one-time backfill

**Files:**
- Create: `supabase/migrations/20260625000200_thumbnail_backfill.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- One-time: enqueue thumbnail generation for every existing image already in the
-- source buckets. Safe to re-run (the edge fn is idempotent). pg_net queues the
-- requests; they drain in the background. For very large buckets, run in batches
-- by adding `and name > '<last>' order by name limit 500`.
select net.http_post(
  url     := 'https://rfdhtvcmagsbxqntnepv.supabase.co/functions/v1/generate-thumbnail',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
    'x-thumb-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'thumbnail_secret')
  ),
  body    := jsonb_build_object('bucket', o.bucket_id, 'path', o.name)
)
from storage.objects o
where o.bucket_id in ('profile-images','trip-images','surftrip-images','lifestyle-thumbnails')
  and coalesce(o.metadata->>'mimetype','') like 'image/%'
  and o.name not like '%/cover-%';
```

- [ ] **Step 2: [OHAD — MANUAL] Run after Tasks 2–3 are deployed.** Then spot-check a handful of
existing avatars/heroes resolve to a loading `__320.jpg` / `__768.jpg` / `__1280w.jpg`, and confirm
the Supabase **Storage Image Transformations** meter stops climbing over the next cycle.

---

## Task 9: final verification

- [ ] **Step 1: No remaining `/render/image/` in app code paths**

Run: `rg -n "render/image" src swellyo-invite-redirect`
Expected: no matches in `src/services/media/imageService.ts` or `og-inject.ts` (only the design/plan
docs may mention it).

- [ ] **Step 2: Type-check + unit tests**

Run: `npx tsc --noEmit && npx jest src/services/media/__tests__/thumbnails.test.ts`
Expected: clean tsc, tests pass.

- [ ] **Step 3: Ohad on-device smoke test** — open Trips, Conversations, Trip Members, and the
notification bell; confirm avatars/heroes render (from thumbnails), and a freshly-uploaded avatar
appears (original first, thumbnail once generated).

---

## Self-Review

**Spec coverage:** bucket (T1), edge fn with square+1280w/idempotent/secret/fail-safe (T2), trigger
with content-type+bucket filter excluding thumbnails (T3), read-path swap for `getStorageThumbUrl` +
lifestyle (T4–T5), `<Thumb>` fallback + 5 call sites (T6–T7), og 1280w (T7), backfill (T8), cost/risk
verification (T8–T9). All design sections map to a task.

**Placeholders:** none — every code step has full code; manual deploy steps are explicitly flagged,
not vague.

**Type consistency:** `toThumbUrl(url, px, baseUrl)`, `snapSquareSize(px)`, `THUMBNAILS_BUCKET`,
`SQUARE_LADDER [48,320,768]`, `__<size>.jpg` / `__1280w.jpg`, `x-thumb-secret`, buckets list — all
identical across tasks, the edge fn, and the client helpers.
