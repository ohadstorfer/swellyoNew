---
name: Video/media assets bundle vs stream — Expo/React Native
description: Research on whether to bundle or stream video assets in production Expo apps, app size thresholds, and caching strategies
type: reference
---

Key findings (researched 2026-04-10):

- Every 6MB increase in APK size = ~1% drop in install conversion. 100MB is the critical cellular threshold (~10% instant drop-off at that boundary).
- Google Play: 150MB compressed APK limit for cellular install; App Store: 200MB cellular limit.
- Bundle only assets that must be offline-available and are small (<1-2MB). Stream everything else from CDN.
- expo-video has native `useCaching` prop (SDK 53+) — works well for MP4 on both platforms. For HLS on iOS, use `expo-video-cache` (proxy-based local server approach).
- Hybrid pattern: bundle a compressed poster/thumbnail, stream the actual video. Load poster immediately, start video stream on mount.

Sources:
- https://medium.com/googleplaydev/shrinking-apks-growing-installs-5d3fcba23ce2
- https://docs.expo.dev/versions/latest/sdk/video/
- https://github.com/Monisankarnath/expo-video-cache
- https://medium.com/@anshulkahar2211/efficient-video-caching-in-expo-apps-with-pre-signed-urls-b5ab7f08e190
