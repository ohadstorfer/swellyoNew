---
name: Photo/Media Library Permissions — iOS & Android Store Requirements
description: Apple App Store and Google Play requirements for photo permissions, permission UX best practices, canAskAgain handling, and Expo-specific compliance issues
type: reference
---

## Apple App Store — iOS Requirements

- **NSPhotoLibraryUsageDescription is mandatory**. App will be rejected without it. Must be specific to your use case — Apple rejects apps with boilerplate or vague strings.
- **No pre-permission dialog is required by Apple policy**, but it is strongly recommended by HIG as best practice ("permission primer") because iOS only shows the native dialog once. If user denies the first time, you can never ask again.
- **iOS 14+ limited access**: Users can grant access to only selected photos. Handle PHAuthorizationStatus.limited state. Add `PHPhotoLibraryPreventAutomaticLimitedAccessAlert` to info.plist to suppress automatic system prompts if you handle it yourself.
- **After denial**: Apple does not require an "Open Settings" path, but HIG strongly recommends guiding users there when the feature is blocked. Failing to offer this is a UX problem, not a rejection risk.
- **Rejection risk**: Occurs if NSPhotoLibraryUsageDescription is missing, vague, or does not match actual usage. Not from skipping a pre-prompt.

## Google Play — Android Requirements (enforced May 2025)

- **Full enforcement deadline: May 28, 2025.** After this, non-compliant apps face removal.
- **Apps with infrequent/one-time photo use** (e.g., uploading a profile picture) MUST NOT request READ_MEDIA_IMAGES or READ_MEDIA_VIDEO. Must use the Android system photo picker instead.
- **Only apps whose core functionality is broad media access** (gallery apps, photo editors, media managers) may use READ_MEDIA_IMAGES / READ_MEDIA_VIDEO.
- Google Play introduced a declaration form. Apps that didn't submit it by Jan 22, 2025 were blocked from updating.
- Android Photo Picker (introduced Android 13) requires no permissions at all — user selects from system UI and only that file is granted to the app.

## expo-image-picker Specific Issue (CRITICAL for Swellyo)

- **expo-image-picker in SDK 54 auto-injects READ_MEDIA_IMAGES and READ_MEDIA_VIDEO** into the Android manifest during prebuild, even if you never call the permission API. This causes Google Play rejections for apps like Swellyo (profile picture upload = infrequent use).
- **Fix in SDK 55** (PR #42401): adds `android:maxSdkVersion="32"` to constrain permissions to older Android. Not yet available for SDK 54.
- **Workaround for SDK 54**: Use `launchImageLibraryAsync` without calling `requestMediaLibraryPermissionsAsync` first — on Android 13+ the system photo picker runs without needing permissions. Also, you can manually override in app.json:
  ```json
  { "android": { "permissions": ["android.permission.READ_EXTERNAL_STORAGE"] } }
  ```
  This overrides the injected permissions.

## Permission UX Best Practices

**Recommended flow**:
1. Check permission status (don't ask yet)
2. If `undetermined`: optionally show a custom "primer" screen explaining why you need access, then trigger the native dialog
3. If `denied` but `canAskAgain: true`: can ask again (Android only)
4. If `blocked` / `canAskAgain: false`: show an alert with "Open Settings" button using `Linking.openSettings()`

**Pre-permission primer**: Not required by Apple or Google, but industry standard. Improves grant rates by up to 81% according to UX research. Used by Instagram, WhatsApp, Facebook. Show it only the first time, contextually (when user taps the feature), not at app launch.

**Open Settings path**: Required as UX best practice when permission is permanently denied. Not a store requirement, but omitting it means users who denied can never use the feature without knowing they need to go to Settings manually.

**Re-check on foreground**: Listen for app state changes and re-check permission status when app comes to foreground after being backgrounded (user may have changed permission in Settings).

## Production App Patterns

- Instagram/WhatsApp: Show pre-permission explanation in their own UI first, then trigger native dialog contextually (not at app launch)
- After permanent denial: Show in-app alert "Photos access is disabled. Go to Settings > Privacy > Photos to enable it." with "Open Settings" and "Cancel"
- Never block the whole app for a denied permission — degrade gracefully

## PHPicker Behavior on iOS (CRITICAL for permission primer logic)

- **expo-image-picker v16+ uses PHPickerViewController on iOS 14+** by default for `launchImageLibraryAsync`. PHPicker is a separate OS process — the app never touches the photo library directly.
- **PHPicker does NOT require photo library permission to function.** Apple's documentation states: "The user doesn't need to explicitly authorize your app to select photos." The picker works even if `PHPhotoLibrary.authorizationStatus` is `.notDetermined`.
- **`getMediaLibraryPermissionsAsync()` returns `granted: true` on iOS even without explicit user permission** when PHPicker is the underlying implementation. This is expected and intentional — the permission system treats PHPicker use as implicitly authorized.
- **Same on Android 13+**: The system photo picker (`PhotoPickerActivity`) requires no `READ_MEDIA_IMAGES` permission. Android returns the permission as effectively granted when the system picker is used. So `getMediaLibraryPermissionsAsync()` returns `granted: true` here too.
- **Consequence for custom permission primer overlays**: Any primer that gates on `status !== 'granted'` will NEVER show on iOS 14+ or Android 13+ when using expo-image-picker v16+. The `status` will always be `granted` before the user ever sees a native dialog — because there is no native dialog.
- **Correct approach for permission primer**: Do NOT use `getMediaLibraryPermissionsAsync()` status to decide whether to show the primer. Instead, use a one-time flag in AsyncStorage (e.g., `has_shown_photo_primer`) to show it only the first time the user taps the photo button.

## Sources

- [Google Play Photo/Video Permissions Policy](https://support.google.com/googleplay/android-developer/answer/14115180)
- [Expo Issue #42819 — READ_MEDIA injection](https://github.com/expo/expo/issues/42819)
- [Android Photo Picker docs](https://developer.android.com/about/versions/14/changes/partial-photo-video-access)
- [Swift Senpai iOS photo library permissions](https://swiftsenpai.com/development/photo-library-permission/)
- [LogRocket React Native permissions guide](https://blog.logrocket.com/react-native-permissions/)
- [Appcues permission priming guide](https://www.appcues.com/blog/mobile-permission-priming)
