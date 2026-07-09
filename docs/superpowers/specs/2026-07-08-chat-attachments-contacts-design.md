# Chat Attachments (Files) + Contacts — Design

**Date:** 2026-07-08
**Author:** Ohad
**Status:** Approved design → implementation plan next

## Goal

Add two WhatsApp-style capabilities to **both** the private DM chat (`DirectMessageScreen`) and the group chat (`DirectGroupChat`):

1. **File attachments** — send arbitrary documents securely (no attack exposure).
2. **Contacts** — share a device phone contact as a message card.

Both are reached through a new WhatsApp-style **attach bottom sheet** opened from the composer `+` button.

## Non-Goals (v1)

- No virus/malware scanning (validation only — see Security).
- No detection of whether a shared phone number belongs to a Swellyo user (no "Message in Swellyo" deep-link). Deferred to possible phase 2.
- No "Add to contacts" / "Call" / "SMS" actions on the received contact card — **display only** in v1.
- No Location / Poll / Event options (WhatsApp has them; out of scope).

## Current State (verified)

- `+` button (`leftAccessory` in `DirectMessageScreen.tsx` ~line 4789) calls `handleImagePicker` **directly** — no menu today.
- `MessageType = 'text' | 'image' | 'video' | 'audio' | 'commitment_request'` (`messagingService.ts:68`).
- Media metadata lives in separate per-type fields on the `Message` interface (`image_metadata`, `video_metadata`, `audio_metadata`, `commitment_metadata`).
- Media uploads use an **upload-first** outbox flow (WhatsApp-style: a failed send leaves nothing on the server — no ghost message).
- Presigned uploads go through the `image-upload-s3` edge function, action `get-message-upload-url`, which **validates `conversation_members` membership** but hardcodes the key to `.../original.jpg` and content-type `image/jpeg`.
- `expo-image-picker` is installed. **`expo-document-picker` and `expo-contacts` are NOT installed.**
- `BottomSheetShell` is the mandatory wrapper for all bottom sheets (fade backdrop + slide + swipe + Android edge-to-edge nav-bar fix).

## Architecture

### A. Attach bottom sheet (shared component)

New component `AttachSheet` built on `BottomSheetShell`. WhatsApp-style grid of options:

| Option | Action |
|--------|--------|
| Photos | existing `handleImagePicker` |
| Camera | existing `handleCameraCapture` |
| Document | new file flow (§C) |
| Contact | new contact flow (§D) |

- The `+` button (`leftAccessory`) opens `AttachSheet` instead of calling `handleImagePicker` directly.
- Wired into **both** `DirectMessageScreen` and `DirectGroupChat` from the same component — no duplicated menu logic.
- Icons/labels follow the app's existing icon set + `ff()` typography.

### B. Data model

`MessageType` gains `'file' | 'contact'`.

Two new **nullable JSONB columns** on `public.messages` (mirrors the existing `*_metadata` pattern), applied **by hand via the Supabase SQL editor** (never `supabase db push` — remote history is frozen; migrations applied manually):

```sql
alter table public.messages add column if not exists file_metadata    jsonb;
alter table public.messages add column if not exists contact_metadata jsonb;
```

TypeScript interfaces:

```ts
interface FileMetadata {
  storage_path: string;   // message-files/{convId}/{msgId}/file.<ext>
  display_name: string;   // sanitized original filename (for UI only)
  mime_type: string;
  ext: string;            // lowercased, no dot
  size_bytes: number;
}

interface ContactMetadata {
  display_name: string;
  phone_numbers: { label?: string; number: string }[];
  emails?: { label?: string; email: string }[];
}
```

Added to the `Message` interface as `file_metadata?: FileMetadata | null` and `contact_metadata?: ContactMetadata | null`.

**Preview text** (`messagePreviewText.ts`) + reply snapshots (`ReplyToSnapshot.body`): `'📎 <filename>'` for files, `'👤 <name>'` for contacts.

### C. File flow (secure)

1. **Pick** — `expo-document-picker` (`getDocumentAsync`, `copyToCacheDirectory: true`).
2. **Validate (client)** before anything touches the network:
   - Extension **allowlist** (see Security). Reject with a friendly alert (`friendlyErrorMessage`) otherwise.
   - MIME sanity check against the extension.
   - **Size cap 25 MB** — reject oversize.
3. **Upload-first** — mirror the existing image/video outbox: create the local optimistic message, upload the bytes, and only persist the DB row on upload success. A failed upload leaves nothing on the server.
   - Upload via a **new edge action `get-message-file-upload-url`** on `image-upload-s3` (see below).
   - Storage key: `message-files/{conversationId}/{messageId}/file.<ext>` — random (msgId), user filename never in the path.
4. **Send** `type='file'` with `file_metadata`.
5. **Render** — `FileBubble`: file-type icon + sanitized name + human size. Tap → obtain presigned GET (with `Content-Disposition: attachment`) → open via OS (`expo-sharing` / `Linking` / download). **Never** rendered in an in-app WebView.

#### New edge action `get-message-file-upload-url` (in `image-upload-s3/index.ts`)

- Input: `{ conversationId, messageId, ext, contentType }`.
- **Validates `conversation_members` membership** (identical check to `get-message-upload-url`).
- **Server-side allowlist**: refuses to sign a URL for any ext/content-type not on the allowlist (defense in depth — bypassing the client yields nothing).
- Binds the presigned PUT to the requested (allowlisted) `Content-Type`.
- Returns the presigned PUT URL for key `message-files/{conversationId}/{messageId}/file.<ext>`.
- Deployed by copy-paste into the Supabase dashboard (per project convention). Because `image-upload-s3` may have drifted from the repo, **download the live version and diff before deploying**.

### D. Contact flow

1. **Pick** — `expo-contacts` (permission-gated: request `Contacts` permission; if denied, friendly alert). Present the native contact picker (`presentContactPickerAsync` where available, else `getContactsAsync` + an in-app list).
2. **Send** `type='contact'` with `contact_metadata` (name + phone numbers + optional emails). No upload — data is inline in the row.
3. **Render** — `ContactBubble`: avatar placeholder + name + phone number(s). Numbers are **tappable to copy** (Clipboard). **No** add/call/SMS buttons in v1.

## Security (files) — validation only, no new infra

1. **Client allowlist** (extension + MIME) before upload.
   - **ALLOW:** `pdf, doc, docx, xls, xlsx, ppt, pptx, csv, txt, rtf, zip, png, jpg, jpeg, gif, webp, heic, mp3, m4a, wav, mp4, mov` (final list refined during implementation).
   - **BLOCK (explicit):** `exe, app, sh, bash, apk, bat, cmd, com, msi, js, mjs, html, htm, svg, xhtml, jar, scr, dll, so, dylib, ps1, vbs`.
2. **Edge allowlist** — the edge fn will not sign an upload URL for a non-allowlisted ext/content-type. Client validation is convenience; the edge is the real gate.
3. **Size cap 25 MB** — enforced client-side pre-upload. (Presigned PUT does not hard-enforce size at S3; acceptable because only conversation **members** can obtain a presign. Residual risk noted.)
4. **Random storage key** — keyed by `messageId`; the user-supplied filename is never used in the storage path.
5. **Sanitized display name** — strip path separators and control chars, collapse to a single extension, cap length. Used for UI display only.
6. **Membership-checked** presign + reads — reuse the existing `conversation_members` gate; bucket reads limited to members (same posture as chat images).
7. **Never executed or rendered in-app** — files open through the OS; presigned GET sets `Content-Disposition: attachment` so web browsers download rather than inline-render. `html`/`svg` are blocked outright by the allowlist.

## Build / Deploy notes

- **Native rebuild required** — new native deps (`expo-document-picker`, `expo-contacts`). Contacts also needs:
  - iOS `NSContactsUsageDescription` (Info.plist via `app.json` / config plugin).
  - Android `READ_CONTACTS` permission.
  - **Not OTA-able.** Walk `PRE_BUILD_CHECKLIST.md` before any build/ship.
- Both `expo-document-picker` and `expo-contacts` are Expo SDK packages available in **Expo Go** for on-device testing (no `isExpoGo` guard needed), but the permission strings still require a dev/prod native build.
- DB columns applied **manually** via SQL editor.
- Edge fn deployed by copy-paste; **diff against the live version first** (drift).

## Testing

- `tsc` clean + code review.
- Ohad tests on device (no simulator/Maestro).
- Manual matrix: send/receive file (allowed + blocked + oversize) and contact in both DM and group chat; reply-quote both new types; preview text in conversation list.

## Files touched (anticipated)

- `src/components/AttachSheet.tsx` — **new** shared attach sheet.
- `src/components/messages/FileBubble.tsx`, `ContactBubble.tsx` — **new** bubbles.
- `src/services/messaging/messagingService.ts` — `MessageType`, interfaces, `sendFileMessage` / `sendContactMessage`.
- `src/services/messaging/fileUploadService.ts` — **new** (allowlist/validation/upload), sibling to `imageUploadService.ts`.
- `src/services/messaging/messagePreviewText.ts` — file/contact preview strings.
- `src/screens/DirectMessageScreen.tsx`, `src/screens/DirectGroupChat.tsx` — wire `+` → `AttachSheet`, render new bubbles.
- `supabase/functions/image-upload-s3/index.ts` — new `get-message-file-upload-url` action.
- `app.json` — contacts permission strings.
- DB migration (manual SQL) — `file_metadata`, `contact_metadata` columns.
