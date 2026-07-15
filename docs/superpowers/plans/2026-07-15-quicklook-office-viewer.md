# QuickLook Office Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iOS, tapping a received Office document (`doc/docx/xls/xlsx/ppt/pptx/rtf`) in a chat opens it in-app via Apple's QuickLook instead of the OS share sheet; Android and Expo Go are unchanged.

**Architecture:** A new local Expo module `swellyo-quicklook` wraps `QLPreviewController` and exposes one JS function `previewFile(uri): Promise<boolean>`. `fileAttachmentPolicy.ts` gains a pure, unit-tested `isQuickLookExt(ext)` membership test. `FileBubble.handleOpen` gets one new branch — after the existing renderable-viewer branch, before the share sheet — gated on iOS + `isQuickLookExt`, that calls `previewFile` and falls through to the share sheet on `false`.

**Tech Stack:** Expo SDK 54, React Native 0.81.5 (New Architecture), Swift + `ExpoModulesCore`, Kotlin stub, Jest.

## Global Constraints

- The QuickLook extension set is exactly: `doc, docx, xls, xlsx, ppt, pptx, rtf`. No more (audio/video/zip stay on the share sheet), no fewer.
- QuickLook is iOS-only. The new branch MUST be gated on `Platform.OS === 'ios'`. Android behavior is unchanged.
- The module MUST degrade safely when absent (Expo Go, web, old build): `requireOptionalNativeModule` returns `null`, `previewFile` resolves `false`, and the caller falls through to the share sheet — no crash, no alert.
- Do NOT route `pdf / image / text` through QuickLook — the existing dark viewer (`FileViewerModal`) stays their owner. QuickLook fills only the Office gap.
- Follow the existing local-module precedent exactly: `modules/keyboard-direction/`. Same file layout, same podspec shape, same `expo-module.config.json` shape, same `requireOptionalNativeModule` JS pattern.
- Android package name for the stub is `expo.modules.swelloquicklook` (mirrors the `keyboarddirection` precedent's lowercased, separator-free spelling).
- New native module ⇒ a native rebuild (`npx expo run:ios`) is required to test. Not OTA-able. Not in Expo Go. This is expected, not a defect.

---

### Task 1: `isQuickLookExt` in the file policy (pure + tested)

**Files:**
- Modify: `src/services/messaging/fileAttachmentPolicy.ts` (add after `previewKindForExt`, around line 139)
- Test: `src/services/messaging/__tests__/fileAttachmentPolicy.test.ts` (add a `describe('isQuickLookExt', …)` block after the `previewKindForExt` block)

**Interfaces:**
- Consumes: `isAllowedExt(ext: string): boolean` (already in this file).
- Produces: `isQuickLookExt(ext: string): boolean` — `true` only for `doc, docx, xls, xlsx, ppt, pptx, rtf`, `false` for everything else (including blocked exts and junk). Consumed by `FileBubble.handleOpen` in Task 4.

- [ ] **Step 1: Write the failing test**

Add this block to `src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`, immediately after the closing `});` of the `describe('previewKindForExt', …)` block. Also add `isQuickLookExt` to the import list at the top of the file (the `from '../fileAttachmentPolicy'` import).

```ts
  describe('isQuickLookExt', () => {
    it('accepts the Office document formats', () => {
      expect(isQuickLookExt('doc')).toBe(true);
      expect(isQuickLookExt('docx')).toBe(true);
      expect(isQuickLookExt('xls')).toBe(true);
      expect(isQuickLookExt('xlsx')).toBe(true);
      expect(isQuickLookExt('ppt')).toBe(true);
      expect(isQuickLookExt('pptx')).toBe(true);
      expect(isQuickLookExt('rtf')).toBe(true);
    });
    it('rejects formats the dark viewer already owns', () => {
      expect(isQuickLookExt('pdf')).toBe(false);
      expect(isQuickLookExt('png')).toBe(false);
      expect(isQuickLookExt('txt')).toBe(false);
      expect(isQuickLookExt('csv')).toBe(false);
    });
    it('rejects everything else', () => {
      expect(isQuickLookExt('zip')).toBe(false);
      expect(isQuickLookExt('mp3')).toBe(false);
      expect(isQuickLookExt('mp4')).toBe(false);
    });
    it('is case-insensitive and safe on junk input', () => {
      expect(isQuickLookExt('DOCX')).toBe(true);
      expect(isQuickLookExt('')).toBe(false);
      expect(isQuickLookExt(undefined as unknown as string)).toBe(false);
    });
    it('never accepts a blocked extension', () => {
      expect(isQuickLookExt('exe')).toBe(false);
      expect(isQuickLookExt('html')).toBe(false);
    });
  });
```

Update the import at the top of the test file from:

```ts
import {
  extOf,
  sanitizeDisplayName,
  isAllowedExt,
  contentTypeFor,
  formatBytes,
  previewKindForExt,
  validateFile,
  MAX_FILE_SIZE_BYTES,
} from '../fileAttachmentPolicy';
```

to add `isQuickLookExt`:

```ts
import {
  extOf,
  sanitizeDisplayName,
  isAllowedExt,
  contentTypeFor,
  formatBytes,
  previewKindForExt,
  isQuickLookExt,
  validateFile,
  MAX_FILE_SIZE_BYTES,
} from '../fileAttachmentPolicy';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/fileAttachmentPolicy.test.ts -t "isQuickLookExt"`
Expected: FAIL — `isQuickLookExt is not a function` (the import is `undefined`).

- [ ] **Step 3: Write the minimal implementation**

In `src/services/messaging/fileAttachmentPolicy.ts`, add the following immediately after the `previewKindForExt` function (after its closing `}` near line 139). It mirrors the `IMAGE_PREVIEW_EXTS`/`TEXT_PREVIEW_EXTS` + `isAllowedExt` guard pattern already used in this file:

```ts
/**
 * Office formats that iOS QuickLook can render in-app but our own dark viewer
 * cannot. Kept separate from previewKindForExt: these do NOT go through the
 * in-app FilePreviewBody — FileBubble hands them to the native QLPreviewController
 * on iOS, and to the OS share sheet everywhere else.
 */
const QUICK_LOOK_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf']);

/** True for Office formats iOS QuickLook should open in-app. Blocked exts never qualify. */
export function isQuickLookExt(ext: string): boolean {
  const e = String(ext ?? '').toLowerCase();
  if (!isAllowedExt(e)) return false;
  return QUICK_LOOK_EXTS.has(e);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/fileAttachmentPolicy.test.ts -t "isQuickLookExt"`
Expected: PASS (all 5 `it` cases green).

- [ ] **Step 5: Run the full policy suite to confirm no regression**

Run: `npx jest src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`
Expected: PASS — every existing `describe` block still green.

- [ ] **Step 6: Commit**

```bash
git add src/services/messaging/fileAttachmentPolicy.ts src/services/messaging/__tests__/fileAttachmentPolicy.test.ts
git commit -m "feat(files): add isQuickLookExt policy helper for Office formats"
```

---

### Task 2: The `swellyo-quicklook` native module scaffolding

Creates the module skeleton (config, podspec, Android stub, JS face) and the iOS Swift implementation in one task — a native module is not independently testable until all its pieces exist, so they form one reviewer gate. The precedent is `modules/keyboard-direction/`.

**Files:**
- Create: `modules/swellyo-quicklook/expo-module.config.json`
- Create: `modules/swellyo-quicklook/index.ts`
- Create: `modules/swellyo-quicklook/ios/SwellyoQuickLook.podspec`
- Create: `modules/swellyo-quicklook/ios/SwellyoQuickLookModule.swift`
- Create: `modules/swellyo-quicklook/android/build.gradle`
- Create: `modules/swellyo-quicklook/android/src/main/AndroidManifest.xml`
- Create: `modules/swellyo-quicklook/android/src/main/java/expo/modules/swelloquicklook/SwellyoQuickLookModule.kt`

**Interfaces:**
- Consumes: `requireOptionalNativeModule` from `expo-modules-core`.
- Produces: `previewFile(uri: string): Promise<boolean>` (default export path `modules/swellyo-quicklook`). Resolves `true` once QuickLook is presented, `false` when the native module is absent or presentation fails. Consumed by `FileBubble` in Task 4.

- [ ] **Step 1: Create `expo-module.config.json`**

`modules/swellyo-quicklook/expo-module.config.json`:

```json
{
  "platforms": ["apple", "android"],
  "apple": {
    "modules": ["SwellyoQuickLookModule"]
  },
  "android": {
    "modules": ["expo.modules.swelloquicklook.SwellyoQuickLookModule"]
  }
}
```

- [ ] **Step 2: Create the JS face `index.ts`**

`modules/swellyo-quicklook/index.ts`:

```ts
/**
 * JS face of the swellyo-quicklook native module. iOS-only in effect: it wraps
 * QLPreviewController to show a local Office document (docx/xlsx/pptx/…) in-app.
 *
 * Degrades to an inert `false` when the native side is absent (Expo Go, web,
 * an old build, or Android where the module is a no-op stub) —
 * requireOptionalNativeModule returns null instead of throwing, so callers
 * never need a try/catch and simply fall back to the OS share sheet.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeSwellyoQuickLook = {
  preview(path: string): Promise<boolean>;
};

const native = requireOptionalNativeModule<NativeSwellyoQuickLook>('SwellyoQuickLook');

/**
 * Present a local file:// (or bare path) in Apple's QuickLook. Resolves true
 * once presented; false if the module is unavailable or presentation fails —
 * the caller then falls back to the OS share sheet.
 */
export async function previewFile(uri: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.preview(uri);
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Create the iOS podspec**

`modules/swellyo-quicklook/ios/SwellyoQuickLook.podspec` — copied from `KeyboardDirection.podspec`, renamed, with the QuickLook system framework linked explicitly:

```ruby
Pod::Spec.new do |s|
  s.name           = 'SwellyoQuickLook'
  s.version        = '1.0.0'
  s.summary        = 'In-app document preview via QLPreviewController'
  s.description    = 'Presents a local file (Office/RTF/PDF/images) using Apple QuickLook.'
  s.author         = 'Swellyo'
  s.homepage       = 'https://github.com/ohadstorfer/swellyoNew'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'QuickLook'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
```

- [ ] **Step 4: Create the iOS Swift module**

`modules/swellyo-quicklook/ios/SwellyoQuickLookModule.swift`:

```swift
import ExpoModulesCore
import QuickLook
import UIKit

/**
 In-app preview of a local document via Apple's QuickLook (QLPreviewController) —
 the engine behind Files and Mail. Renders Office formats, RTF, PDF, images and
 iWork natively and offline. Exposed to JS as `preview(path)`, which resolves
 true once the controller is presented and false when there is no view controller
 to present from (should not happen while the app is foregrounded).

 The data source is retained on the module for the lifetime of the presentation:
 QLPreviewController holds its dataSource weakly, so a local would be released the
 instant `preview` returns and the preview would render nothing. Each call
 overwrites the previous source — a single URL wrapper, harmless to keep.
 */

private class QuickLookSource: NSObject, QLPreviewControllerDataSource {
  let url: NSURL
  init(url: URL) { self.url = url as NSURL }
  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    return url
  }
}

public class SwellyoQuickLookModule: Module {
  /// Retained while a controller is presented (see the class doc).
  private var source: QuickLookSource?

  public func definition() -> ModuleDefinition {
    Name("SwellyoQuickLook")

    AsyncFunction("preview") { (path: String, promise: Promise) in
      DispatchQueue.main.async {
        // Accept both a file:// uri and a bare filesystem path.
        let fileURL: URL? = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
        guard let url = fileURL, FileManager.default.fileExists(atPath: url.path) else {
          promise.resolve(false)
          return
        }
        guard let presenter = Self.topViewController() else {
          promise.resolve(false)
          return
        }
        let src = QuickLookSource(url: url)
        self.source = src
        let controller = QLPreviewController()
        controller.dataSource = src
        presenter.present(controller, animated: true) {
          promise.resolve(true)
        }
      }
    }
  }

  /// The top-most presented view controller under the key window's root.
  private static func topViewController() -> UIViewController? {
    let keyWindow = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
```

- [ ] **Step 5: Create the Android build.gradle**

`modules/swellyo-quicklook/android/build.gradle` — copied from the keyboard-direction gradle, renamed group/namespace:

```gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

group = 'expo.modules.swelloquicklook'
version = '1.0.0'

def expoModulesCorePlugin = new File(project(":expo-modules-core").projectDir.absolutePath, "ExpoModulesCorePlugin.gradle")
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()
useCoreDependencies()
useDefaultAndroidSdkVersions()

android {
  namespace "expo.modules.swelloquicklook"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
  }
  lintOptions {
    abortOnError false
  }
}
```

- [ ] **Step 6: Create the Android manifest**

`modules/swellyo-quicklook/android/src/main/AndroidManifest.xml`:

```xml
<manifest />
```

- [ ] **Step 7: Create the Android Kotlin stub**

`modules/swellyo-quicklook/android/src/main/java/expo/modules/swelloquicklook/SwellyoQuickLookModule.kt`:

```kotlin
package expo.modules.swelloquicklook

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android stub so autolinking's Android pass finds a module. QuickLook is
 * iOS-only; JS never calls preview() on Android (FileBubble gates on
 * Platform.OS === 'ios'), so this exposes no functions.
 */
class SwellyoQuickLookModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SwellyoQuickLook")
  }
}
```

- [ ] **Step 8: Typecheck the JS face**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "swellyo-quicklook" || echo "no swellyo-quicklook type errors"`
Expected: `no swellyo-quicklook type errors` (the module's `index.ts` typechecks; native files are not part of tsc).

- [ ] **Step 9: Commit**

```bash
git add modules/swellyo-quicklook
git commit -m "feat(native): add swellyo-quicklook Expo module (QLPreviewController)"
```

---

### Task 3: Extend the cache filename for QuickLook-eligible files

`FileBubble` currently gives renderable files (`kind !== 'none'`) an id-only cache name so the in-app readers accept the `file://`. QuickLook is the same class of consumer and needs the same safe name. This is a standalone, reviewable change to the `target` computation, done before the branch that uses it (Task 4) so the branch can rely on `localUri` already being safe.

**Files:**
- Modify: `src/components/messages/FileBubble.tsx:22` (import) and `:64-70` (the `kind` + `target` computation)

**Interfaces:**
- Consumes: `isQuickLookExt` from `../../services/messaging/fileAttachmentPolicy` (Task 1).
- Produces: after this task, a QuickLook-eligible file downloads to `${cacheDirectory}${message.id}.${ext}`, same as a renderable file.

- [ ] **Step 1: Add `isQuickLookExt` to the policy import**

In `src/components/messages/FileBubble.tsx`, change line 22 from:

```tsx
import { formatBytes, previewKindForExt } from '../../services/messaging/fileAttachmentPolicy';
```

to:

```tsx
import { formatBytes, previewKindForExt, isQuickLookExt } from '../../services/messaging/fileAttachmentPolicy';
```

- [ ] **Step 2: Extend the cache-name decision**

In `handleOpen`, replace the current `kind` + `target` block (lines 64–70):

```tsx
      const kind = previewKindForExt(meta.ext);
      // The in-app readers (pdf/text/image) reject a file:// uri whose name carries
      // spaces/accents/#, so renderable files get an id-only cache name. The share
      // sheet has no such limit, so a shared file keeps its human-readable name.
      const target = kind !== 'none'
        ? `${LegacyFS.cacheDirectory}${message.id}.${meta.ext}`
        : `${LegacyFS.cacheDirectory}${message.id}-${meta.display_name}`;
```

with:

```tsx
      const kind = previewKindForExt(meta.ext);
      // QuickLook (iOS Office preview) is the same class of consumer as the in-app
      // readers: it can choke on a file:// uri whose name carries spaces/accents/#.
      const quickLook = Platform.OS === 'ios' && isQuickLookExt(meta.ext);
      // The in-app readers (pdf/text/image) AND QuickLook reject an unsafe file://
      // name, so those get an id-only cache name. The share sheet has no such
      // limit, so a share-only file keeps its human-readable name.
      const target = (kind !== 'none' || quickLook)
        ? `${LegacyFS.cacheDirectory}${message.id}.${meta.ext}`
        : `${LegacyFS.cacheDirectory}${message.id}-${meta.display_name}`;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FileBubble" || echo "no FileBubble type errors"`
Expected: `no FileBubble type errors`.

- [ ] **Step 4: Commit**

```bash
git add src/components/messages/FileBubble.tsx
git commit -m "refactor(files): give QuickLook-eligible files an id-safe cache name"
```

---

### Task 4: The QuickLook branch in `FileBubble.handleOpen`

Adds the actual behavior: on iOS, an Office file is presented via QuickLook, falling through to the share sheet if that fails. Depends on Task 2 (`previewFile`) and Task 3 (safe cache name + `quickLook` local).

**Files:**
- Modify: `src/components/messages/FileBubble.tsx` — add the module import (near line 27) and the QuickLook branch (after the `kind !== 'none'` viewer branch, before the share-sheet block)

**Interfaces:**
- Consumes: `previewFile(uri: string): Promise<boolean>` from `../../../modules/swellyo-quicklook` (Task 2); the `quickLook` boolean local (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Import `previewFile`**

In `src/components/messages/FileBubble.tsx`, after the existing `FileViewerModal` import (line 27):

```tsx
import { FileViewerModal } from '../FileViewerModal';
```

add:

```tsx
import { previewFile } from '../../../modules/swellyo-quicklook';
```

- [ ] **Step 2: Add the QuickLook branch**

In `handleOpen`, the current renderable branch is:

```tsx
      if (kind !== 'none') {
        setViewer({ uri: localUri });
        return;
      }

      let shared = false;
```

Insert the QuickLook branch between the viewer branch and `let shared = false;`, so it reads:

```tsx
      if (kind !== 'none') {
        setViewer({ uri: localUri });
        return;
      }

      // iOS Office documents: present in-app via QuickLook. On failure (module
      // absent in Expo Go / an old build, or nothing to present from) fall
      // through to the share sheet — the honest fallback.
      if (quickLook) {
        const shown = await previewFile(localUri);
        if (shown) return;
      }

      let shared = false;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "FileBubble\|swellyo-quicklook" || echo "no relevant type errors"`
Expected: `no relevant type errors`.

- [ ] **Step 4: Update the FileBubble header comment**

The file header (lines 1–16) describes the branching. Update the second paragraph so the next reader knows about QuickLook. Replace:

```tsx
 * Tapping downloads the file to the cache (named by message id, never the
 * sender's display_name — unescaped chars break a file:// uri on Android) and
 * then, for an image / pdf / text file, opens it in-app via FileViewerModal.
 * Everything else is handed to the OS share sheet as before.
```

with:

```tsx
 * Tapping downloads the file to the cache (named by message id, never the
 * sender's display_name — unescaped chars break a file:// uri on Android) and
 * then, for an image / pdf / text file, opens it in-app via FileViewerModal.
 * On iOS an Office document (doc/xls/ppt/rtf) opens in-app via QuickLook.
 * Everything else — and any of the above when its viewer is unavailable — is
 * handed to the OS share sheet as before.
```

- [ ] **Step 5: Commit**

```bash
git add src/components/messages/FileBubble.tsx
git commit -m "feat(files): open received Office docs in QuickLook on iOS"
```

---

## Post-implementation (not a code task — for the human)

QuickLook presentation cannot be unit-tested (it presents a `UIViewController`). After the tasks land, the module requires a native rebuild before it does anything on device:

```bash
npx expo run:ios
```

Then verify the Acceptance Criteria from the spec on-device (Ohad):
1. `.docx` opens in QuickLook and renders. 2. `.xlsx` / `.pptx` likewise. 3. `.rtf` and legacy `.doc/.xls/.ppt`. 4. A PDF still opens the dark viewer, not QuickLook. 5. A `.zip` still opens the share sheet. 6. Android `.docx` → share sheet, unchanged. 7. Expo Go `.docx` → share sheet, no crash. 8. A `.docx` with a space/accent in its name renders (id-based cache name). 9. QuickLook's own share button hands the file onward.

---

## Self-Review

**Spec coverage:**
- New module `swellyo-quicklook` with all 7 files → Task 2. ✅
- `quickLookExts` membership pure + unit-tested in the policy → Task 1 (as `isQuickLookExt`, function form mirroring `isAllowedExt`/`previewKindForExt`; the spec's `.has()` is illustrative — the binding requirement "pure, in fileAttachmentPolicy.ts, unit-tested like previewKindForExt" is met). ✅
- Cache filename id-based for QuickLook-eligible too → Task 3. ✅
- Branch in `handleOpen` gated on iOS + ext, `previewFile` → share-sheet fallback on false → Task 4. ✅
- `requireOptionalNativeModule` fallback (Expo Go/old build → false → share sheet) → Task 2 Step 2 + Task 4 branch. ✅
- No cache cleanup for QuickLook files (they follow the share-sheet path's no-delete behavior; the delete lives only in `closeViewer`, which the QuickLook path never invokes) → satisfied by not touching `closeViewer`. ✅
- Extension set exactly `doc, docx, xls, xlsx, ppt, pptx, rtf` → Task 1 `QUICK_LOOK_EXTS`. ✅
- Non-goal: no PDF/image/text through QuickLook → `isQuickLookExt` returns false for those (Task 1 test asserts it) and the branch sits after `kind !== 'none'` returns. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows assertions. ✅

**Type consistency:** `isQuickLookExt(ext: string): boolean` defined in Task 1, imported/consumed identically in Task 3. `previewFile(uri: string): Promise<boolean>` defined in Task 2, imported/consumed identically in Task 4. The `quickLook` local is defined in Task 3 and read in Task 4. Native module `Name("SwellyoQuickLook")` matches `requireOptionalNativeModule<…>('SwellyoQuickLook')` and both `expo-module.config.json` module entries. ✅
