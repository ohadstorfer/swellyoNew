---
name: research_whatsapp_video_compression_upload
description: How WhatsApp compresses/uploads chat videos (codec, resolution, bitrate, single vs double pass) and how to replicate in React Native
metadata:
  type: reference
---

Researched 2026-07-17 for Ohad's chat video pipeline work (relates to [[project_chat_media_upload_speed]] and [[project_chat_media_upload_fixes]] in project memory).

**Core findings:**
- WhatsApp official HD toggle (9to5mac, Aug 2023, credible tech press): Standard quality = 480p, HD quality = 720p. Toggle appears as a button before send; app shows estimated file size per option. "Original quality" workaround = send as Document (no compression, up to 2GB per WhatsApp's own blog.whatsapp.com "2GB File Sharing" post).
- Official Meta Cloud/Business API media docs (developers.facebook.com/docs/whatsapp/cloud-api/reference/media): video must be H.264 + AAC audio, MP4 or 3GPP container, 16MB cap for that API path. Explicitly warns H.264 "High" profile + B-frames breaks Android WhatsApp clients — use Main/Baseline, no B-frames, moov-before-mdat (faststart). This is the one primary/official source with real codec constraints.
- Consumer app limits (SEO-aggregated but internally consistent across many sources): 16MB via legacy attach flow, up to 2GB via dedicated video-camera-icon flow (introduced 2023) which still re-encodes, ~100MB via Document flow which does NOT re-encode.
- Ballpark client compression target repeated consistently across compression-tool blogs (not a primary source, but converges independently): H.264, 720p, 1000-1500kbps video / 128kbps AAC audio for standard clips; drops to 480p / 500-1000kbps for longer clips. Treat as folklore-but-plausible, not confirmed by Meta.
- "WhatsApp double-compresses (client then server)" claim is repeated everywhere in SEO content but NO primary source confirms actual server-side re-encode of a single send. Likely conflates real phenomenon (repeated quality loss across multiple forwards, each hop re-encoding) with a false claim of double-encoding on one send. The existence of a pre-send file-size estimate + HD/Standard picker only makes sense if compression is finalized client-side before upload — supports single-pass architecture.
- Signal-Android (open source, best real proxy for "how do you implement WhatsApp-style client compression correctly") has `MediaConstraints.java` + a `TranscodingPreset` system with Standard/HD quality tiers, mirroring WhatsApp's UX. Could not pull exact current bitrate constants (GitHub raw fetch 404'd, page navigation blocked) — worth reading directly from repo if this gets implemented, not just from search.
- `react-native-compressor` (numandev1) explicitly markets itself as "compress like WhatsApp" — `compressionMethod: "auto"` mode picks resolution/bitrate automatically; manual mode exposes `maxSize` (default 640) and `bitrate`. Compression algorithm itself is a black box, not documented.

**Applies to Swellyo:** matches the direction already taken in [[project_chat_media_upload_speed]] (avoid videoExportPreset blocking the picker, transcode after send) — the "single-pass, client-side, no server re-encode" architecture is the right one to imitate; don't add a server-side re-encode step, it wasn't confirmed to exist in WhatsApp's own pipeline and only adds latency/quality loss.

**Sources:** developers.facebook.com/docs/whatsapp/cloud-api/reference/media, 9to5mac.com/2023/08/24/whatsapp-hd-videos, blog.whatsapp.com/reactions-2gb-file-sharing-512-groups, github.com/signalapp/Signal-Android (MediaConstraints.java), github.com/numandev1/react-native-compressor, github.com/patrick-paul/WAMO (empirical WhatsApp-Status-compression study, no hard numbers disclosed).
