---
name: whatsapp-photo-send-failure-ux
description: WhatsApp photo/image send failure UX — sender states (clock/progress/failed), recipient visibility, retry mechanism, edge cases, upload-first architecture evidence
metadata:
  type: reference
---

# WhatsApp Photo Send Failure UX

## Sender-Side Visual States

**State 1 — Pending (no connectivity yet):** Clock icon in the bottom-right corner of the bubble, same position where tick marks normally appear. Applies to text and media alike. The image thumbnail IS shown normally; the clock is below/next to the bubble, not overlaid on the image itself.

**State 2 — Uploading:** A circular progress indicator appears overlaid on the photo thumbnail (the thumbnail is visible but dimmed/overlaid). For larger files the upload can be slow. A cancel (X) button is present during active upload — tapping it cancels the upload. No hard public source confirmed the exact pixel-level overlay design; this is inferred from multiple UX descriptions and protocol behavior.

**State 3 — Failed:** The clock is replaced by a red exclamation mark (! inside a red circle). The thumbnail remains visible in the bubble. To retry: tap the red ! — a context menu appears with "Resend" (or "Retry sending") option. You can also long-press the bubble and get the same menu. The user is NOT asked to re-pick the image; WhatsApp retains the local file reference and retries from where it was.

**State 4 — Sent (upload complete, on server):** Single gray tick. Message has left the device.

**State 5 — Delivered:** Double gray tick.

**State 6 — Read:** Double blue tick.

## Recipient-Side UI

**While upload is in progress or failed on sender side:** The recipient sees NOTHING. No bubble, no placeholder. WhatsApp uses upload-first delivery: the full encrypted image is uploaded to CDN/S3 first; the message (containing the download URL + decryption key) is only delivered AFTER upload completes. A failed send = zero visibility to recipient.

**Once delivered and not yet downloaded by recipient:** Recipient sees the image bubble with a blurred/low-resolution thumbnail (a tiny JPEG embedded in the message protobuf). A download arrow icon appears (bottom of the bubble). File size may be shown. Auto-download behavior depends on recipient's WhatsApp settings (WiFi-only, always, never).

**After recipient downloads:** Full-res image replaces blurred thumbnail.

## Architecture Evidence for Upload-First

1. The whatsmeow (Go) library — which reverse-engineers the WhatsApp protocol — shows explicit two-step: `cli.Upload()` returns a media_id/URL, THEN `cli.SendMessage()` with the media metadata. Source: GitHub discussion #498 on tulir/whatsmeow.
2. The message payload contains the encrypted media URL + a small JPEG thumbnail embedded in the protobuf. The thumbnail travels WITH the message; the full image is a separate CDN download.
3. Community observation: recipients never see a broken/empty image bubble when sender's upload fails — consistent with upload-first only.
4. WhatsApp Business Cloud API docs confirm: "upload media first, get media_id, then send message referencing the media_id."

Conclusion: Upload-first is definitive. The message is the envelope; it only gets sent after the media is safely on CDN.

## Edge Cases

**App killed mid-send:** On reopen, the pending/failed message persists in the conversation with the thumbnail visible and the retry icon. WhatsApp keeps a local reference to the original file as long as it hasn't been deleted from the device. No data is lost; the user can tap retry.

**No internet at send time:** Message goes to "pending" state (clock icon), thumbnail shown. When connectivity returns, WhatsApp auto-retries — no user action required. It queues and sends automatically.

**Connection drops mid-upload (partial upload):** WhatsApp shows the failed state (red !) immediately. No partial uploads get delivered to the recipient. The user must manually retry. No automatic retry on partial failure (unlike the "no internet at all" case which auto-queues).

**Local source file deleted:** If the original image is deleted from the device gallery after tapping Send but before the upload completes, WhatsApp may show an error. However, WhatsApp makes a working copy of the file internally during the send process, so this scenario is more nuanced. If the internal copy is still present, retry works. If the internal copy is gone (e.g., device storage pressure cleared it), retry likely fails with an error and the message must be deleted and resent from scratch.

**Group chat vs 1:1:** No behavioral difference in failed-send UI. The same clock → progress → red ! progression applies. In groups, the same recipient-sees-nothing-until-upload-succeeds rule applies.

**Multiple queued photos (one fails):** Each photo message has its own independent state. If you send 3 photos quickly and the 2nd upload fails, photos 1 and 3 succeed, photo 2 shows the red ! independently. Each is retried individually.

**Failed message in chat list preview:** The failed photo DOES appear in the conversation and chat list. The chat list shows the last message state; a failed send is shown in the conversation but may show "Sending failed" or similar in the chat list preview (not consistently documented).

## Key Numbers / Behavior Summary

| Event | Sender sees | Recipient sees |
|-------|-------------|----------------|
| Tap send (no internet) | Thumbnail + clock icon | Nothing |
| Upload in progress | Thumbnail (dimmed) + circular progress + cancel X | Nothing |
| Upload complete, message sent | Thumbnail + single gray tick | Blurred thumbnail + download button |
| Recipient downloads | Thumbnail + double gray tick / blue ticks | Full-res image |
| Send fails | Thumbnail + red ! | Nothing |
| User taps red ! | Context menu: Resend / Delete | — |
