---
name: expo-video v2 Performance & Preloading
description: Fast startup, preloading, bufferOptions, HLS, Android warm-up, codec/format tips for expo-video v2 (useVideoPlayer API)
type: project
---

## Preloading — Real API (not hypothetical)

`createVideoPlayer(source)` starts buffering immediately even without a VideoView attached. This is the official preload mechanism. Once attached to a VideoView, playback starts with no buffering delay.

Pattern:
- Create player with `createVideoPlayer(url)` before the slide is active
- Attach to VideoView when user swipes to that slot
- Call `player.release()` when slot is far from viewport (memory management required — no auto-cleanup unlike `useVideoPlayer`)

For lazy preload: create player with `null` source, then call `player.replace(url)` when entering preload window.

There is NO `prefetch()` static method. Preloading = creating a player instance.

## bufferOptions — Real API

Set on the player instance: `player.bufferOptions = { ... }`

Available fields:
- `preferredForwardBufferDuration` — seconds to buffer ahead. Default: Android 20s, iOS 0 (auto). Lowering this can speed time-to-play by reducing the threshold before playback starts.
- `minBufferForPlayback` — minimum seconds buffered before playback begins. Default: 2s. Reduce to 0.5–1s to start sooner.
- `maxBufferBytes` — Android only, 0 = auto.
- `waitsToMinimizeStalling` — iOS only, default true. Set false for faster but potentially stuttery starts.
- `prioritizeTimeOverSizeThreshold` — Android only.

Must set as a whole object (partial updates not supported).

Fast-start config example:
```ts
player.bufferOptions = {
  preferredForwardBufferDuration: 5,
  minBufferForPlayback: 1,
}
```

## HLS Support

- Both iOS and Android support `.m3u8` HLS natively via AVPlayer/ExoPlayer.
- On iOS: URI must contain `.m3u8` extension OR set `contentType: 'hls'` in VideoSource, otherwise video tracks won't be available.
- iOS cannot cache HLS streams (useCaching=false for HLS on iOS).
- Android can cache HLS natively.
- HLS adaptive bitrate helps on variable networks but adds manifest fetch latency on cold start vs a well-optimized MP4 with range requests.
- For a carousel of short clips, HLS overhead likely outweighs benefit. MP4 on CDN is simpler and faster for short videos.

## Android Warm-Up / Decoder Reuse

- expo-video uses ExoPlayer (Media3) on Android.
- ExoPlayer reuses decoders within the same player instance. Switching source via `player.replace()` is faster than creating a new player (avoids decoder teardown/setup, which accounts for ~60% of startup latency on real devices).
- Keeping a pool of 2-3 `createVideoPlayer` instances and reassigning sources (via `replace()`) as the user scrolls is the fastest pattern on Android.
- Do NOT destroy and recreate players per-slide on Android — decoder setup overhead is 200-280ms per new instance.

## Android-Specific Bug

Issue #39962: VideoView intermittently stays black (~5% of time) instead of rendering first frame. Root cause is upstream in ExoPlayer/Media3 (MediaCodec buffer error). `onFirstFrameRendered` fires even when it fails visually, so you can't detect it. No workaround yet — Expo is awaiting upstream fix from Google.

## onFirstFrameRendered Callback

VideoView has `onFirstFrameRender` prop — use this to hide a poster/thumbnail overlay rather than waiting for status change events, which can be slower/inaccurate.

## Video Format Recommendations for Android Speed

- Use H.264 (AVC) baseline or main profile — universally hardware-decoded on Android.
- H.265 (HEVC) is smaller but software-decoded on many devices — slower to start.
- Use H.264 consistently across all carousel videos to enable decoder reuse within a single ExoPlayer instance.
- MP4 container, H.264, AAC audio.
- For very short clips: encode with faststart flag (`moov` atom at front of file) so CDN can start streaming before full download.

## Caching API

- `VideoSource.useCaching = true` — enables persistent on-device cache for MP4s.
- `setVideoCacheSizeAsync(bytes)` — set total cache size (default 1GB). Call when no players are active.
- Not available for HLS on iOS.

## Why: needed to understand best approach for video carousel with 1-second startup delay
## How to apply: use createVideoPlayer pool + replace() pattern on Android, reduce minBufferForPlayback, ensure H.264 format, use onFirstFrameRender for poster hiding
