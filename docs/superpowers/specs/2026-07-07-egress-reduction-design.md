# Egress Reduction — Design Spec

**Date:** 2026-07-07
**Author:** Ohad (+ Claude)
**Status:** Approved for planning

## Problem

Supabase cached egress is ~36.8 GB for ~45 users — egress ≈ 36× total storage (~1 GB), i.e. the
same bytes are served over and over. Investigation (see conversation) found the cause is **excessive
re-fetching**, across three surfaces. This spec fixes all three. They are partitioned **by
file-ownership into three disjoint lanes** so they can be implemented in parallel without conflicts.

Out of scope: the lifestyle-image transform-URL issue (parked), the ad-hoc `curl` message-images dump
(internal migration traffic, not app behavior), landscape hero-card thumbnails (needs a new thumbnail
ladder variant + backfill — separate follow-up).

---

## Lane A — Profile video caching (biggest win)

### Root cause
`profile-surf-videos` is the largest bucket (408 MB). `ProfileScreen.tsx` (`SurfSkillCard`, ~L236–397)
creates a looping player that **autoplays on focus** and calls `replaceAsync(rawRemoteUrl)` — streaming
~6 MB straight from the network on **every** profile open (from matching, bell, trip-member taps, chat),
uncached, even for a glance. Disk caching (`videoPreloadService`) exists but is only ever used for the
*logged-in user's own* video, never when viewing others.

### Key insight — replacement is automatic
Profile video URLs carry a timestamp in the filename (`profile-surf-video-${Date.now()}.mp4`, then
processed to `.../processed/<user>/video-<ts>_compressed.mp4`). Re-uploading **mints a new URL**.
Therefore, **keying the cache by URL makes replacement free**: a changed video is a natural cache miss →
fresh download; the stale file ages out of the LRU. No invalidation logic, no version tokens.

### Design
1. **New module `src/services/media/videoCacheService.ts`** — a small, hardened, reusable disk cache:
   - `getCachedVideoUri(remoteUrl): Promise<string>` — returns a local `file://` URI, downloading first
     if absent. Cold-start durable (checks `FileSystem.getInfoAsync` on disk before downloading).
   - **Cache key = a hash of the *full* URL** (not the last path segment) → fixes the existing collision
     risk between shared default filenames (e.g. `Dipping My Toes.mp4` across board folders).
   - **Location:** `cacheDirectory/video-cache/` (OS may purge under pressure — acceptable, we re-download
     on miss). Not `documentDirectory` (would grow unbounded against the user's storage).
   - **LRU eviction:** cap total cache size (default **400 MB**); on write, if over cap, delete
     least-recently-accessed files until under cap. Track access time via a small JSON index in the
     cache dir (or file mtime touch on access).
   - `prefetchVideo(remoteUrl)` — fire-and-forget warm.
2. **First-view behavior (decided):** **download-then-play (WhatsApp-style).** Show the existing
   poster/first-frame (or a spinner) while the file downloads once, then play from the local URI.
   Exactly one fetch per video per device, ever. First view has a short load; every later view is
   instant and free. (Ohad may veto in favor of stream-now-cache-later, which trades a 2× first-view
   fetch for instant first play — not chosen.)
3. **Wire into `ProfileScreen` `SurfSkillCard`:** resolve `videoUrl` through `getCachedVideoUri` before
   handing it to the player; **keep `loop` and autoplay-on-focus** (both are free from a local file).
4. **Reuse:** the logged-in user's own profile video and (optionally) the loading video route through the
   same cache. Onboarding board-video preload can keep its current path for now (once-per-user, low
   egress) but should migrate to `videoCacheService` opportunistically to kill the last-segment collision
   bug. Not required this round.

### Also in Lane A (ProfileScreen images, to keep the file single-owner)
- Cover image (`ProfileScreen.tsx:~2391`) — route through `getStorageThumbUrl`/`toWidthThumbUrl` +
  `expo-image` `cachePolicy="memory-disk"`.
- Lifestyle images render — leave the URL values alone (parked issue) but ensure the `<Image>` uses
  `expo-image` memory-disk so repeat profile views don't re-fetch.

### Acceptance
- Opening the same profile twice downloads the video once (verify: second open makes no network request
  for the video; plays from `file://`).
- Changing your own video (new URL) causes a one-time re-download, not stale playback.
- Cache never exceeds the size cap.

---

## Lane B — Messaging / inbox media

### Root causes & fixes
1. **Inline chat image loads the full original** (`DirectMessageScreen.tsx:~4103`, mirrored in
   `DirectGroupChat.tsx`): `<ExpoImage source={{uri: fullImageUri}}>` where `fullImageUri` = the 2560px
   original (~360 KB); the 600px `thumbnail_url` is only used as the blur-up `placeholder`.
   **Fix:** inline `source` = `thumbnail_url`; keep the original **only** for the fullscreen tap view
   (`setFullscreenImageUrl`). Fall back to the original if `thumbnail_url` is missing (legacy messages).
   `thumbnail.jpg` is confirmed still generated post-S3-rewire (imageUploadService:385).
2. **1:1 inbox avatar loads the full profile image** (`ConversationsScreen.tsx:878`): passes
   `other_user.profile_image_url` raw. The group-chat branch 5 lines below already thumbnails.
   **Fix:** route the 1:1 avatar through `getStorageThumbUrl(url, 144)` for parity.
3. **Per-message sender avatars use raw full URL via RN core `<Image>`**
   (`DirectMessageScreen.tsx:~3805`, `DirectGroupChat.tsx:~3636`; `sender_avatar` sourced in
   `messagingService.ts`). **Fix:** thumbnail the URL (`getStorageThumbUrl`) and render via `expo-image`
   memory-disk (or the shared `ProfileImage`).
4. **Voice notes eager-preload full audio on bubble mount** (`AudioMessageBubble.tsx:119`, LRU cap 6) →
   scrolling re-downloads. **Fix:** gate `audioPlaybackService.preload` behind viewport visibility
   (only preload the on-screen bubble) or drop eager preload and load on first play. Lower priority; do
   if low-risk, otherwise flag.

### Owns files
`DirectMessageScreen.tsx`, `DirectGroupChat.tsx`, `ConversationsScreen.tsx`, `AudioMessageBubble.tsx`,
`messagingService.ts` (sender_avatar thumbnailing only — no MessagingProvider subscription changes).

### Acceptance
- Scrolling a chat with images fetches `thumbnail.jpg`, not `original.jpg`; tapping fetches the original
  once (already cached thereafter).
- Inbox 1:1 avatars fetch the 144px thumb.
- No change to realtime/subscription behavior.

---

## Lane C — Trips / surftrips / search avatars

### Fixes (mechanical: raw full URL → thumbnail, RN core `<Image>` → expo-image memory-disk)
High-value, in scrollable/repeated contexts:
- `SurftripCard.tsx:25-26` — 56×56 hero circle, raw `hero_image_url`, in a plain `ScrollView.map`
  (`SurftripsList.tsx`). Route through `getStorageThumbUrl(url, 144)` (existing 320 square thumb crops
  fine to a circle).
- `UserSearchModal.tsx:206` — search-result avatars (re-fetched per keystroke).
- `AddMembersSheet.tsx:286` — candidate avatars.
- `TripDetailViewRedesigned.tsx:811` — participants row avatars (scales with trip size).
- `GearRequestsSheet.tsx:180`, `GearItemSheet.tsx:71`, `PlanSections.tsx:89-101` — gear/contributor
  avatars (note PlanSections is inconsistent: `TripMemberSection` already uses `<Thumb>`).
- Join-request overlays (`JoinDecisionOverlay.tsx`, `JoinDeclinedOverlay.tsx`) — `Avatar` helper +
  hero background; lower frequency.

### Deferred (needs a new thumbnail variant + backfill — separate follow-up)
- Landscape **hero card** images in the Trips Explore / My-Trips feed (`TripsScreen.tsx:223,433`). The
  thumbnail ladder is square-only (48/320) plus a 1280w OG variant; there's no ~360px-wide landscape
  variant sized for these cards. Fixing needs `SQUARE_LADDER`/a new width entry in `thumbnails.ts` **and**
  a backfill of hero thumbnails. Out of scope this round; flag as follow-up.

### Owns files
`SurftripCard.tsx`, `SurftripsList.tsx`, `UserSearchModal.tsx`, `AddMembersSheet.tsx`,
`TripDetailViewRedesigned.tsx`, gear sheets, `PlanSections.tsx`, join-request overlays. No overlap with
Lanes A/B.

### Acceptance
- Listed avatar/hero sites fetch thumbnails and cache to disk (no re-fetch on remount/scroll).

---

## Cross-cutting notes
- `thumbnails.ts` is **not** modified this round (no new ladder variant needed — hero cards deferred), so
  the three lanes touch disjoint files and are safe to run in parallel.
- Verify each lane with `tsc` (no simulator/Maestro per Ohad's preference); Ohad tests on-device.
- Do not commit — Ohad reviews and commits manually.
- `imageUploadService.ts` is already rewired to S3 (uncommitted on `ohad`); Lane B's render fix is
  backend-agnostic and correct either way.

## Success metric
After ship + a billing-cycle rollover, cached egress per MAU should drop sharply (profile videos and
chat originals were the bulk). No functional regressions (video still loops/autoplays; images still
render; chat unaffected).
