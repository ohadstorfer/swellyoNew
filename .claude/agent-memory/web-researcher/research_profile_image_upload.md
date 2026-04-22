---
name: Profile Image Upload — Expo + Supabase
description: Client-side compress vs Supabase CDN transforms, expo-image-manipulator params, expo-image vs RN Image, single vs multi-size upload for avatars
type: reference
---

## Industry Best Practice (2025-2026)

Hybrid is standard: client-side resize/compress before upload + CDN for serving.
For pure simplicity (avoiding Supabase's paid transforms), client-side-only compress is the correct path.

**Supabase Image Transformations is a paid feature (Pro plan only)**. Not available on the free tier. Cost is per 1,000 origin images. Not suitable as a replacement for client-side compress unless already on Pro and willing to pay per transform.

## expo-image-manipulator

- Still the standard in 2026 for Expo managed workflow
- Supports iOS, Android, Web, and Expo Go
- Web parity is good; `extent()` is web-only but resize/compress works everywhere
- Recommended params for avatars/profile images:
  - `resize: { width: 1024 }` — preserves aspect ratio automatically
  - `compress: 0.75` — JPEG quality 75%
  - `format: SaveFormat.JPEG`
- Expected output from 3-4 MB iPhone JPEG: ~200-350 KB (realistic, consistent with community reports)
- Alternative: `react-native-compressor` — better for video + HEIC, more native, but adds native dependency; overkill for avatar-only use case

## Single vs Multi-Size Upload

For avatars (displayed 40-200px), single 1024px compressed source is sufficient.
Multi-size upload (thumbnail + full) adds code complexity and bandwidth cost with negligible UX gain at avatar scale.
Multi-size only makes sense if images are displayed at full-screen size (e.g., gallery, lightbox).

## expo-image vs react-native Image

`expo-image` is the clear 2025-2026 recommendation for Expo projects:
- 2x faster loading on Android
- Built-in disk + memory caching (CachePolicy)
- BlurHash/ThumbHash placeholder support (no flicker on reload)
- Automatic retry on network errors
- Drop-in replacement API for basic use; advanced props are additive

For a social app loading many user avatars (like Swellyo's matching results), expo-image's caching alone is worth the switch.

## Key Sources
- https://docs.expo.dev/versions/latest/sdk/imagemanipulator/
- https://docs.expo.dev/versions/latest/sdk/image/
- https://supabase.com/docs/guides/storage/serving/image-transformations
- https://dev.to/mikeesto/client-side-image-compression-with-supabase-storage-1193
- https://dev.to/fasthedeveloper/mastering-media-uploads-in-react-native-images-videos-smart-compression-2026-guide-5g2i
- https://ficustechnologies.com/blog/react-native-image-optimization-2025-fastimage-caching-strategies-and-jank-free-scrolling/
