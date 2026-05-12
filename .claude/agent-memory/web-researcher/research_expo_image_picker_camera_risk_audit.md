---
name: expo-image-picker-camera-risk-audit
description: Full risk audit of expo-image-picker v17.0.8 launchCameraAsync with mediaTypes ['images','videos'] for TestFlight + Google Play — iOS/Android behavior, permissions, HEIC, video format, known bugs, asset metadata reliability
metadata:
  type: reference
---

## Context
expo-image-picker v17.0.8, SDK 54, RN 0.81. launchCameraAsync with mediaTypes: ['images', 'videos'], allowsEditing: false, quality: 1. Only requestCameraPermissionsAsync() called (no mic separately).

## iOS Camera UI Behavior
UIImagePickerController with both kUTTypeImage and kUTTypeMovie in mediaTypes DOES show the native photo/video toggle slider at the bottom of the camera UI. User can switch freely. This is standard iOS camera behavior when both types are specified.

## Android Camera Behavior
CRITICAL: When mediaTypes includes both images and videos (MediaTypes.ALL), toCameraIntentAction() returns ACTION_IMAGE_CAPTURE (else clause — VIDEOS is the only case that returns ACTION_VIDEO_CAPTURE). So on Android, launchCameraAsync with ['images','videos'] launches in photo-only mode. User cannot record video. Confirmed by reading ImagePickerOptions.kt source.

## Microphone Permission — iOS
- NSMicrophoneUsageDescription MUST be in Info.plist if video recording is possible via camera
- Apple AVFoundation requires mic authorization before recording video
- NOT requesting it upfront: OS will prompt inline when user switches to video mode (on iOS 14+) — BUT if NSMicrophoneUsageDescription is missing from Info.plist, the app crashes immediately on camera open in production builds
- The expo-image-picker config plugin adds NSMicrophoneUsageDescription by default; setting microphonePermission: false REMOVES it
- Issue #29692 (SDK 51): setting microphonePermission: false crashes getCameraPermissionsAsync() — fixed in PR #29749, should be resolved in v17
- Bottom line: leave microphonePermission as default (or set a string) — do NOT set it to false if you want video

## Microphone Permission — Android
- expo-image-picker auto-injects RECORD_AUDIO into AndroidManifest
- Since Android camera intent is IMAGE_CAPTURE (not VIDEO_CAPTURE for mixed mediaTypes), mic permission may not be exercised at all
- But RECORD_AUDIO is still declared in manifest; Google Play may require declaration justification (Play policy update May 2025)

## HEIC on iOS (SDK 54 — BREAKING CHANGE in v17.0.0)
- v17.0.0 changed default preferredAssetRepresentationMode from .automatic to .current
- .current = returns original codec: HEIC stays HEIC, not transcoded to JPEG
- HEIC files uploaded to Supabase Storage and displayed on Android receivers WILL FAIL to render (Android does not support HEIC natively until Android 12 and even then support is inconsistent)
- Camera captures: iOS camera itself saves JPEG by default (not HEIC) UNLESS the user has set "High Efficiency" in Settings > Camera > Formats
- Known metadata bug (#35714): when .current mode returns HEIC, asset.mimeType reports 'image/jpeg' and filename ends in .jpg — the file IS HEIC but metadata says JPEG. This is a silent lie. You can't trust mimeType to detect HEIC.
- Fix: use preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic to force JPEG transcoding (at cost of speed). Or check file extension independently.
- v17.0.7 (2025-09-08): fixed AVIF/TIFF transcoding to match HEIC behavior (avoids transcoding for those too)

## Video Format — iOS
- Camera capture returns .mov (QuickTime H.264 or HEVC depending on device)
- Gallery selection issue (#29918, #42739): videos are transcoded to H.264 MOV even when videoExportPreset is 'Passthrough' — affects gallery only, camera capture goes direct
- Camera video = always .mov on iOS

## Video Format — Android
- Since mixed mediaTypes fires ACTION_IMAGE_CAPTURE (photo intent), video is NOT returned from camera on Android with current implementation
- If you use mediaTypes: ['videos'] only: fires ACTION_VIDEO_CAPTURE, returns .mp4 (device-dependent, usually .mp4)

## Asset Metadata Reliability
- asset.type: can be null — "rare but can happen with some Android ContentProviders" (official docs)
- asset.mimeType: optional, can be null — and HEIC bug means it actively lies
- asset.fileSize: present but not guaranteed on all Android content resolvers
- asset.duration: null for non-video, present for video (in milliseconds)
- Camera captures: type and mimeType are generally reliable for camera (not gallery ContentProvider path)

## URI Scheme — iOS Camera
- launchCameraAsync returns file:// URIs consistently (camera writes to temp directory)
- ph:// (PHAsset) URIs can appear with launchImageLibraryAsync in some PHPicker scenarios — NOT with camera captures
- Camera = file:// is safe to fetch/upload directly

## allowsEditing: false for Video
- On iOS with allowsEditing: true, video trimming UI is shown (max 10 min by UIImagePickerController)
- With allowsEditing: false (your config): no trimming UI shown, full raw video returned
- No issues here — this is correct for chat

## videoMaxDuration
- Default is 0 (no limit) in expo-image-picker
- iOS UIImagePickerController itself has no hard limit (unlike AVCaptureSession which can be limited)
- Practical concern: users can record arbitrarily long videos; a 5-min 4K video = 1-2GB
- Recommendation: set videoMaxDuration: 60 (seconds) to cap at ~100MB for chat

## Known Bugs in v17 + SDK 54

### Issue #39480 (September 2025, open)
launchCameraAsync doesn't open camera on Android after 2025-09-05 security patch.
- Affected: Android 16, Pixel 6/7a/8/9a, Expo SDK 53 confirmed. SDK 54 status unclear.
- Logcat: "No requestable permission in the request"
- Root cause: Android tightened permission request validation
- Status: open, assigned to lukmccall + alanjhughes as of research date (May 2026)
- Workaround: background + resume (not acceptable for production)
- This is the most dangerous open bug for shipping

### Issue #41615 (December 2025, accepted)
Camera view overlaps 3-button Android navigation bar on SDK 54.
- Cosmetic but affects UX on devices with 3-button nav
- No confirmed fix as of research date

### Issue #42739 (January 2026, open)
videoExportPreset 'Passthrough' and preferredAssetRepresentationMode 'Current' ignored — affects launchImageLibraryAsync only, not camera capture.

### Issue #42819
Auto-injection of READ_MEDIA_* permissions on Android causing Google Play rejections.

## TestFlight Gotchas
- NSCameraUsageDescription AND NSMicrophoneUsageDescription must BOTH be present in Info.plist — missing mic key causes crash on permission check even for photos
- expo-image-picker config plugin adds both by default — only a problem if you set microphonePermission: false
- Camera roll permission: works in Expo Go via Expo's global permissions, but standalone build requires own Info.plist keys
- Production build (not Expo Go): native modules must be properly linked — if you get "Module ImageLoader not found" it's a prebuild/linking issue

## Sources
- https://docs.expo.dev/versions/latest/sdk/imagepicker/
- https://github.com/expo/expo/blob/main/packages/expo-image-picker/CHANGELOG.md
- https://github.com/expo/expo/issues/39480
- https://github.com/expo/expo/issues/41615
- https://github.com/expo/expo/issues/42739
- https://github.com/expo/expo/issues/29692
- https://github.com/expo/expo/issues/35714
- https://github.com/expo/expo/blob/main/packages/expo-image-picker/android/src/main/java/expo/modules/imagepicker/ImagePickerOptions.kt
