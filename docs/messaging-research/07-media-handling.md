# 07 — Media Handling

Uploading images, videos, and voice messages at scale: chunked uploads, thumbnails, transcoding, CDNs, and what Supabase Storage supports.

---

## The Core Problem

Media is different from text messages in three ways:
1. **Size:** A video can be 100 MB; a message is 100 bytes. The same "send" UX must handle both.
2. **Processing:** Images need thumbnails; videos need transcoding; voice messages need waveforms. This work happens after upload.
3. **Delivery:** Text is pushed via the message channel; media must be pulled from storage via URL. The URL must be accessible to the recipient but not to anyone else.

---

## Chunked and Resumable Uploads

For files above ~1 MB, a single HTTP PUT is fragile. Mobile networks drop connections mid-upload; the user switches to a tunnel; the app goes to background. Resumable uploads allow a failed upload to continue from where it left off.

**Standard protocols:**
- **tus (tus.io):** An open HTTP-based protocol for resumable uploads. The client POSTs to create an upload resource, then PATCHes chunks to it. The server tracks the upload offset. On resume, the client queries the server for the current offset and continues from there.
- **S3 Multipart Upload:** AWS-native chunked upload. Client initiates upload, receives an upload ID, uploads parts (minimum 5 MB each except the last), then calls complete. Supports parallel part uploads. Not resumable in the tus sense — if the session expires, a new multipart upload must be started.
- **WhatsApp / Meta Graph API:** Meta uses a resumable upload endpoint based on a "file handle" concept. On upload failure, the handle is retained and used to resume.

**Recommended chunk size:** 512 KB to 5 MB. Smaller chunks mean more round-trips; larger chunks mean more wasted work on failure.

---

## Signal's Attachment Pointer Model

Signal's approach is the reference design for E2EE media:

1. **Client generates a random AES-256 key** for this attachment (separate from any session key).
2. **Client encrypts the file** locally (AES-CBC + HMAC-SHA256 for authentication).
3. **Client uploads the ciphertext** to Signal's CDN. The server stores an opaque blob; it has no key.
4. **Client includes an attachment pointer** in the E2EE message:
   ```json
   {
     "cdn_url": "https://cdn.signal.org/attachments/abc123",
     "key": "<base64-encoded AES+HMAC keys>",
     "size": 2048576,
     "content_type": "image/jpeg",
     "thumbnail": "<encrypted thumbnail bytes>",
     "plaintext_hash": "<sha256 of decrypted content>"
   }
   ```
   This pointer is encrypted inside the Double Ratchet message envelope — only the recipient can read it.
5. **Recipient decrypts the pointer**, downloads the ciphertext from the CDN, and decrypts it using the key in the pointer. The server never sees which user downloaded which attachment, how many times, or who the recipient is.
6. **Server-side retention:** Signal deletes attachments 45 days after upload. This prevents the CDN from becoming a long-term archive.
7. **Thumbnails:** Included inline in the pointer (small enough to embed in the message), pre-generated client-side before upload.

---

## Thumbnail Generation

**Images:** On mobile, generate a JPEG thumbnail at 200×200 or 300×300 before upload. This is fast on-device using `expo-image-manipulator` or `react-native-image-resizer`. Embed the thumbnail as a base64 string in the message or upload it separately to a low-latency CDN path.

**Videos:** Video thumbnails are harder. Options:
1. Extract the first frame client-side using `expo-video-thumbnails` or native APIs.
2. Upload the video, then trigger a serverless function to extract the first frame.
3. Use a CDN that supports on-the-fly thumbnail extraction from video URLs (e.g., Cloudflare Images, Mux).

The client-side approach keeps costs down and is fast. The serverless approach enables mid-video thumbnails and doesn't require the client to load the video before upload.

---

## Progressive Download and Streaming

For video messages, users expect to start watching before the full download completes. This requires the video file to be in a streamable format:

- **MP4 with faststart:** The `moov` atom (which describes the video structure) must be at the beginning of the file, not the end (the default for many encoders). Without faststart, the browser/player must download the entire file before playing. Enable with `ffmpeg -movflags +faststart`.
- **HLS (HTTP Live Streaming):** Segment the video into 2–10 second TS or fMP4 segments plus an M3U8 manifest. Players download segments as needed. Works natively on iOS; on Android requires a player that supports HLS (ExoPlayer/Media3).

At WhatsApp and Signal's scale, videos are transcoded server-side to multiple bitrate/resolution tiers for adaptive streaming. For a small app, single-bitrate MP4 with faststart is sufficient.

---

## Voice Messages

Voice messages have a UX expectation: show a waveform visualization of amplitude over time.

**Generation:**
- Client-side during recording: sample audio amplitude at 50–100ms intervals, store as an array of floats normalized to 0.0–1.0.
- Server-side post-upload: analyze the audio file and return waveform data. Libraries: `fluent-ffmpeg`, `audiowaveform` (BBC open source).

**Format:** Typical encoding is Opus (lossy, excellent for voice, good compression). WhatsApp uses Opus in OGG containers. AAC is a reasonable fallback for iOS compatibility.

**Upload:** Voice messages are small (1–3 MB for a 1-minute message at 32 kbps). A single PUT upload is usually fine. Still worth treating as a media attachment with a content type and a separate CDN URL.

---

## CDN Strategy

At WhatsApp/Instagram scale, media is served from Meta's CDN (hundreds of edge PoPs worldwide). The pattern:

1. **Upload to origin:** Client uploads to a cloud storage bucket (S3, GCS, Supabase Storage).
2. **CDN pulls on first request:** A CDN (CloudFront, Cloudflare) is configured to pull from the origin when the first user requests a URL. Subsequent requests for the same file are served from edge cache.
3. **Signed URLs:** Media URLs are signed with a short TTL (hours, not permanent). This ensures only authorized recipients can download. On expiry, the URL stops working — but the file in storage persists.

For E2EE apps: since the media is already encrypted, signed URLs provide access control but not content confidentiality. Any holder of the signed URL can download the ciphertext (they just can't decrypt it without the key).

---

## What Supabase Storage Supports

| Feature | Supabase Storage |
|---------|-----------------|
| Signed URLs | Yes (`createSignedUrl`, configurable TTL) |
| Direct upload from client | Yes (RLS policies control bucket access) |
| Resumable uploads | Yes (tus protocol, SDK v2+) |
| CDN / edge caching | Yes (Supabase CDN via the storage URL, ~150ms global) |
| Video transcoding | No |
| Thumbnail generation | No |
| Image resizing on-the-fly | Yes (via transform endpoint: `?width=200&height=200&resize=cover`) |
| Waveform generation | No |
| File size limits | 50 MB on Free/Pro; configurable on Enterprise |
| Storage limits | 1 GB (Free), 100 GB (Pro), more via Enterprise |

**What's missing vs. production messaging apps:**
- No video transcoding (must be done client-side or via a separate service like Cloudflare Stream or Mux).
- No thumbnail extraction from video.
- The 50 MB file limit is restrictive for video messages (a 1-minute 1080p video can easily exceed 50 MB).
- No CDN invalidation — once a file is cached, there is no API to purge it.

**Practical approach for Swellyo today:**
- Images: upload directly to Supabase Storage, use transform endpoint for thumbnails (`?width=300&height=300`). Generate client-side thumbnail as preview before upload.
- Videos: compress client-side before upload (use `expo-video-thumbnails` for thumb, `react-native-compressor` for compression). Store in Supabase Storage. Use signed URLs for delivery.
- Voice: upload Opus/AAC to Supabase Storage. Generate waveform array client-side during recording; store as a JSON column on the message row.

---

## Sources

- [Signal Wiki — Message Delivery](https://signal.miraheze.org/wiki/Message_delivery)
- [Signal Blog — A Synchronized Start for Linked Devices (attachment pointer details)](https://signal.org/blog/a-synchronized-start-for-linked-devices/)
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [tus.io — Resumable File Uploads](https://tus.io)
- [Engineering at Meta — Building Facebook Messenger](https://engineering.fb.com/2011/08/12/android/building-facebook-messenger/)
- [Filestack — Handling Large File Uploads](https://blog.filestack.com/handling-large-file-uploads/)
