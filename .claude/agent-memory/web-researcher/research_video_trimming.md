---
name: Client-Side Video Trimming — Expo SDK 54 / RN 0.81
description: Library options, maintenance status, Expo prebuild compatibility, web support, and trim UI patterns for pre-send video trimming in DMs
type: reference
---

## Recommended Library

**react-native-video-trim** (maitrungduc1410) is the clear winner in 2026:
- Latest release: v7.1.0 on April 19, 2026 — actively maintained
- v7.0.0 added flip/rotate/crop/precise-trimming (April 2026)
- Supports iOS + Android, new + old architecture
- Uses `showEditor(videoUrl, { maxDuration: 60 })` — opens a full native modal UI with trim handles
- Built-in UI includes trim handles, thumbnail filmstrip, playback preview
- No Expo config plugin found — requires manual native setup (pod install / gradle), then works fine with Expo prebuild
- NO web support

## ffmpeg-kit-react-native Status

Officially retired January 6, 2025. Binaries removed from Maven Central + CocoaPods by April 2025. Archived on GitHub June 2025.
Community fork: `jdarshan5/ffmpeg-kit-react-native` exists but is not widely adopted.
Do not use ffmpeg-kit-react-native for new projects.

## expo-video / expo-av

No built-in trimming API in either. expo-video is for playback only. Not relevant here.

## Web

- react-native-video-trim: no web support
- Best web option: ffmpeg.wasm (@ffmpeg/ffmpeg) — runs FFmpeg in browser via WebAssembly
  - Works for small files; large files can crash/slow browser
  - SharedArrayBuffer required (needs COOP/COEP headers)
  - Practical for MVP: disable trim on web or show a "mobile only" message

## Trim UI Pattern (WhatsApp/Instagram style)

Standard pattern:
1. Horizontal filmstrip of video thumbnails spanning full width
2. Two drag handles (left = start, right = end) overlaid on filmstrip
3. Playhead that moves during preview
4. Duration display (selected range)
5. Play/pause button to preview trimmed segment

react-native-video-trim provides this UI natively out of the box via `showEditor()`.
For custom JS UI, `react-native-video-trimmer-ui` (techbyvj) exists but is less maintained.

## MVP Recommendation

Use react-native-video-trim for mobile. Gate the trim button with `Platform.OS !== 'web'` to skip web entirely for now. Add ffmpeg.wasm as a future web enhancement only if needed.

**Why:** Trim-on-mobile is the 80% case (that's where DM video sending happens). Web DM video sending is a secondary path. Skipping web trim is the safest App Store submission path.

## Watch Out For

- "Keyframe drift": without `enablePreciseTrimming: true`, trim points can drift several seconds. Always enable precise trimming.
- Library requires `isValidFile()` check before calling `showEditor()` — skip this and you'll get silent failures
- No config plugin means you must run `npx expo prebuild` and may need to manually add pod/gradle entries if auto-linking doesn't pick it up
- ffmpeg.wasm requires SharedArrayBuffer → needs COOP/COEP HTTP headers on the web server (Netlify config)
