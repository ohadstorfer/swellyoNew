---
name: reference-fullscreen-image-zoom-building-blocks
description: Existing reusable pieces for building a WhatsApp-style fullscreen photo viewer (swipe-to-dismiss + pinch-zoom); no dedicated lightbox/gallery lib is installed
metadata:
  type: reference
---

For any "view photo fullscreen" feature (profile avatar, chat images, trip covers), two existing files
cover 90% of the implementation — no new npm package is needed:

- `src/components/FullscreenImageViewer.tsx` — already used from `DirectMessageScreen.tsx` (~line 4865)
  and `DirectGroupChat.tsx` for viewing a sent chat photo fullscreen. Modal (transparent, fade) +
  vertical-only pan-to-dismiss (Gesture.Pan with `activeOffsetY`/`failOffsetX`, dismiss on
  distance>120 or velocity>800, `withTiming` to fling off + `runOnJS(onClose)`, else `withSpring`
  back to 0) + opacity interpolation while dragging. No pinch-zoom, no horizontal dismiss, no
  shared-element transition — just fade-in Modal + vertical swipe. Wraps content in a *local*
  `GestureHandlerRootView` on non-web (Android Modal gesture requirement, see
  [[feedback_android_modal_gesture_handler_root]]). Good starting point to extend, not to use as-is
  for a "swipe in all directions" + zoom spec.
- `src/components/AvatarCropModal.native.tsx` (~lines 60-176) — has the pinch-to-zoom + pan
  reanimated pattern already built and battle-tested: `Gesture.Pinch()` + `Gesture.Pan()` composed
  via `Gesture.Simultaneous(pinch, pan)`, shared values for scale/translateX/translateY +
  saved-on-gesture-start snapshots, clamped scale (min/max), clamped pan bounds recomputed from
  current scale in `onEnd`. This is the reference for adding real pinch-to-zoom to a new viewer —
  FullscreenImageViewer doesn't have it, this file does (for a different purpose: crop, not view).

No `react-native-image-zoom-viewer`, `react-native-awesome-gallery`, `@gorhom/*`, or shared-element
lib is in package.json. reanimated ^3.15.1 + gesture-handler ~2.28.0 + expo-image ~3.0.11 are
installed and sufficient to hand-build shared-element-style zoom (measure the avatar's on-screen
rect on tap, animate a Modal overlay from that rect to fullscreen using reanimated shared values).

Avatar rendering: `src/components/ProfileImage.tsx` (expo-image based, handles thumb+original
fallback, placeholder). Used bare (no Pressable wrapper) in `src/screens/ProfileScreen.tsx` line
~2427 (`profilePictureWrapper`/`profilePicture`, 150x150 circle). Needs a Pressable/TouchableOpacity
added around it to open a viewer — none exists today.

Avatar/thumbnail URL pattern: `getStorageThumbUrl(uri, size)` from
`src/services/media/imageService.ts`, wrapped by `src/components/Thumb.tsx` (expo-image, falls back
to original `uri` on thumb load error). ProfileImage takes a raw `imageUrl` + optional
`fallbackImageUrl` instead of calling getStorageThumbUrl itself — the profile_image_url field on
the profile row is passed directly.

`BottomSheetShell` (`src/components/BottomSheetShell.tsx`) is NOT the right pattern for a fullscreen
viewer — it's specifically a bottom-anchored slide-up sheet (backdrop fade + sheet slide + swipe-down
close), and its Android nav-bar handling is a manual `translateY` nudge because
`navigationBarTranslucent` is broken on Expo SDK 54 (expo/expo#39749) — noted in code comments there.
A true fullscreen Modal (like FullscreenImageViewer) should just use `statusBarTranslucent` and
doesn't need the nav-bar nudge trick since it isn't bottom-anchored content clipped by insets.
