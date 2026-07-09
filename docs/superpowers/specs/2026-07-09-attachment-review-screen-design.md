# Attachment review screen — documents and contacts

**Date:** 2026-07-09
**Status:** Approved, ready for implementation plan

## Problem

Picking a document or a contact from the chat attach panel sends it immediately. There is no confirmation step, no way to back out, and no way to see what you actually picked. Photos and videos already route through `ImagePreviewModal` / `VideoPreviewModal`; documents and contacts do not.

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
| Menu | `AttachPanel` → `onDocument` / `onContact` | `DirectMessageScreen.tsx:5237`, `DirectGroupChat.tsx:5092` |
| Pick | `pickDocument()` → `handleFileSend()` | `DirectMessageScreen.tsx:3014`, `DirectGroupChat.tsx:2807` |
| Pick | `pickContact()` → optimistic insert → send | `DirectMessageScreen.tsx:3031`, `DirectGroupChat.tsx:2824` |
| Upload | `uploadAndCreateFile()` (duplicated per screen) | `DirectMessageScreen.tsx:2931`, `DirectGroupChat.tsx:2724` |
| Row insert | `createTypedMessageWithMetadata()` | `messagingService.ts:1278` |

The four handlers are **byte-for-byte identical** between the two screens — a `diff` of them produces no output. Extracting them into a shared hook is the obvious cleanup, and it is deliberately **out of scope**: both screens are under active concurrent edit, and a refactor of that size invites conflicts. Every change below is mirrored into both files instead. Flag the duplication as a follow-up.

Line numbers are as of `d1de6b3` and drift with every commit — locate by symbol name, not by line.

## Design

### `FilePreviewModal`

Full-screen dark modal, built to the same shape as `ImagePreviewModal`: dark backdrop, close X top-left, swipe-down to dismiss, `ChatTextInput` docked at the bottom with the green send button.

- **Header:** X + the sanitized `display_name`.
- **Body:** dispatched on extension by a new pure function `previewKindForExt(ext): 'image' | 'pdf' | 'text' | 'none'`, added to `fileAttachmentPolicy.ts` (where the allowlist already lives, and which already has unit tests).

  | Kind | Extensions | Renderer |
  |---|---|---|
  | `image` | `png jpg jpeg gif webp heic` | `expo-image`, contained and centered |
  | `pdf` | `pdf` | `react-native-pdf-renderer`, first page, no zoom |
  | `text` | `txt csv` | monospace `ScrollView`, **only when `size_bytes <= 256 KB`** |
  | `none` | everything else | file card |

  The **file card** is the fallback: large extension icon (reusing `iconForExt` from `FileBubble`), display name, and `CSV · 2 KB`. A `txt`/`csv` over the size cap also lands here, with the sub-label "Too large to preview".

  **The file card is also the failure path.** The PDF renderer is wrapped in an error boundary; on Expo Go, on a render error, or on a load error it degrades to the card. A blank white pane is therefore structurally impossible — either the PDF draws, or the user sees an honest card.

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

**One** new native dep: `react-native-pdf-renderer` (v2.3.0). Plus `expo-file-system`, which is already installed at 19.0.17 as a transitive dependency but must be declared explicitly in `package.json` — relying on an undeclared transitive dep is one `npm dedupe` away from breaking.

The chat-attachments feature already requires a native rebuild before it reaches users, so this costs no extra build cycle.

**Why not `react-native-pdf` (wonday), the obvious choice?** It is broken on exactly this stack. [wonday/react-native-pdf#969](https://github.com/wonday/react-native-pdf/issues/969) and [expo/examples#626](https://github.com/expo/examples/issues/626) both report the PDF rendering **blank on iOS under Expo SDK 54**; both are open and unanswered by the maintainer. It also drags in `react-native-blob-util` and two config plugins.

`react-native-pdf-renderer` instead: zero dependencies, no config plugin, autolinks against the committed `android/` and `ios/` folders, and is authored *as a Fabric component* (it ships a `codegenConfig`) — so `newArchEnabled: true` is its design target rather than a hope. Its README documents `file://` local URIs as the supported source, which is exactly what we hand it. Its issue tracker shows RN 0.76 and RN 0.83 both fixed, bracketing our 0.81.

**Residual risk:** RN 0.81.5 is not a version the maintainer tests directly (baseline 0.79.4). If it renders blank or throws, the error boundary drops to the file card — the same UI we already build for the other branches. Worst case equals the no-render option, so there is nothing to lose by trying.

**Expo Go guard.** Ohad tests in Expo Go, where the native component does not exist. The `require()`-then-probe-a-method pattern used by `contactPicker.ts` and `documentPicker.ts` **does not transfer here**, because a component is *mounted*, not *called* — there is no method access to trip the lazy proxy. Use instead the established in-repo pattern for native *components*, from `src/utils/keyboardAvoidingView.ts`: resolve at module load behind `isExpoGo`, export `null` when unavailable, and null-guard at the render site.

```ts
export const PdfRendererView = isExpoGo ? null : require('react-native-pdf-renderer').default;
```

In Expo Go a PDF shows the card; in a native build it renders. Images and text work in both.

### Reading text files

`expo-file-system` 19 exposes `new File(uri).text(): Promise<string>`, which reads the whole file. That is fine here precisely because the 256 KB cap is checked *before* the read — `size_bytes` comes from the picker. The byte-capped alternative (`file.open().readBytes(n)`) would need `TextDecoder`, which this project does not polyfill.

Import from the root (`expo-file-system`), not `expo-file-system/legacy` — the legacy subpath exists in SDK 54 but the `File` class is the current API.

### The `content://` trap

On Android, `expo-document-picker` returns a `content://` URI, which **neither `expo-file-system` nor `react-native-pdf-renderer` can read**. `documentPicker.ts` already passes `copyToCacheDirectory: true`, which copies the file into the cache and returns a `file://` path on both platforms. Do not remove that option — every renderer below depends on it.

### Caption plumbing

The caption is legal without a migration: `check_message_type` (`add_message_file_and_contact_metadata.sql:29`) does not constrain `body` for `file` or `contact`.

It touches four surfaces:

1. `createTypedMessageWithMetadata()` takes a `body` param and writes it to the payload.
2. Both `uploadAndCreateFile()` copies take a `body` param and thread it through; both `handleFileSend()` copies take a `caption`.
3. `FileBubble` renders the caption below the file row.
4. `messagePreviewText()` returns the caption when present, falling back to `📎 <name>`.

### Push notification fix (pre-existing bug)

`send-push-notification/index.ts:116` ends in `else { body = truncateForPush(msg.body || '') }`. Messages of type `file` and `contact` have `body = ''`, so **today they push with an empty body.** Nobody covered those branches when the types were added.

The query at line 100 selects only `'body, type'`, so it must also select `file_metadata, contact_metadata` before a better body can be built.

Fix, in the same edge function:

- `file` → the caption when present, otherwise `📎 <display_name>`.
- `contact` → `👤 <display_name>`.

This mirrors `messagePreviewText.ts` exactly, so the push and the conversation list say the same thing.

Requires an edge-function deploy. Download and diff the live version first — this function has drifted from the repo before.

### Security

`FileBubble` documents the posture that a **received** file is never rendered or executed in-app; it opens through the OS share sheet. That is unchanged.

This preview renders only the local file the sender just chose in their own picker, before upload. Different threat model, and it does not weaken the receive path. `react-native-pdf` never parses an attacker-supplied document.

## Files touched

**New**
- `src/components/FilePreviewModal.tsx` — the modal shell (header, gesture, caption footer)
- `src/components/filePreview/FilePreviewBody.tsx` — the four-way renderer dispatch
- `src/components/filePreview/FileCard.tsx` — the fallback card, also used as the error state
- `src/components/filePreview/pdfRenderer.ts` — the `isExpoGo`-guarded component resolve
- `src/components/messages/fileIcon.ts` — `iconForExt`, lifted out of `FileBubble` (it is module-private there) so the preview card can reuse it
- `src/components/ContactPreviewModal.tsx`

**Modified**
- `src/services/messaging/fileAttachmentPolicy.ts` — `previewKindForExt()`, plus tests
- `src/services/messaging/messagingService.ts` — `body` param on both public methods
- `src/components/messages/FileBubble.tsx` — import `iconForExt`, render caption
- `src/services/messaging/messagePreviewText.ts` — prefer caption
- `src/screens/DirectMessageScreen.tsx` — modal state, caption threading
- `src/screens/DirectGroupChat.tsx` — same, mirrored
- `supabase/functions/send-push-notification/index.ts` — file/contact push bodies
- `package.json` — `react-native-pdf-renderer`, explicit `expo-file-system`

## Acceptance criteria

1. Picking a document opens the preview. Closing it sends nothing and uploads nothing.
2. A PDF renders in a native build; in Expo Go it shows the file card with no crash and no alert.
3. A PDF that fails to render shows the file card, never a blank pane.
4. An image document renders on both platforms.
5. A `csv` under 256 KB renders as raw text; over the cap it shows the card with "Too large to preview".
6. A `zip` (or any `none` kind) shows the card.
7. A caption typed in the preview appears under the file bubble, in the conversation list, and in the push.
8. Picking a contact opens the review screen with every number and email checked.
9. Unchecking a number excludes it from the sent `contact_metadata`.
10. Unchecking everything disables Send.
11. Sending a file with no caption pushes `📎 <filename>`, not an empty body.
12. Both flows behave identically in `DirectMessageScreen` and `DirectGroupChat`.

## Testing

- Unit-test `previewKindForExt` against the full allowlist, alongside the existing `fileAttachmentPolicy` tests.
- Everything else is verified on-device by Ohad — no simulator or Maestro runs.
