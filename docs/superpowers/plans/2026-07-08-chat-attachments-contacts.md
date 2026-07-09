# Chat Attachments (Files) + Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add WhatsApp-style secure file attachments and phone-contact sharing to both the private DM chat (`DirectMessageScreen`) and group chat (`DirectGroupChat`), reached via a new attach bottom sheet on the composer `+` button.

**Architecture:** Two new message types (`file`, `contact`) with nullable JSONB metadata columns. Files use the existing upload-first outbox pattern (client UUID → upload → idempotent create), uploaded through a new membership-checked, allowlist-gated presigned-PUT action on `image-upload-s3` and downloaded via a fresh presigned GET (private, `Content-Disposition: attachment`). Contacts carry inline metadata (no upload). Shared UI (`AttachSheet`, `FileBubble`, `ContactBubble`) and services keep the two giant screens thin.

**Tech Stack:** React Native 0.81 / Expo 54, Supabase (S3 presign via edge fn), `expo-document-picker`, `expo-contacts`, `expo-crypto`, `expo-file-system/legacy`, `expo-sharing`, jest-expo.

## Global Constraints

- Migrations applied **by hand via SQL editor** — never `supabase db push`.
- Edge fn deployed by **copy-paste into the Supabase dashboard**; `image-upload-s3` may have drifted — **download live + diff before deploying**.
- File allowlist is the real gate at the **edge**; client validation is convenience.
- Files **never** executed/rendered in-app — open via OS only.
- Max file size **25 MB**.
- Contact card is **display-only** in v1 (name + numbers, tap-to-copy).
- Native rebuild required (`expo-document-picker`, `expo-contacts`); **not OTA-able**. Walk `PRE_BUILD_CHECKLIST.md` before any build.
- Use `ff()` typography, `friendlyErrorMessage`/`showErrorAlert`, `BottomSheetShell` for the sheet.
- Do not commit (Ohad reviews/commits manually).

---

### Task 1: Types, metadata columns, preview text

**Files:**
- Modify: `src/services/messaging/messagingService.ts` (MessageType ~line 68, interfaces ~line 100-190)
- Modify: `src/services/messaging/messagePreviewText.ts`
- DB: manual SQL (below)

**Interfaces produced:**
```ts
type MessageType = 'text' | 'image' | 'video' | 'audio' | 'commitment_request' | 'file' | 'contact';
interface FileMetadata { storage_path: string; display_name: string; mime_type: string; ext: string; size_bytes: number; }
interface ContactMetadata { display_name: string; phone_numbers: { label?: string; number: string }[]; emails?: { label?: string; email: string }[]; }
// Message gains: file_metadata?: FileMetadata | null; contact_metadata?: ContactMetadata | null;
```

- [ ] **Step 1:** Add `'file' | 'contact'` to `MessageType`; add `FileMetadata`/`ContactMetadata` interfaces; add `file_metadata`/`contact_metadata` optional fields to `Message`.
- [ ] **Step 2:** Extend `messagePreviewText.ts`: add `file_metadata`/`contact_metadata` to `PreviewableMessage`; return `'📎 ' + (m.file_metadata?.display_name ?? 'File')` for file, `'👤 ' + (m.contact_metadata?.display_name ?? 'Contact')` for contact (before the `body` fallback).
- [ ] **Step 3:** DB migration (apply manually in SQL editor):
```sql
alter table public.messages add column if not exists file_metadata    jsonb;
alter table public.messages add column if not exists contact_metadata jsonb;
```
- [ ] **Step 4:** `npx tsc --noEmit` clean.

---

### Task 2: File attachment policy (pure, unit-tested)

**Files:**
- Create: `src/services/messaging/fileAttachmentPolicy.ts`
- Test: `src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`

**Interfaces produced:**
```ts
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTS: Set<string>;      // pdf, doc(x), xls(x), ppt(x), csv, txt, rtf, zip, png, jpg, jpeg, gif, webp, heic, mp3, m4a, wav, mp4, mov
const BLOCKED_EXTS: Set<string>;      // exe, app, sh, bash, apk, bat, cmd, com, msi, js, mjs, html, htm, svg, xhtml, jar, scr, dll, so, dylib, ps1, vbs
function extOf(name: string): string;                 // lowercased, no dot, last segment
function sanitizeDisplayName(name: string): string;   // strip path seps/control chars, collapse whitespace, cap 120 chars, keep single ext
function isAllowedExt(ext: string): boolean;          // in ALLOWED and not in BLOCKED
function contentTypeFor(ext: string): string;         // map to MIME; fallback application/octet-stream
function formatBytes(n: number): string;              // "1.2 MB"
function validateFile(name: string, sizeBytes: number): { ok: true; ext: string; displayName: string; contentType: string } | { ok: false; reason: string };
```

- [ ] **Step 1: failing test** — `validateFile` rejects `.exe`, rejects `> 25MB` (reason mentions size), accepts `report.pdf`; `sanitizeDisplayName('../../etc/passwd')` has no `/`; `extOf('a.tar.gz')==='gz'`; `formatBytes(1536)==='1.5 KB'` (or your rounding). Write 6–8 assertions.
- [ ] **Step 2:** Run `npx jest fileAttachmentPolicy -i` → FAIL (module not found).
- [ ] **Step 3:** Implement `fileAttachmentPolicy.ts` per interface.
- [ ] **Step 4:** Run `npx jest fileAttachmentPolicy -i` → PASS.

---

### Task 3: Edge function — file upload + download actions

**Files:**
- Modify: `supabase/functions/image-upload-s3/index.ts`

Add BEFORE the `if (userId !== user.id)` line (these are membership-authorized, not userId-authorized). Mirror the ALLOWED map + `contentTypeFor` on the server (duplicate the allowlist — edge can't import client TS).

- [ ] **Step 1:** `get-message-file-upload-url` action:
```ts
if (action === "get-message-file-upload-url") {
  const { conversationId, messageId, ext, contentType } = body as {
    conversationId?: string; messageId?: string; ext?: string; contentType?: string;
  };
  if (!conversationId || !messageId || !ext) return json({ error: "bad input" }, 400);
  const e = String(ext).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!FILE_ALLOWED.has(e)) return json({ error: "file type not allowed" }, 400);
  const { data: membership } = await admin
    .from("conversation_members").select("user_id")
    .eq("conversation_id", conversationId).eq("user_id", user.id).maybeSingle();
  if (!membership) return json({ error: "not a conversation member" }, 403);
  const ct = FILE_CONTENT_TYPE[e] ?? "application/octet-stream";
  const objectKey = `message-files/${conversationId}/${messageId}/file.${e}`;
  const uploadUrl = await generatePresignedUrl("PUT", objectKey, 3600, ct);
  return json({ uploadUrl, key: objectKey, contentType: ct });
}
```
- [ ] **Step 2:** `get-message-file-download-url` action — presigned GET, membership-checked, forces download:
```ts
if (action === "get-message-file-download-url") {
  const { conversationId, storagePath } = body as { conversationId?: string; storagePath?: string; };
  if (!conversationId || !storagePath) return json({ error: "bad input" }, 400);
  if (!storagePath.startsWith(`message-files/${conversationId}/`)) return json({ error: "bad path" }, 400);
  const { data: membership } = await admin
    .from("conversation_members").select("user_id")
    .eq("conversation_id", conversationId).eq("user_id", user.id).maybeSingle();
  if (!membership) return json({ error: "not a conversation member" }, 403);
  const downloadUrl = await generatePresignedUrl("GET", storagePath, 900);
  return json({ downloadUrl });
}
```
- [ ] **Step 3:** Add `FILE_ALLOWED: Set<string>` and `FILE_CONTENT_TYPE: Record<string,string>` consts near the top ALLOWED map (mirror the client allowlist exactly).
- [ ] **Step 4:** Deploy note only (copy-paste manually; diff live first). No automated test.

> Note: `aws.ts generatePresignedUrl` supports `'GET'` already (verified). `message-files/` is a new prefix — assumed private (not public), so presigned GET is required to read. If bucket policy blocks signed GET, revisit.

---

### Task 4: fileUploadService (client upload + download URL)

**Files:**
- Create: `src/services/messaging/fileUploadService.ts`

**Interfaces produced:**
```ts
function uploadFileToStorage(localUri: string, conversationId: string, messageId: string, ext: string): Promise<{ storagePath: string }>;
function getFileDownloadUrl(conversationId: string, storagePath: string): Promise<string>;
```

- [ ] **Step 1:** `uploadFileToStorage` — POST `get-message-file-upload-url` (auth header + apikey, same as `imageUploadService.uploadImageToStorage`) with `{ ext, contentType: contentTypeFor(ext) }`; then PUT the bytes. Native: `expo-file-system/legacy uploadAsync` BINARY_CONTENT with header `Content-Type: <ct>`. Web: `fetch(uploadUrl, { method:'PUT', headers:{'Content-Type': ct}, body: await uriToBlob(localUri) })`. Return `{ storagePath: key }`.
- [ ] **Step 2:** `getFileDownloadUrl` — POST `get-message-file-download-url` with `{ conversationId, storagePath }`; return `downloadUrl`.
- [ ] **Step 3:** `npx tsc --noEmit` clean.

---

### Task 5: messagingService create methods

**Files:**
- Modify: `src/services/messaging/messagingService.ts`

**Interfaces produced:**
```ts
createFileMessageWithMetadata(conversationId: string, fileMetadata: FileMetadata, clientId: string): Promise<Message>;
createContactMessageWithMetadata(conversationId: string, contactMetadata: ContactMetadata, clientId: string): Promise<Message>;
```

- [ ] **Step 1:** Add both methods, copying `createImageMessageWithMetadata`'s auth + idempotent upsert (`onConflict: 'sender_id,client_id', ignoreDuplicates:true`) exactly, with `type:'file'`/`file_metadata` and `type:'contact'`/`contact_metadata` respectively, `body:''`. Bump `conversations.updated_at`.
- [ ] **Step 2:** `npx tsc --noEmit` clean.

---

### Task 6: AttachSheet component

**Files:**
- Create: `src/components/AttachSheet.tsx`

**Interfaces produced:**
```ts
interface AttachSheetProps { visible: boolean; onClose: () => void; onPhotos: () => void; onCamera: () => void; onDocument: () => void; onContact: () => void; }
```

- [ ] **Step 1:** Build on `BottomSheetShell`. 2×2 grid (Photos 🖼, Camera 📷, Document 📄, Contact 👤) using existing Ionicons + `ff()` labels. Each tile: `onClose()` then the handler (close first so the sheet dismisses before the OS picker opens). Web: hide Camera tile (`Platform.OS==='web'`).
- [ ] **Step 2:** `npx tsc --noEmit` clean.

---

### Task 7: FileBubble + ContactBubble

**Files:**
- Create: `src/components/messages/FileBubble.tsx`
- Create: `src/components/messages/ContactBubble.tsx`

**Interfaces produced:**
```ts
interface FileBubbleProps { message: Message; isOwn: boolean; }      // renders icon + display_name + formatBytes(size); onPress → download+open
interface ContactBubbleProps { message: Message; isOwn: boolean; }   // avatar placeholder + name + numbers (tap number → copy)
```

- [ ] **Step 1:** `FileBubble` — file-type icon (ext-based), `display_name`, `formatBytes(size_bytes)`. onPress: `getFileDownloadUrl` → open via OS: native `expo-sharing` (`Sharing.shareAsync` after downloading to cache with `expo-file-system/legacy`) or `Linking.openURL(downloadUrl)`; web `window.open(downloadUrl)`. Guard double-tap with a loading flag.
- [ ] **Step 2:** `ContactBubble` — avatar placeholder circle + name + number rows; tap number copies via `expo-clipboard` (`Clipboard.setStringAsync`) with a brief toast/alert. No call/SMS buttons.
- [ ] **Step 3:** `npx tsc --noEmit` clean.

---

### Task 8: contactPicker util

**Files:**
- Create: `src/services/messaging/contactPicker.ts`

**Interfaces produced:**
```ts
function pickContact(): Promise<ContactMetadata | null>;  // null on cancel/deny
```

- [ ] **Step 1:** Request `Contacts.requestPermissionsAsync()`; if denied → friendly alert + return null. Use `Contacts.presentContactPickerAsync()` when available (iOS); else `Contacts.getContactsAsync({fields:[PhoneNumbers,Emails]})` + a simple in-app list modal (fallback). Map to `ContactMetadata` (name, phoneNumbers[].number+label, emails). Return null on cancel.
- [ ] **Step 2:** `npx tsc --noEmit` clean.

---

### Task 9: Wire into DirectMessageScreen

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx`

- [ ] **Step 1:** Add `attachSheetVisible` state. Change `+` `leftAccessory onPress` (~line 4791) from `handleImagePicker` to `() => setAttachSheetVisible(true)`. Render `<AttachSheet visible onPhotos={handleImagePicker} onCamera={handleCameraCapture} onDocument={handlePickDocument} onContact={handlePickContact} />`.
- [ ] **Step 2:** `handlePickDocument` — `DocumentPicker.getDocumentAsync({copyToCacheDirectory:true, multiple:false})`; on asset: `validateFile(name, size)` → friendly alert if `!ok`; else `handleFileSend(uri, displayName, ext, contentType, size)`.
- [ ] **Step 3:** `handleFileSend` — mirror `handleImageSend` upload-first: `clientId=Crypto.randomUUID()`, optimistic row `type:'file'`, `file_metadata:{display_name, ext, size_bytes, mime_type, storage_path:''}`, `upload_state:'uploading'`; `uploadFileToStorage(uri, convId, clientId, ext)` → build final `file_metadata` with `storage_path` → `createFileMessageWithMetadata` → swap optimistic→server; on error mark `failed` + `friendlyErrorMessage`.
- [ ] **Step 4:** `handlePickContact` — `pickContact()`; if result: `clientId=Crypto.randomUUID()`, optimistic `type:'contact'` row (`upload_state:'sent'` — no upload) → `createContactMessageWithMetadata` → swap; on error mark failed.
- [ ] **Step 5:** In the message renderer, add branches: `message.type === 'file'` → `<FileBubble>`, `message.type === 'contact'` → `<ContactBubble>` (find where `type==='image'`/`'video'` bubbles render).
- [ ] **Step 6:** `npx tsc --noEmit` clean; on-device smoke (Ohad).

---

### Task 10: Wire into DirectGroupChat

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx`

- [ ] **Step 1:** Repeat Task 9 Steps 1–5 against `DirectGroupChat` (same handler bodies; adapt local variable names for conversation/user id used in this screen). Reuse the shared components/services — no duplicated bubble/policy/upload logic.
- [ ] **Step 2:** `npx tsc --noEmit` clean; on-device smoke (Ohad).

---

### Task 11: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` clean across the repo.
- [ ] **Step 2:** `npx jest fileAttachmentPolicy -i` PASS.
- [ ] **Step 3:** Invoke `verify` skill / code review. Confirm: allowlist enforced at edge, no filename in storage key, files open via OS only, presigned GET is short-lived + membership-checked.
- [ ] **Step 4:** Summarize deploy checklist: apply SQL, deploy edge fn (diff live first), native rebuild (PRE_BUILD_CHECKLIST), then on-device test matrix (allowed/blocked/oversize file + contact, DM + group, reply-quote, conversation-list preview).

## Self-Review

- **Spec coverage:** attach sheet (T6/T9/T10), file types+security (T2/T3/T4/T7), contact display-only (T7/T8), data model (T1), preview text (T1), rebuild notes (Global Constraints/T11). ✓
- **Placeholders:** none — concrete code/consts given; allowlist enumerated once and mirrored at edge.
- **Type consistency:** `FileMetadata`/`ContactMetadata`/`validateFile`/`uploadFileToStorage`/`getFileDownloadUrl`/`createFileMessageWithMetadata`/`createContactMessageWithMetadata`/`pickContact` names consistent across tasks. ✓
