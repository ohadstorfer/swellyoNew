---
name: reference-fullscreen-image-zoom-building-blocks
description: Existing reusable pieces for adding pinch-zoom to chat's fullscreen media viewers; confirmed NONE of the 3 viewers have pinch-zoom today
metadata:
  type: reference
---

## Chat fullscreen media viewers (2026-07-17 confirmed, no pinch-zoom anywhere)

Both `src/screens/DirectMessageScreen.tsx` and `src/screens/DirectGroupChat.tsx` use the SAME
three viewer components (imported identically, same call-site shape in both screens — this is a
shared pattern, not per-screen forked code):

1. **`src/components/FullscreenImageViewer.tsx`** — single non-album photo. Opened via
   `fullscreenImageUrl`/`fullscreenThumbnailUrl` state, rendered at DirectMessageScreen.tsx:6105
   and DirectGroupChat.tsx:6016.
2. **`src/components/FullscreenVideoPlayer.tsx`** — single non-album video. Opened via
   `fullscreenVideo` state, rendered at DirectMessageScreen.tsx:6115 / DirectGroupChat.tsx:6026.
   Has full custom playback (play/pause, scrub bar with live-seek drag via `Gesture.Pan()` on the
   seek track only — NOT the media itself) but the video frame/image area itself has no zoom
   gesture.
3. **`src/components/AlbumMediaViewer.tsx`** — horizontal FlatList pager for album items (2+
   images/videos sent together), opened via `albumViewer` state, rendered at
   DirectMessageScreen.tsx:6208/6222, DirectGroupChat.tsx:6119/6133. Native-only (web routes album
   taps to the single-item viewers above instead — see file's top comment). Same pan-to-dismiss
   recipe as the other two.

**All three share the exact same gesture recipe and it is 1-D only:**
`Gesture.Pan().activeOffsetY([-15, 15]).failOffsetX([-25, 25])` → vertical drag = dismiss (fling
off screen via `withTiming`+`runOnJS(onClose)` if `distance>120 || velocity>800`, else
`withSpring` back to 0), horizontal drag intentionally fails the pan (so AlbumMediaViewer's FlatList
pager can catch it instead). There is no `Gesture.Pinch()`, no `PinchGestureHandler`, no
`maximumZoomScale`/`minimumZoomScale` prop anywhere in these three files, and no zoom library
(`react-native-image-zoom-viewer`, `react-native-awesome-gallery`, etc.) is imported. Grepping all
of `src/` for pinch/zoom terms returns exactly one hit outside these files:
`src/components/AvatarCropModal.native.tsx` (profile-picture cropper, unrelated feature — but see
below, it's the right reference pattern to copy from).

Media itself renders via plain `expo-image` (`<ExpoImage contentFit="contain" .../>`, no
`<Image>`-level zoom support) for photos, and `expo-video`'s `<VideoView contentFit="contain"
nativeControls={false} />` for videos — neither component exposes zoom on its own.

## Reference pattern for building pinch-zoom (already battle-tested elsewhere)

`src/components/AvatarCropModal.native.tsx` (~lines 60-176) has the pinch-to-zoom + pan reanimated
pattern already built, for a *different* purpose (crop, not view): `Gesture.Pinch()` +
`Gesture.Pan()` composed via `Gesture.Simultaneous(pinch, pan)`, shared values for
scale/translateX/translateY with saved-on-gesture-start snapshots, clamped scale (min/max), and
pan bounds recomputed from current scale in `onEnd`. This is the pattern to adapt for adding real
pinch-to-zoom to FullscreenImageViewer / FullscreenVideoPlayer / AlbumMediaViewer — none of them
have it today, this file does.

`reanimated ^3.15.1` + `gesture-handler ~2.28.0` + `expo-image ~3.0.11` are installed and
sufficient; no new npm package is needed.

## Gotchas relevant to adding zoom to these viewers

- All three viewers wrap content in a *local* `GestureHandlerRootView` on non-web platforms —
  required for gestures to work inside RN `Modal` on Android, see
  [[feedback_android_modal_gesture_handler_root]]. Any new pinch gesture needs to compose with
  (not replace) the existing pan-to-dismiss gesture, since both would live in the same
  GestureHandlerRootView. Naive `Gesture.Simultaneous(pinch, existingPan)` would need care so a
  1-finger vertical drag still dismisses when NOT zoomed in, but pans the zoomed image instead of
  dismissing when zoomed in — this coordination doesn't exist yet.
- AlbumMediaViewer's FlatList pager (horizontal paging) would also need to coordinate with any
  new pinch/pan-when-zoomed gesture so zooming doesn't fight page-swiping.
- Video pinch-zoom is less common UX-wise; FullscreenVideoPlayer's scrub-bar gesture already lives
  on a separate `GestureDetector` from the outer pan, so a video pinch-zoom gesture would follow
  that same "separate detector for a separate concern" structure.

## Unrelated (avatar-only, not chat) building block, kept for reference
`src/components/ProfileImage.tsx` (expo-image based avatar renderer) + `getStorageThumbUrl` /
`src/components/Thumb.tsx` — avatar rendering only, not part of the chat media-viewer chain, not
relevant to this bug.

`BottomSheetShell` (`src/components/BottomSheetShell.tsx`) is NOT the right pattern for a
fullscreen viewer — it's a bottom-anchored slide-up sheet, not a fullscreen Modal.
