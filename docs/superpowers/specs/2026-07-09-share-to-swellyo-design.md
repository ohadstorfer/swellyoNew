# Share to Swellyo — OS-level share target

**Date:** 2026-07-09
**Status:** Design, awaiting review
**Branch:** `ohad`

## Goal

Swellyo appears in the OS share sheet. From the native Contacts app, a user taps
Share → Swellyo, picks a chat, and the contact arrives as a `type='contact'`
message. The same target also accepts images, videos, links, and text, so
"Share to Swellyo" works from Photos, Safari, and anywhere else.

The originating request was contacts. Images/videos/links/text are in scope
because the share-target scaffolding — activation rules, credential handoff,
pending-share queue, conversation picker — is the same work for all of them, and
adding a type later is a config line plus a branch.

## Non-goals

- Writing anything back to the user's address book. Shared contacts stay
  display-only, as they are today in `ContactBubble`.
- Sharing *out* of Swellyo into other apps (we are a share *target*, not a
  share *source*).
- Web. This is a native-only feature and is invisible in Expo Go.
- Multi-select of conversations in v1. One share, one chat.

## The platform asymmetry (read this first)

iOS and Android do not offer the same mechanism, and the design is asymmetric as
a direct consequence. This is not a compromise; it is what WhatsApp itself does.

**iOS** supports out-of-process Share Extensions: a separate binary, with its own
UI, rendered inside the system share sheet. The host app never launches.

**Android has no equivalent.** A third-party app receives `ACTION_SEND` by
declaring an intent filter on an Activity **in its own process**. There is no way
to render UI inside the system Sharesheet. WhatsApp's Android share flow is
WhatsApp opening its own "Send to" screen. (Android 14's `ChooserAction` allows
custom action *icons* backed by a `PendingIntent` — not embedded UI.)

So:

| | iOS | Android |
|---|---|---|
| Share UI runs in | separate extension process | our own app process |
| Language | Swift / SwiftUI | TypeScript (existing RN screen) |
| Send logic | reimplemented natively | reuses `messagingService` as-is |
| Memory ceiling | ~120 MB (jetsam) | none |

Android is the cheap platform. It gets the full JS runtime, the live Supabase
session, and `createContactMessageWithMetadata` for free. **We write one new send
implementation, not two.**

### Why the iOS extension UI is Swift, not React Native

The iOS share-extension jetsam limit is ~120 MB. (Widely corroborated across
independent bug reports; never formally published by Apple. Notification Service
Extensions get a much tighter ~24 MB — which is why `notify-service` is Swift.)

A team that booted RN 0.64 + Hermes inside a share extension measured ~50 MB
baseline and ~85 MB peak rendering a conversation list, release-mode only —
debug builds blew the limit just loading. They subsequently abandoned it. With
RN 0.81 and Swellyo's bundle we would be starting further behind that.

The extension UI is therefore hand-written SwiftUI. This is the single largest
cost in this spec and there is no way to avoid it while keeping an in-sheet
picker.

### Why the extension does not refresh the session

Supabase rotates refresh tokens. If the extension refreshes independently, the
app's stored refresh token is invalidated and the user is silently logged out of
the main app after sharing a contact. The extension therefore **reads an access
token and never refreshes it.** If the token is expired, the extension does not
attempt to recover — it falls back to opening the app, which restores the session
through the normal `autoRefreshToken` path.

This matches the only share extension whose source we can actually read: Signal's
iOS extension does the picker UI in-process but defers the authenticated send,
and its own source comments explain that the extension process is reused between
invocations and is not safe to hold app state in. It calls `exit(0)` when done.
Telegram links its full account stack into the extension and is *architecturally*
capable of sending directly, but the call site could not be verified. WhatsApp's
in-sheet picker UI is well documented; **its internal send mechanism is not
public, and nothing in this spec should be read as a claim about it.**

## Architecture

### Credential handoff (iOS)

Apple's documented split is: **Keychain access group for secrets, App Group
container for data.**

Swellyo's Supabase session currently lives in **AsyncStorage**
(`src/config/supabase.ts:50`), which the extension cannot read. There is no
existing Keychain item to share. So the app publishes one deliberately.

- A new `sessionBridge` module writes `{ access_token, expires_at, user_id }`
  into a shared Keychain access group on every foreground and on every
  `onAuthStateChange` token refresh, and **deletes it on logout**.
- The refresh token is never written. Only the short-lived access token.
- App Group container (`group.com.swellyo.app`) holds non-secret data: the
  cached recents list, and staged share payloads for the fallback path.

Leaking the App Group container leaks a conversation list. Leaking the Keychain
item leaks at most one hour of API access. Neither leaks a durable credential.

### Recents cache (iOS)

The extension must render a picker without a network round trip. The app writes
the 12 most recent conversations (id, title, avatar thumb URL, updated_at) into
the App Group container whenever the conversation list changes, ordered by
`conversationRecency` — the same comparator the inbox uses, so the extension's
order matches what the user just saw. 12 fills the sheet without scrolling on the
smallest supported device. The extension reads that file, renders it, and —
because the cache may be stale — the send is keyed on `conversation_id`, which
does not change.

If the cache is missing or empty (fresh install, never opened), the extension
falls back to opening the app.

### Send paths

Contacts, links, and text are a **single row insert** with no binary upload. The
extension POSTs to PostgREST directly with the Keychain access token:

```
POST /rest/v1/messages
{ conversation_id, sender_id, type, body, <type>_metadata, client_id }
```

Your existing DB triggers then handle broadcast and push for free — the extension
does not need to know realtime or notifications exist.

Two invariants the Swift code must honour, both enforced by DB constraints
(definitions read from prod, 2026-07-09):

1. `messages_type_check` — the type whitelist. Already extended with `file` and
   `contact` (commit `9b8ddc7`).
2. `check_message_type` — type/metadata consistency. For `contact` it requires
   only `commitment_metadata IS NULL`; for `text` it requires image, video,
   audio and commitment metadata all NULL. It does **not** require
   `contact_metadata IS NOT NULL` — a contact row with null metadata would be
   accepted by the DB and render as an empty bubble, so the extension, not the
   database, is what guarantees the metadata is present.

Violating either yields a `23514` that names the *wrong* constraint, which is a
known trap in this codebase. The extension must construct rows through one small
function that mirrors `createTypedMessageWithMetadata`.

RLS: `messages_insert_members` requires `sender_id = auth.uid()` **and** that the
sender is a member of the conversation. The extension satisfies both — it sends
`sender_id` from the Keychain token's `user_id` under that user's bearer token,
and the recents cache only ever lists conversations the user belongs to.
The upsert targets the existing unique index `messages_sender_client_id_key`
on `(sender_id, client_id)`.

`client_id` is a UUID minted by the extension. It makes the insert idempotent and
lets the app swap the optimistic row when Realtime echoes it — same contract as
the JS path.

**Images and videos in Phase 1 do not send from the extension.** They stage into
the App Group and open the app. See Phases.

### Fallback path (both platforms, all types)

Whenever the extension cannot or should not send inline:

- token missing or expired
- recents cache empty
- payload type is media (Phase 1)
- vCard fails to parse

…the extension writes the payload into the App Group container, opens
`swellyo://share?token=<staged-id>`, and exits. The app reads the staged payload
on next resume, presents the in-app conversation picker, and sends via the
existing `messagingService`. This is the same path Android always takes.

The fallback is not an error path. It is the primary path on Android and a
routine path on iOS, so it must be as polished as the inline one.

### Android

A transparent Activity with intent filters for `ACTION_SEND` /
`ACTION_SEND_MULTIPLE` across `text/*`, `image/*`, `video/*`, `text/x-vcard`,
`text/vcard`, and `text/directory`. It launches the existing RN app, which routes
to the same in-app conversation picker the iOS fallback uses.

Library note: `expo-share-intent` is capture-and-redirect only — it has **no
in-extension picker**, so its iOS half is the wrong shape for us. Use it with
`disableIOS: true` for the Android intent-filter plumbing, or write the intent
filter by hand. iOS is `@bacons/apple-targets` (already in this project, already
shipping `notify-service`), adding a second target.

`public.vcard` is not a documented `expo-share-intent` activation type on either
platform, so the vCard rules are hand-written regardless of the library choice.

## vCard parsing

The Contacts app shares a `.vcf`, not a structured contact. Two parsers:

- **TypeScript** (`src/services/messaging/vcardParser.ts`) — used by Android and
  by the iOS fallback. Consumed by the existing picker.
- **Swift** — used by the iOS inline path. Prefer `CNContactVCardSerialization`
  from the Contacts framework rather than hand-rolling; it handles the encoding
  cases below.

Both must map onto the existing `ContactMetadata` shape unchanged:

```ts
{ display_name: string;
  phone_numbers: { label?: string; number: string }[];
  emails?: { label?: string; email: string }[]; }
```

Cases the TS parser must handle, because real address books produce them:

- `FN` absent → compose from `N` (`family;given;middle;prefix;suffix`).
- Line folding: a line beginning with a space/tab continues the previous line.
- `QUOTED-PRINTABLE` encoding (older Android exports) and `CHARSET=` params.
- `TEL;TYPE=CELL,VOICE:` → label `CELL`, multiple type tokens.
- `item1.TEL:` grouped-property prefixes (iOS emits these).
- Multiple `VCARD` blocks in one file → v1 takes the first and logs the rest.
- Zero phone numbers **and** zero emails → reject with the existing
  "That contact has no phone number to share" copy from `contactPicker.ts`.

A malformed vCard must never crash the extension. Parse failure → fallback path.

## Auth and onboarding gate

A share can arrive when the user is logged out, or mid-onboarding (steps `-1`
through `5`, per `OnboardingContext`). The staged payload survives in the App
Group; `AppContent` must not present the picker until onboarding step ≥ 6.
After that the picker appears with the payload intact. A staged payload older
than 24h is discarded.

## Error handling

| Condition | Behaviour |
|---|---|
| Token expired / absent | Fallback: open app |
| Recents cache empty | Fallback: open app |
| vCard unparseable | Fallback: open app, surface `friendlyErrorMessage` |
| Insert returns 23514 | Bug in our row construction. Log to Sentry, fallback |
| Network failure in extension | Retry once, then stage + open app |
| User logged out | Stage payload, app opens to login, resume after onboarding |

All user-facing copy goes through `friendlyErrorMessage` / `showErrorAlert` per
`src/utils/friendlyError.ts` — never `Alert.alert(title, e.message)`.

## Phases

**Phase 1 — ship the ask.**
Contacts, links, and text send inline from the iOS sheet. Images and videos
stage and open the app. Android handles everything in-process. Full fallback
path. This is the whole feature from the user's point of view; only media costs
an app switch.

**Phase 2 — inline media on iOS.**
Apple's sanctioned pattern: the extension starts an `NSURLSession` **background**
upload against a shared container and exits immediately; the OS wakes the
containing app to run the delegate callbacks and insert the row after the bytes
land. This lines up with Swellyo's upload-first design, where the row is created
only after the upload succeeds, so a failed send leaves no ghost.

Constraint: the app and the extension must use **distinct background-session
identifiers**. A background session can be connected to by only one process at a
time.

Thumbnailing is entirely server-side and the extension never touches image
processing. `image-upload-s3` invokes `generate-thumbnail-s3` itself
(`supabase/functions/image-upload-s3/index.ts:166`), and a `storage.objects`
trigger covers the rest (`20260625000100_thumbnail_trigger.sql`). Phase 2 is
therefore a background `NSURLSession` POST at one existing edge function — no
S3 presigning, no native resizing, no `PHAsset` decoding beyond streaming the
file off disk. This makes Phase 2 substantially cheaper than a naive reading of
"native media upload" suggests, and is the main reason it is worth doing rather
than living with the app switch forever.

## Testing

- **vCard parser** — jest unit tests over a corpus of real `.vcf` exports: iOS
  Contacts, Google Contacts, Android export, quoted-printable, folded lines,
  grouped properties, no-phone, multi-card. This is the one piece with real
  logic and no device dependency, so it carries the test weight.
- **Row construction** — assert the Swift and TS paths produce byte-identical
  `contact_metadata` for the same `.vcf`. Snapshot the JSON.
- **Constraint conformance** — an integration test that inserts each message type
  and asserts neither `messages_type_check` nor `check_message_type` fires.
- **Device only, no simulator or Maestro:** share sheet presence, extension
  memory under load, background upload wake, cold-start staged payload.
  Verified on-device by Ohad.

## Risks

- **Native rebuild required. This can never be OTA'd**, and none of it is
  visible in Expo Go. Follow `PRE_BUILD_CHECKLIST.md`.
- Two `@bacons/apple-targets` extension targets in one project (`notify-service`
  + share). Expected to work; verify the EAS build early rather than at the end.
- Extension memory. The SwiftUI picker must not decode full-size avatars. Use the
  thumbnail URLs from `getStorageThumbUrl` that the recents cache already holds.
- The recents cache is a second source of truth for the conversation list. It can
  go stale. Sends are keyed on `conversation_id`, so a stale *title* is cosmetic;
  a deleted conversation yields an FK error → fallback.
- iOS 18+ Contacts has a "limited access" mode. Sharing a single vCard out of
  Contacts is unaffected (no permission needed — the user chose the contact), but
  worth confirming on-device.

## Files touched

New:
- `targets/share-extension/` — SwiftUI extension, `expo-target.config.js`,
  `Info.plist` activation rules, entitlements
- `src/services/messaging/vcardParser.ts` + tests
- `src/services/sessionBridge.ts` — publish access token to Keychain group
- `src/services/shareIntake.ts` — read staged payload, dedupe, expiry
- `src/screens/ShareToChatScreen.tsx` — the in-app conversation picker

Modified:
- `app.json` — App Group + Keychain entitlements, Android intent filters
- `src/components/AppContent.tsx` — route `swellyo://share`, gate on onboarding
- `src/config/supabase.ts` — hook `onAuthStateChange` into `sessionBridge`

## Decisions made without the user

The iOS media path was left open at the end of brainstorming and decided here:
**Phase 1 opens the app for media.** The fallback path must exist regardless
(expired token, empty cache, parse failure), so Phase 1 gets it at no extra cost,
whereas inline media is a background-upload state machine in Swift that would
gate the contact-sharing feature that was actually requested. Phase 2 reaches the
originally-stated end state — everything inline — with no user-visible change
other than the app no longer opening.
