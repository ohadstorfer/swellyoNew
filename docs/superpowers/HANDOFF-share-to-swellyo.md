# Handoff — Share to Swellyo (Phase 1)

## 2026-07-10 update — after first on-device test (build 41)

Two bugs found by Ohad's device test, both addressed; **needs a rebuild** (no
prebuild required — the touched files are read directly by the build):

1. **Contacts never offered Swellyo.** Root cause proven, not guessed:
   `public.vcard` conforms to `public.text` (verified via `UTType.vCard.supertypes`),
   so the dictionary activation rule's File key never claims it and its Text key
   (plain text only) doesn't either. Fix: predicate-form activation rule naming
   `public.vcard` explicitly. The predicate is verified to parse as an
   `NSPredicate` and was inspected inside the **built** `.appex`.
2. **Image share: sheet flashed, app never opened.** Narrowed to two candidate
   causes (staging failed vs. app-open failed) — indistinguishable without device
   logs. Both are now covered:
   - `openHostApp` rewritten to match the known-good reference in
     `node_modules/expo-share-intent`'s own extension: cast the responder to
     `UIApplication` and call `open(_:options:completionHandler:)`, completing the
     request only from the completion handler (previously: deprecated
     single-arg `perform("openURL:")` + synchronous teardown that could cancel
     the open in flight).
   - **Launch-sweep added (this makes delivery not depend on the open at all):**
     `sweepStagedShare()` in `shareIntake.ts` scans the App Group pending dir on
     every app launch and on every `swellyo://share` wake-up, delivers the newest
     valid payload, rescues media files into app cache, and wipes the dir. The
     earlier claim that "the app picks the payload up on next launch" was false
     when written; it is true now. `loadStagedShare` (id-keyed read) is gone.
   - The extension is instrumented with `os.Logger` (subsystem
     `com.swellyo.app.share`) at every decision point. If anything still fails:
     `sudo log collect --device-udid 00008110-000235062282401E --last 15m
     --output share.logarchive`, then
     `log show share.logarchive --predicate 'subsystem == "com.swellyo.app.share"' --info`.

Also: `displayName: 'Swellyo'` added to the target config — build 41 shows
"SwellyoShare" in the sheet. This one **does** need a prebuild to land in
`project.pbxproj` (`INFOPLIST_KEY_CFBundleDisplayName`); cosmetic, defer if the
pbxproj again has parallel work in flight.

Verified this round: extension compiles AND links standalone
(`xcodebuild -target SwellyoShare` → BUILD SUCCEEDED, no pod deps), built
`.appex` Info.plist carries the new rule, 19 JS tests pass, tsc clean vs
baseline.

**Status:** code complete, **uncommitted** on `ohad`. Not built, not device-tested.
**Spec:** `docs/superpowers/specs/2026-07-09-share-to-swellyo-design.md`
**Plan:** `docs/superpowers/plans/2026-07-09-share-to-swellyo.md`

## What works today

Swellyo becomes an OS share target. Contacts, links, text, photos and videos can
be shared into a Swellyo chat from any app.

- **Android** — `ACTION_SEND` launches `MainActivity` in-process. `expo-share-intent`
  hands the payload to `AppContent`, which routes to a new `ShareToChat` picker.
  Sending goes through the existing `messagingService`. No new send logic.
- **iOS** — a SwiftUI Share Extension (`targets/share-extension/`) shows a recents
  picker *inside* the share sheet. Contacts/links/text insert straight into
  `messages` via PostgREST. Media, and every failure mode, stage a payload into
  the App Group container and open the app to the same `ShareToChat` picker.
- **Media** always finishes in the chat composer's existing preview (caption +
  Send), reusing the upload-first pipeline untouched. Phase 2 (inline media via a
  background `NSURLSession`) is specced but **not built**.

## THE ONE THING THAT MUST HAPPEN NEXT

**`npx expo prebuild -p ios` has NOT been run, so the `SwellyoShare` target does
not exist in `ios/Swellyo.xcodeproj` yet.** The Swift files are authored and
type-check, but nothing builds them.

I did not run it because you had **uncommitted parallel work in `ios/`** at the
time — `ios/Swellyo.xcodeproj/project.pbxproj` and `ios/Podfile.lock` (the
`expo-camera` / `expo-media-library` / `modules/keyboard-direction` work).
Prebuild regenerates `project.pbxproj` wholesale and would have destroyed it.

When your native folders are in a state you're happy to regenerate:

```bash
git status --porcelain ios/          # confirm you can afford to regenerate
npx expo prebuild -p ios --no-install
git diff ios/Swellyo.xcodeproj/project.pbxproj | head -100
```

Expect: a new `PBXNativeTarget` "SwellyoShare" (`com.apple.product-type.app-extension`),
file refs for the six Swift files, the extension embedded in the app target, and
`Swellyo.entitlements` gaining the App Group. Verify nothing else was clobbered.

Then build. `PRE_BUILD_CHECKLIST.md` applies — this is a **native** change and
**can never ship as an OTA**.

## Before the first EAS build

1. **Create the App Group `group.com.swellyo.app`** in the Apple Developer portal.
   Without it, provisioning fails. EAS will want to regenerate credentials — let it.
2. **Version sync now spans 7 places, not 5.** `PRE_BUILD_CHECKLIST.md` tracks 5;
   add `targets/notify-service/Info.plist` and `targets/share-extension/Info.plist`,
   both currently pinned to `1.3.1` / `41`. An extension whose version drifts from
   the app is rejected at submission.

## Verification already done

- `npx tsc --noEmit` — no new errors (93 pre-existing on this branch; the repo is
  not type-clean, so I diffed against a baseline rather than expecting zero).
- `npx jest src/services/messaging/__tests__/vcardParser.test.ts src/services/__tests__/shareIntake.test.ts` — 15 pass.
- Full `npx jest` — 435 pass, 9 fail. **All 9 failures are pre-existing**
  (`useTripsListRealtime`, plus an emoji assertion inside the nested
  `.claude/worktrees/attach-review` checkout). They fail identically in that
  separate checkout, which doesn't contain my changes.
- Swift: `swiftc -typecheck -application-extension` against the iOS SDK, all six
  files clean. The `-application-extension` flag matters — it's what proves the
  `openURL:` responder-chain workaround doesn't touch `UIApplication.shared`,
  which is unavailable in extensions.
- DB (read-only, prod): both `messages` constraints accept `contact`; the unique
  index `messages_sender_client_id_key` backs the Swift upsert's `on_conflict`;
  RLS `messages_insert_members` is satisfied by `sender_id` + membership.

**Not verified:** anything requiring a device or a build.

## On-device test checklist

Dev build required. **None of this is visible in Expo Go** — `sessionBridge`,
`shareRecentsCache` and the extension all no-op or don't exist there. (They're
guarded, so Expo Go must still boot cleanly — that's test 10.)

**Android**

1. Contacts → a contact → Share → Swellyo → picker → send. Contact bubble lands;
   the other device gets a push.
2. Gallery → share a photo → picker → chat opens with the image in the composer →
   add caption → Send.
3. Chrome → share a URL → picker → arrives as a text message.
4. Share while logged out → log in → finish onboarding → picker appears, payload intact.

**iOS**

5. Contacts → Share Contact → Swellyo appears in the sheet → in-sheet picker →
   Send → bubble arrives **without the app opening**.
6. Same with Swellyo force-quit (the extension must work with the app dead).
7. Airplane mode mid-send → brief error → app opens with the picker (fallback).
8. Photos → share an image → app opens → picker → composer prefilled.
9. **Leave the app closed >1h so the access token expires, then share a contact.**
   Expect: app opens (fallback). Then confirm **you are still signed in.** This is
   the test that matters most — see "Known risks" below.
10. Expo Go: app boots, no crash.

## Known risks

- **The `openURL:` responder-chain walk** in `ShareViewController.openHostApp` is
  the industry-standard way for a share extension to open its host app, but it is
  not sanctioned API. App Review has always accepted it; a future iOS could break
  it. Failure mode is benign: the payload is already staged, so the app picks it
  up on next launch instead of auto-opening.
- **Token rotation is the one thing that could hurt users.** The extension reads a
  short-lived access token and *never* refreshes. If anyone later "improves" it by
  adding a refresh call, Supabase will rotate the refresh token, invalidate the
  app's copy, and silently log users out after they share a contact. Test 9 exists
  to catch that regression. This is why `sessionBridge.ts` never writes the
  refresh token.
- **`expo-share-intent`'s Android intent parsing** was verified against its
  TypeScript types and its manifest generator source, not on a device. Run test 1
  first. If the hook never fires, compare `android/app/src/main/AndroidManifest.xml`
  against what the plugin generates.
- **vCard label parity.** The TS parser emits raw labels (`CELL`, `HOME`); the Swift
  mapper uses `CNLabeledValue.localizedString`, which emits `Mobile`, `Home`, and
  localizes. Labels are display-only in `ContactBubble`, so the same contact may
  read slightly differently depending on which path sent it. Accepted knowingly;
  strip the localization in `VCardMapper.displayLabel` if you'd rather they match.
- **`.vcf` activation.** The `Info.plist` uses `NSExtensionActivationSupportsFileWithMaxCount`,
  which should match `public.vcard` (it conforms to `public.data`). If Swellyo does
  not appear in the Contacts share sheet, swap in the `SUBQUERY` predicate that
  names `public.vcard` explicitly — it's written out in a comment in that file.

## Files

**New**
```
src/services/messaging/vcardParser.ts                       + 8 tests, 7 fixtures
src/services/shareIntake.ts                                 + 7 tests
src/services/sessionBridge.ts
src/services/shareRecentsCache.ts
src/screens/ShareToChatScreen.tsx
targets/share-extension/{expo-target.config.js,Info.plist}
targets/share-extension/{SharedStore,KeychainToken,VCardMapper,SendClient,ShareView,ShareViewController}.swift
```

**Modified**
```
app.json                                  App Group entitlement, expo-share-intent plugin (disableIOS)
package.json                              + expo-share-intent@5.1.1  (5.x is the SDK-54 line)
android/app/src/main/AndroidManifest.xml  ACTION_SEND / ACTION_SEND_MULTIPLE filters
ios/Swellyo/Swellyo.entitlements          App Group
src/config/supabase.ts                    export SUPABASE_URL / SUPABASE_ANON_KEY
src/components/AppContent.tsx             initSessionBridge, share routing + onboarding gate
src/context/MessagingProvider.tsx         writeShareRecents effect
src/utils/registerLogoutHandlers.ts       clear recents + shared Keychain token on logout
src/navigation/navigationRef.ts           ShareToChat route, ChatCard.sharedMedia
src/navigation/RootNavigator.tsx          register ShareToChat, thread sharedMedia
src/screens/DirectMessageScreen.tsx       sharedMedia prop + mount effect
src/screens/DirectGroupChat.tsx           sharedMedia prop + mount effect
```

Nothing is committed. `app.json`, `package.json` and `DirectGroupChat.tsx` also
carry your parallel camera/keyboard work — I edited around it, never over it.

## Two corrections to the spec, found by reading the code

- The session lives in **AsyncStorage**, not `expo-secure-store`, so there was no
  Keychain item to share. `sessionBridge.ts` deliberately publishes one.
- `check_message_type` does **not** require `contact_metadata IS NOT NULL` on a
  contact row — it only forbids `commitment_metadata`. A null would insert
  cleanly and render an empty bubble, so `ShareViewController.route` guards it
  instead. Both docs are updated.
