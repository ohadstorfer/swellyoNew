---
name: project-chat-media-url-shapes-for-notifications
description: Public vs private/presigned URL shape for each chat message media type — determines whether the iOS NSE (no auth headers) can fetch it for rich notifications
metadata:
  type: project
---

Surveyed 2026-07-08 for a "rich chat push notification" feasibility question (expandable text / image preview / inline audio). See [[reference_ios_notification_service_extension_exists]] for the extension itself.

**Chat images** — PUBLIC URL, fetchable with no auth.
`src/services/messaging/imageUploadService.ts` `uploadImageToStorage()` — presigned PUT via `image-upload-s3` edge fn (`get-message-upload-url` action), but the returned `publicUrl` is a plain public S3 URL (`message-images/{conversationId}/{messageId}/{original|thumbnail}.jpg` in the public `swellyo-images` bucket, same key scheme as the legacy Supabase bucket). `ImageMetadata.image_url` / `.thumbnail_url` on the message row hold this public URL.

**Voice messages (audio)** — PUBLIC URL, fetchable with no auth.
`src/services/messaging/audioUploadService.ts` `uploadAudioToStorage()` — uploads to Supabase Storage bucket `message-images` (shared with chat images) at `{conversationId}/{messageId}/audio.m4a`, then calls `supabase.storage.from('message-images').getPublicUrl()`. `AudioMetadata.audio_url` on the message row holds this public URL. Format is m4a/AAC mono (`Audio.RecordingOptionsPresets.HIGH_QUALITY`, `numberOfChannels: 1`), recorded via `expo-av`'s `Audio.Recording` in `src/hooks/useVoiceRecorder.ts`. No hard duration cap found in the recorder (only a 500ms minimum, `MIN_RECORDING_MS`).

**Chat video** — PRIVATE/presigned, NOT directly fetchable by an NSE.
`src/services/messaging/videoUploadService.ts` — DM videos are explicitly private (comment at videoUploadService.ts:104 "DM videos are private (not public-readable)"), served via a short-lived presigned URL fetched on-demand (`original_url` presigned for instant playback pre-MediaConvert, `video_url` the compressed final). A notification extension cannot download this without first calling an authed edge fn to mint a presigned URL — extra round trip, and the existing NSE pattern (`URLSession.shared.dataTask`, no auth) doesn't support it as-is.

**Chat file attachments** — PRIVATE, presigned GET only, by design (never a public URL) — see `FileMetadata` comment in `src/services/messaging/messagingService.ts`.

**Push payload today**: `send-push-notification/index.ts` only puts the *avatar* URL (sender photo / group hero image) in `data.avatarUrl`, and text body in `data.message`. It does NOT currently carry the message's own image/audio/video URL — that would need to be added to `MessageContext`/the payload for a rich-media NSE feature (fetch `msg.image_metadata`/`msg.audio_metadata` alongside the existing `messages` select in `buildMessageContext()`, send-push-notification/index.ts:73-94).

**Body truncation**: text body truncated to 97 chars + "..." at send-push-notification/index.ts:93 for the Expo fallback path; image/audio/video messages get a fixed placeholder string ("Sent a photo" / "Sent a voice message" / "Sent a video"), never the actual caption or media. The NSE overwrites `bestAttempt.body` with the *raw, untruncated* `data.message` when building a Communication Notification (NotificationService.swift:33-39) — so on iOS with the extension working, long text is NOT truncated; the 97-char truncation only affects the non-extension fallback / Android.
