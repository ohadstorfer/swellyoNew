---
name: project-fullscreen-media-instant-thumbnail-gap
description: Why chat fullscreen image/video viewers show a spinner instead of the bubble's already-loaded thumbnail instantly — cache mismatch + missing video poster
metadata:
  type: project
---

Researched 2026-07-10 for a task to make the fullscreen chat media viewer show the bubble's
already-rendered thumbnail instantly instead of a spinner. See [[reference_fullscreen_image_zoom_building_blocks]]
for the general viewer building blocks and [[project_chat_media_url_shapes_for_notifications]] for
the public-vs-presigned URL background.

**Root cause for images**: bubble (`ExpoImage` from `expo-image`, `cachePolicy="memory-disk"`) and
viewer (`src/components/FullscreenImageViewer.tsx`, plain RN core `Image` from `react-native`) use
two different, non-shared caches. Even though `FullscreenImageViewer` already accepts and renders a
`thumbnailUrl` prop (absolute-fill behind the full image, shown until `onLoad` fires on the full-res
`Image`), RN's `Image` doesn't share expo-image's disk cache — so the "instant" thumbnail actually
refetches over the network instead of painting from cache immediately. Fix direction: swap
`FullscreenImageViewer`'s two `<Image>`s to `expo-image`'s `Image` with the same `cachePolicy`.

**Second image bug**: the loading `ActivityIndicator` overlay (FullscreenImageViewer.tsx ~line
124-128) renders unconditionally whenever `isLoading` is true, on top of the thumbnail — it doesn't
check whether a thumbnail is already visible. Should probably only show when there's no thumbnail to
display underneath.

**Video has no poster support at all**: `src/components/FullscreenVideoPlayer.tsx` takes only
`{visible, videoUrl, onClose}` — no thumbnail/poster prop, even though the bubble already has a
public, self-hosted `video-thumbnail.jpg` (see [[project_self_hosted_thumbnails]] equivalent — video
thumbnails are uploaded to Supabase Storage `message-images/{convId}/{msgId}/video-thumbnail.jpg`,
public URL via `getPublicUrl`, generated client-side in `src/services/messaging/videoUploadService.ts`
around line 231-248 native / 168-220 web). `NativeVideoPlayer` inside FullscreenVideoPlayer just shows
black + a play icon (via `useVideoPlayer`) until the stream buffers.

**Extra pre-modal delay for video**: tapping a video bubble does NOT open the modal immediately. In
both `DirectMessageScreen.tsx` and `DirectGroupChat.tsx`, `openVideo()` awaits
`signDmVideoUrl(storagePath)` (a `process-profile-video-s3` edge-fn round trip, `action:
'sign-dm-video'`) BEFORE calling `setFullscreenVideoUrl(...)`. The spinner during that wait is shown
IN THE BUBBLE (`isSigning` state → `ActivityIndicator` overlay replacing the play icon), not inside
the modal. Fix direction: open `FullscreenVideoPlayer` immediately with the poster shown, sign in the
background, and only start `useVideoPlayer` once the signed URL resolves — needs a poster prop added
first.

**Code map** (identical in both DM and group chat — screens are parallel/duplicated, not shared
components):
- Bubble image render: `src/screens/DirectMessageScreen.tsx:4455-4520`, `DirectGroupChat.tsx:4300-4365` (`ExpoImage`, `source={{uri: thumbnailUri || fullImageUri}}`, thumbnail is a real separate 600px JPEG file, not a `?width=` param — see `THUMBNAIL_WIDTH=600` in `src/services/messaging/imageUploadService.ts:51`)
- Bubble video render: `DirectMessageScreen.tsx:4343-4454`, `DirectGroupChat.tsx:4188-4299` (plain RN `Image` for the thumbnail frame, `openVideo()` signs then sets `fullscreenVideoUrl`)
- Tap handlers set `fullscreenImageUrl`/`fullscreenThumbnailUrl` or `fullscreenVideoUrl` state (component-local, not context/navigation — same screen renders the modal at the bottom of its JSX, ~line 5405-5419 DM / ~5268-5282 group)
- Viewers instantiated once per screen, near the end of the render tree: `FullscreenImageViewer` + `FullscreenVideoPlayer`, both from `src/components/`
- No React Navigation route/params involved — pure local modal state, so "shared between group and private chat" only in the sense that both screens import and use the same two component files with identical prop wiring (verbatim copy-paste, including leftover `[DirectMessageScreen]` log tags inside `DirectGroupChat.tsx`)

No `-copy` experimental variants of any of these five files exist (verified via Glob) — everything
described here is the live/only version.
