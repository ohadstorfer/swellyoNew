# In-app Office document preview via iOS QuickLook

**Date:** 2026-07-15
**Status:** Approved, ready for implementation plan

## Problem

Tapping a received `.docx`, `.xlsx`, or `.pptx` in a chat opens the OS share sheet. There is no in-app preview. The in-app viewer (shipped 2026-07-10) only handles image, PDF, and text; Office formats fall through to `'none'` → share sheet.

## Goal

On iOS, tapping a received Office document opens it in-app via QuickLook. On Android, nothing changes.

## The platform reality

There is no symmetric answer, and pretending otherwise wastes work.

- **iOS** has QuickLook (`QLPreviewController`) — the engine behind Files and Mail. It renders `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `rtf`, iWork, PDF, and images, **natively and offline**, from a local `file://`. An ~80-line Swift Expo module exposes it. No heavy dependency, no third-party service.
- **Android** has **no** system Office renderer. The only in-app option is bundling a JS/WebView renderer that mangles complex layouts and cannot do pptx. WhatsApp itself hands Office documents off to another app on Android — exactly what we do today. So Android stays as-is.

This asymmetry is accepted, not a defect to fix.

## Non-goals

- **Android Office preview.** Deliberately unchanged. Matching iOS would require a WebView renderer with imperfect fidelity and no pptx support. Out of scope.
- **A unified look.** QuickLook presents Apple's own full-screen controller (light theme, its own Done / share / markup buttons). It **cannot** live inside our dark `FilePreviewShell` — embedding `QLPreviewController` as a child view controller is documented as broken (Apple Developer Forums #62957). So on iOS a `.docx` opens in Apple's screen while a PDF opens in our dark viewer. Two aesthetics, each where it renders best. This is intentional.
- **Audio / video / zip.** QuickLook can play audio and video, but adding them expands the test surface for no asked-for benefit. They stay on the share sheet. (Trivial to add later — one more entry in the extension set.)
- **Routing PDF / image / text through QuickLook.** Our dark viewer already handles these well on both platforms and stays the owner. QuickLook only fills the gap it alone can fill: Office.

## Design

### The native module: `swellyo-quicklook`

A local Expo module under `modules/swellyo-quicklook/`, mirroring the existing `modules/keyboard-direction/` precedent (local modules autolink — no `package.json` entry needed).

- `expo-module.config.json` — declares the apple module `SwellyoQuickLookModule` and the android stub `expo.modules.swelloquicklook.SwellyoQuickLookModule`.
- `ios/SwellyoQuickLook.podspec` — copied from `KeyboardDirection.podspec`, renamed, iOS 15.1, depends on `ExpoModulesCore`.
- `ios/SwellyoQuickLookModule.swift` — the real work. One `AsyncFunction("preview")` taking a local file path. It holds the path in a `QLPreviewControllerDataSource`, instantiates a `QLPreviewController`, and presents it from the top-most view controller. Apple owns the rest: rendering, scroll, its own share button.
- `android/` — a stub `Module` with just `Name("SwellyoQuickLook")` and no functions, so autolinking's Android pass does not fail. It is never called from JS on Android.
- `index.ts` — the JS face, using `requireOptionalNativeModule('SwellyoQuickLook')` (returns `null` when absent — Expo Go, web, an old build), exposing `previewFile(uri: string): Promise<boolean>`. Returns `false` when the module is unavailable or the present fails, so the caller can fall back.

### The presentation problem

`QLPreviewController` must be presented from a live view controller. In an Expo/RN app the reliable anchor is the key window's `rootViewController`, walked down through any presented controllers to the top-most one. The module walks that chain on the main thread and calls `present`. If no anchor is found (should not happen while the app is foregrounded), `previewFile` resolves `false`.

### Wiring into `FileBubble.handleOpen`

Today, after the file downloads to cache, the branch is: `kind !== 'none'` → dark viewer; else → share sheet. QuickLook slots in as a new branch **before** the share sheet, gated on iOS and on the extension:

```
kind = previewKindForExt(ext)            // image | pdf | text | none  (unchanged)
if (kind !== 'none')      → dark viewer   (unchanged)
else if (iOS && quickLookExts.has(ext))   → previewFile(localUri); on false, share sheet
else                      → share sheet   (unchanged)
```

`quickLookExts` is a new `Set` next to `previewKindForExt` in `fileAttachmentPolicy.ts`: `doc, docx, xls, xlsx, ppt, pptx, rtf`. It is pure and unit-tested there, like `previewKindForExt`.

**The cache filename** for a QuickLook file must be the id-safe name (`${message.id}.${ext}`), same reason as the renderable path: QuickLook, like the pdf/text readers, can choke on a `file://` with unescaped spaces/accents. So the `target` computation extends: renderable **or** QuickLook-eligible → `${id}.${ext}`; plain share → `${id}-${display_name}`.

**No cache cleanup for QuickLook files.** Our dark viewer deletes its cache file on close because we own its lifecycle. QuickLook is Apple's controller — we have no reliable "closed" callback from the fire-and-forget `previewFile`. These files stay in `cacheDirectory` (OS-evictable), same as the share-sheet path already does. Consistent, not a leak we introduce.

### The Expo Go / old-build fallback

`requireOptionalNativeModule` returns `null` when the native side is absent. `previewFile` then resolves `false`, and `handleOpen` falls through to the share sheet — the honest fallback, since there is nothing to render in-app for a docx without the module. No crash, no alert. In Expo Go, a docx behaves exactly as today.

## Files touched

**New**
- `modules/swellyo-quicklook/expo-module.config.json`
- `modules/swellyo-quicklook/ios/SwellyoQuickLook.podspec`
- `modules/swellyo-quicklook/ios/SwellyoQuickLookModule.swift`
- `modules/swellyo-quicklook/android/build.gradle`
- `modules/swellyo-quicklook/android/src/main/AndroidManifest.xml`
- `modules/swellyo-quicklook/android/src/main/java/expo/modules/swelloquicklook/SwellyoQuickLookModule.kt`
- `modules/swellyo-quicklook/index.ts`

**Modified**
- `src/services/messaging/fileAttachmentPolicy.ts` — `quickLookExts` set, plus tests
- `src/components/messages/FileBubble.tsx` — the QuickLook branch + the cache-name extension

## The cost, stated plainly

This is a **new native module**. It requires a native rebuild (`npx expo run:ios`) and does not work in Expo Go — a docx in Expo Go stays on the share sheet. It is not OTA-able. Android gets a native rebuild too (the stub), but no behavior change.

## Acceptance criteria

1. On an iOS dev build, tapping a received `.docx` opens it in QuickLook and renders.
2. `.xlsx` and `.pptx` likewise render in QuickLook.
3. `.rtf` and legacy `.doc` / `.xls` / `.ppt` render in QuickLook.
4. Tapping a received PDF still opens the dark viewer, not QuickLook.
5. Tapping a `.zip` still opens the share sheet.
6. On Android, tapping a `.docx` opens the share sheet, exactly as before.
7. In Expo Go, tapping a `.docx` opens the share sheet — no crash, no alert.
8. A `.docx` whose name has a space or accent renders in QuickLook (id-based cache name).
9. From QuickLook, Apple's own share button hands the file onward.

## Testing

- `quickLookExts` membership is unit-tested in `fileAttachmentPolicy.test.ts`, like `previewKindForExt`.
- QuickLook presentation is verified on-device by Ohad — no unit test can present a UIViewController. No simulator/Maestro runs.
