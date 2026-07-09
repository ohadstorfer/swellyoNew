# Attachment review screen — documents and contacts

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Problem

Picking a document or a contact from the chat attach sheet sends it immediately. There is no confirmation step, no way to back out, and no way to see what you actually picked. Photos and videos already route through `ImagePreviewModal` / `VideoPreviewModal`; documents and contacts do not.

WhatsApp shows a review screen for both. We want the same.

## Goals

- A document opens a preview screen before sending. Cancelling sends nothing and uploads nothing.
- A contact opens a review screen before sending, where the user picks which phone numbers and emails to share.
- Documents support a caption, as in WhatsApp.

## Non-goals

Called out explicitly, both are things WhatsApp does that we will not:

1. **Selecting multiple contacts at once.** `expo-contacts`' `presentContactPickerAsync` returns exactly one contact. Supporting several means building our own contact list UI — a separate feature.
2. **Rendering a CSV as a bordered table.** We render raw text. Seeing the first lines confirms the right file was picked, which is all a preview needs to do.

## Current behavior

| Surface | File | Reference |
|---|---|---|
| Pick | `pickDocument()` → `handleFileSend()` | `DirectMessageScreen.tsx:2970`, `DirectGroupChat.tsx:2768` |
| Pick | `pickContact()` → optimistic insert → send | `DirectMessageScreen.tsx:2987`, `DirectGroupChat.tsx:2786` |
| Upload | `uploadAndCreateFile()` (duplicated per screen) | `DirectMessageScreen.tsx:2931`, `DirectGroupChat.tsx:2724` |
| Row insert | `createTypedMessageWithMetadata()` | `messagingService.ts:1278` |

Both screens carry near-identical copies of the pick/upload logic. This design does not consolidate them — that is unrelated refactoring — but any change below must be applied to both.

## Design

### `FilePreviewModal`

Full-screen dark modal, built to the same shape as `ImagePreviewModal`: dark backdrop, close X top-left, swipe-down to dismiss, `ChatTextInput` docked at the bottom with the green send button.

- **Header:** X + the sanitized `display_name`.
- **Body:** dispatched on extension by a new pure function `previewKindForExt(ext): 'image' | 'pdf' | 'text' | 'none'`, added to `fileAttachmentPolicy.ts` (where the allowlist already lives, and which already has unit tests).

  | Kind | Extensions | Renderer |
  |---|---|---|
  | `image` | `png jpg jpeg gif webp heic` | `expo-image`, contained and centered |
  | `pdf` | `pdf` | `react-native-pdf`, scroll + zoom |
  | `text` | `txt csv` | monospace `ScrollView`, **only when `size_bytes <= 256 KB`** |
  | `none` | everything else | file card |

  The **file card** is the fallback: large extension icon (reusing `iconForExt` from `FileBubble`), display name, and `CSV · 2 KB`. A `txt`/`csv` over the size cap also lands here, with the sub-label "Too large to preview".

- **Footer:** caption input, placeholder "Add a comment…", `allowEmpty` so a file can be sent with no caption — the same flag `ImagePreviewModal` uses.
- **Cancel sends nothing.** No upload starts until send is pressed.

### `ContactPreviewModal`

Full-screen modal, same skeleton.

- **Header:** X, title "Send contact", and a "Send" pill on the right.
- **Body:** avatar and name, then one row per phone number and per email, each with a checkbox. All checked by default.
- Unchecking everything disables Send — a contact with no data is not worth sending.
- No caption (WhatsApp has none here).
- What stays checked is what gets written to `contact_metadata`.

`contactPicker.ts` is unchanged: it still returns the full `ContactMetadata`. Filtering happens in the modal.

### Native dependencies

Three new native deps: `react-native-pdf`, its peer `react-native-blob-util`, and `expo-file-system`. The chat-attachments feature already requires a native rebuild before it reaches users, so these cost no extra build cycle.

**Expo Go guard.** Ohad tests in Expo Go, where `react-native-pdf` does not exist. As with `expo-contacts` and `expo-document-picker`, `require()` of an absent native module returns a **lazy proxy that does not throw until a method is accessed**. The PDF renderer therefore follows the same guarded pattern already used in `contactPicker.ts` and `documentPicker.ts`: `require()` inside a `try`, verify the component is really there, and on failure fall back to the file card — silently, with no alert. In Expo Go a PDF shows the card; in a native build it renders. Images and text work in both.

If `react-native-pdf` does not build cleanly against Expo 54 / RN 0.81, we drop `pdf` to `'none'` in `previewKindForExt` and ship. Nothing else changes — the fallback path already exists.

### Caption plumbing

The caption is legal without a migration: `check_message_type` (`add_message_file_and_contact_metadata.sql:29`) does not constrain `body` for `file` or `contact`.

It touches four surfaces:

1. `createTypedMessageWithMetadata()` takes a `body` param and writes it to the payload.
2. Both `uploadAndCreateFile()` copies take a `body` param and thread it through; both `handleFileSend()` copies take a `caption`.
3. `FileBubble` renders the caption below the file row.
4. `messagePreviewText()` returns the caption when present, falling back to `📎 <name>`.

### Push notification fix (pre-existing bug)

`send-push-notification/index.ts:116` ends in `else { body = truncateForPush(msg.body || '') }`. Messages of type `file` and `contact` have `body = ''`, so **today they push with an empty body.** Nobody covered those branches when the types were added.

Fix, in the same edge function:

- `file` → the caption when present, otherwise `"Sent a file"`.
- `contact` → `"Shared a contact"`.

Requires an edge-function deploy. Download and diff the live version first — this function has drifted from the repo before.

### Security

`FileBubble` documents the posture that a **received** file is never rendered or executed in-app; it opens through the OS share sheet. That is unchanged.

This preview renders only the local file the sender just chose in their own picker, before upload. Different threat model, and it does not weaken the receive path. `react-native-pdf` never parses an attacker-supplied document.

## Files touched

**New**
- `src/components/FilePreviewModal.tsx`
- `src/components/ContactPreviewModal.tsx`

**Modified**
- `src/services/messaging/fileAttachmentPolicy.ts` — `previewKindForExt()`, plus tests
- `src/services/messaging/messagingService.ts` — `body` param
- `src/components/messages/FileBubble.tsx` — render caption
- `src/services/messaging/messagePreviewText.ts` — prefer caption
- `src/screens/DirectMessageScreen.tsx` — modal state, caption threading
- `src/screens/DirectGroupChat.tsx` — same, mirrored
- `supabase/functions/send-push-notification/index.ts` — file/contact push bodies
- `package.json` — three deps

## Acceptance criteria

1. Picking a document opens the preview. Closing it sends nothing and uploads nothing.
2. A PDF renders in a native build; in Expo Go it shows the file card with no crash and no alert.
3. An image document renders on both platforms.
4. A `csv` under 256 KB renders as raw text; over the cap it shows the card with "Too large to preview".
5. A `zip` (or any `none` kind) shows the card.
6. A caption typed in the preview appears under the file bubble, in the conversation list, and in the push.
7. Picking a contact opens the review screen with every number and email checked.
8. Unchecking a number excludes it from the sent `contact_metadata`.
9. Unchecking everything disables Send.
10. Sending a file with no caption pushes `"Sent a file"`, not an empty body.
11. Both flows behave identically in `DirectMessageScreen` and `DirectGroupChat`.

## Testing

- Unit-test `previewKindForExt` against the full allowlist, alongside the existing `fileAttachmentPolicy` tests.
- Everything else is verified on-device by Ohad — no simulator or Maestro runs.
