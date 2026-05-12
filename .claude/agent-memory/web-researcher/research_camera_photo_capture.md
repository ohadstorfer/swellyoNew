---
name: camera-photo-capture-library-comparison
description: expo-image-picker vs expo-camera vs react-native-vision-camera for WhatsApp-style chat photo capture in Expo SDK 54 — Expo Go compat, web support, verdict
metadata:
  type: reference
---

## Use Case
WhatsApp-style: tap camera icon in chat input → take photo (or pick from gallery) → return URI for upload.

## Library Comparison

### expo-image-picker
- Works in Expo Go: YES
- Works on web: YES (delegates to browser file input / getUserMedia; `launchCameraAsync` on web opens a file picker — NOT a live camera preview; acceptable behavior)
- No custom camera UI — uses the OS native picker/camera sheet
- Zero native config beyond `app.json` permissions
- launchImageLibraryAsync + launchCameraAsync = all you need for this use case
- Known gotcha: `allowsEditing: true` on Android has invisible crop overlay bug (see `research_expo_image_picker_android.md`)
- Known gotcha: auto-injects READ_MEDIA_IMAGES on SDK 54 — see `research_photo_permissions.md` for workaround

### expo-camera
- Works in Expo Go: YES
- Works on web: YES (uses getUserMedia; returns base64 on web since no local file system)
- Renders a live camera preview inside your own UI (like a custom camera screen)
- More setup: you must build the entire camera screen (capture button, flash toggle, etc.)
- Overkill for "tap to take photo" UX — WhatsApp doesn't use an in-app camera UI by default
- Good for: selfie features, in-app camera with controls, barcode scanning UI

### react-native-vision-camera (v5, May 2026)
- Works in Expo Go: NO — confirmed in GitHub issue #2670; requires dev client build
- Works on web: NO — AVFoundation/CameraX only, no web support
- V5 uses NitroModules; has known Xcode 26 beta compilation issue on EAS Build (SDK 54)
- Requires `expo-dev-client`, adds native config complexity
- Designed for ML/frame processing, multi-cam, RAW capture — overkill for chat photos
- Only choose this if: you need real-time frame processing or complex custom camera features

## Recommendation
**expo-image-picker** is the correct choice. It covers the full use case (camera + gallery), works in Expo Go, degrades gracefully on web (file input), and needs no native setup. The only notable issue for this project is the existing SDK 54 READ_MEDIA_IMAGES injection bug (already documented in research_photo_permissions.md — use launchImageLibraryAsync without requesting media permissions to trigger Android system photo picker).

## Sources
- https://docs.expo.dev/versions/latest/sdk/imagepicker/
- https://docs.expo.dev/versions/latest/sdk/camera/
- https://github.com/mrousavy/react-native-vision-camera/issues/2670
- https://www.pkgpulse.com/blog/react-native-vision-camera-vs-expo-camera-vs-expo-image-picker-2026
- https://github.com/mrousavy/react-native-vision-camera/issues/3743
