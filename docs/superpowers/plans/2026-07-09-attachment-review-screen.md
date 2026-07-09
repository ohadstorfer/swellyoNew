# Attachment Review Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picking a document or a contact in a chat opens a WhatsApp-style review screen instead of sending immediately.

**Architecture:** Two new full-screen modals mirror the existing `ImagePreviewModal`. `FilePreviewModal` dispatches on file extension through a pure `previewKindForExt()` — image, pdf, text, or a fallback file card — and carries a caption. `ContactPreviewModal` lets the user uncheck phone numbers and emails before sending. The caption threads through `messagingService`, `FileBubble`, `messagePreviewText`, and the push edge function.

**Tech Stack:** React Native 0.81.5, Expo SDK 54 (`newArchEnabled: true`), React 19, Reanimated, react-native-gesture-handler, expo-image, `react-native-pdf-renderer` (new), `expo-file-system` (promoted from transitive to explicit), Jest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-09-attachment-review-screen-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Fonts:** always `ff(family, weight)` from `src/theme/fonts.ts` — never a bare `fontFamily: 'Inter'` + `fontWeight` (iOS silently renders Regular). Wrap every `fontSize` in `fs(...)`. Set `includeFontPadding: false` on every `Text` style. `fontWeight` only for web.
- **Modals:** a full-screen modal is its own `<Modal>` — do NOT use `BottomSheetShell` (bottom sheets only). Set `animationType="fade"`, `onRequestClose`, and `statusBarTranslucent={Platform.OS === 'android'}`. Do NOT set `navigationBarTranslucent` (broken on SDK 54, expo/expo#39749).
- **Gestures in modals:** any `GestureDetector` inside a `Modal` must be wrapped in a local `<GestureHandlerRootView>` — RN Modals render in a separate native view tree and RNGH gestures silently never fire otherwise.
- **Keyboard:** import `KeyboardAvoidingView` from `react-native` inside these preview modals, matching `ImagePreviewModal`. (`src/utils/keyboardAvoidingView` is the rule for chat *screens*; the media preview modals are the established exception and this plan does not change them.)
- **Native modules:** guard with `isExpoGo` from `src/utils/keyboardAvoidingView`. For a native *component*, `try { require(...) } catch` is NOT enough — a component only fails when mounted. Resolve at module load, export `null`, and null-guard at the render site.
- **Primary color:** `composerPrimaryColor = '#05BCD3'` — both chat screens define this constant. Pass it to every new modal.
- **Errors:** never `Alert.alert(title, e.message)`. Use `friendlyErrorMessage` / `showErrorAlert` from `src/utils/friendlyError.ts`.
- **Git:** stage explicit paths. **Never `git commit -a`, never `git reset --hard`, never `git stash` without asking.** Ohad edits these files in parallel; unstaged work is unrecoverable.
- **Typecheck:** `npx tsc --noEmit` (there is no `typecheck` npm script).
- **Tests:** `npm test -- <path>` (jest, preset `jest-expo`, `testMatch: **/__tests__/**/*.test.{ts,tsx}`).
- **Do not verify on a simulator or with Maestro.** Verify by tests + `tsc`. Ohad tests on-device himself.
- **Native rebuild required.** `react-native-pdf-renderer` ships native code. This work is not OTA-able onto existing builds.

---

### Task 1: `previewKindForExt` — the pure renderer decision

**Files:**
- Modify: `src/services/messaging/fileAttachmentPolicy.ts`
- Test: `src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type FilePreviewKind = 'image' | 'pdf' | 'text' | 'none'` and `export function previewKindForExt(ext: string): FilePreviewKind`, plus `export const MAX_TEXT_PREVIEW_BYTES: number`.

Everything downstream branches on this. It is pure so it can be tested without a device.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe('fileAttachmentPolicy', ...)` block in `src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`, after the `describe('formatBytes', ...)` block:

```ts
  describe('previewKindForExt', () => {
    it('renders images inline', () => {
      expect(previewKindForExt('png')).toBe('image');
      expect(previewKindForExt('jpg')).toBe('image');
      expect(previewKindForExt('jpeg')).toBe('image');
      expect(previewKindForExt('gif')).toBe('image');
      expect(previewKindForExt('webp')).toBe('image');
      expect(previewKindForExt('heic')).toBe('image');
    });
    it('renders pdf with the native pdf view', () => {
      expect(previewKindForExt('pdf')).toBe('pdf');
    });
    it('renders plain text formats as text', () => {
      expect(previewKindForExt('txt')).toBe('text');
      expect(previewKindForExt('csv')).toBe('text');
    });
    it('falls back to the file card for everything else', () => {
      expect(previewKindForExt('zip')).toBe('none');
      expect(previewKindForExt('docx')).toBe('none');
      expect(previewKindForExt('xlsx')).toBe('none');
      expect(previewKindForExt('pptx')).toBe('none');
      expect(previewKindForExt('mp3')).toBe('none');
      expect(previewKindForExt('mp4')).toBe('none');
      expect(previewKindForExt('rtf')).toBe('none');
    });
    it('is case-insensitive and safe on junk input', () => {
      expect(previewKindForExt('PDF')).toBe('pdf');
      expect(previewKindForExt('')).toBe('none');
      expect(previewKindForExt(undefined as unknown as string)).toBe('none');
    });
    it('never previews a blocked extension', () => {
      expect(previewKindForExt('svg')).toBe('none');
      expect(previewKindForExt('html')).toBe('none');
    });
  });
```

And extend the import at the top of that file to include the new symbol:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`
Expected: FAIL — `TypeError: (0 , _fileAttachmentPolicy.previewKindForExt) is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/services/messaging/fileAttachmentPolicy.ts`, after `formatBytes`:

```ts
/**
 * How a picked file should be shown in the pre-send review screen.
 * 'none' means "show the file card" — it is the fallback AND the error state,
 * so a preview can never degrade into a blank pane.
 */
export type FilePreviewKind = 'image' | 'pdf' | 'text' | 'none';

/** Text previews read the whole file, so cap what we are willing to read. */
export const MAX_TEXT_PREVIEW_BYTES = 256 * 1024; // 256 KB

const IMAGE_PREVIEW_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic']);
const TEXT_PREVIEW_EXTS = new Set(['txt', 'csv']);

export function previewKindForExt(ext: string): FilePreviewKind {
  const e = String(ext ?? '').toLowerCase();
  // A blocked extension must never be rendered, even if some caller asks.
  if (!isAllowedExt(e)) return 'none';
  if (IMAGE_PREVIEW_EXTS.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (TEXT_PREVIEW_EXTS.has(e)) return 'text';
  return 'none';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/services/messaging/__tests__/fileAttachmentPolicy.test.ts`
Expected: PASS, all suites green (the pre-existing tests must still pass).

- [ ] **Step 5: Commit**

```bash
git add src/services/messaging/fileAttachmentPolicy.ts src/services/messaging/__tests__/fileAttachmentPolicy.test.ts
git commit -m "feat(chat): previewKindForExt decides how a picked file is previewed"
```

---

### Task 2: Extract `iconForExt` into a shared module

**Files:**
- Create: `src/components/messages/fileIcon.ts`
- Modify: `src/components/messages/FileBubble.tsx:23-33` (delete the local function, import instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function iconForExt(ext: string): keyof typeof Ionicons.glyphMap`

`iconForExt` currently lives inside `FileBubble.tsx` with no `export`. Task 4's `FileCard` needs the same icon. Move it rather than duplicate it. Pure mechanical change — no behavior change.

- [ ] **Step 1: Create the shared module**

Create `src/components/messages/fileIcon.ts`:

```ts
/**
 * Extension → Ionicons glyph. Shared by the sent-message FileBubble and the
 * pre-send FileCard so a file wears the same icon before and after sending.
 */
import { Ionicons } from '@expo/vector-icons';

export function iconForExt(ext: string): keyof typeof Ionicons.glyphMap {
  if (['pdf'].includes(ext)) return 'document-text';
  if (['doc', 'docx', 'rtf', 'txt'].includes(ext)) return 'document';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'grid';
  if (['ppt', 'pptx'].includes(ext)) return 'easel';
  if (['zip'].includes(ext)) return 'archive';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'wav'].includes(ext)) return 'musical-notes';
  if (['mp4', 'mov'].includes(ext)) return 'videocam';
  return 'document-attach';
}
```

- [ ] **Step 2: Delete the local copy from FileBubble**

In `src/components/messages/FileBubble.tsx`, delete the whole `function iconForExt(...) { ... }` block (lines 23-33) and add the import next to the other local imports:

```ts
import { iconForExt } from './fileIcon';
```

- [ ] **Step 3: Verify nothing else referenced it**

Run: `grep -rn "iconForExt" src/`
Expected: exactly two files — `src/components/messages/fileIcon.ts` (the definition) and `src/components/messages/FileBubble.tsx` (the import + one call site inside the `Ionicons name={...}` prop).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors mentioning `fileIcon` or `FileBubble`.

- [ ] **Step 5: Commit**

```bash
git add src/components/messages/fileIcon.ts src/components/messages/FileBubble.tsx
git commit -m "refactor(chat): lift iconForExt out of FileBubble so the preview can reuse it"
```

---

### Task 3: Add the dependencies and the Expo Go-safe PDF resolve

**Files:**
- Modify: `package.json`
- Create: `src/components/filePreview/pdfRenderer.ts`

**Interfaces:**
- Consumes: `isExpoGo` from `src/utils/keyboardAvoidingView`.
- Produces: `export const PdfRendererView: React.ComponentType<PdfRendererProps> | null` and `export interface PdfRendererProps { source: string; singlePage?: boolean; maxZoom?: number; maxPageResolution?: number; onError?: () => void; style?: StyleProp<ViewStyle>; }`

`expo-file-system` is already present at 19.0.17 as a transitive dep. Declaring it explicitly is required: an undeclared transitive dep can vanish on a dedupe.

**Do NOT install `react-native-pdf` (wonday).** It renders blank on iOS under Expo SDK 54 ([#969](https://github.com/wonday/react-native-pdf/issues/969)). `react-native-pdf-renderer` is a different library, is Fabric-native, and has zero dependencies.

- [ ] **Step 1: Install**

```bash
npx expo install expo-file-system
npm i -S react-native-pdf-renderer
```

Expected: `package.json` gains `"react-native-pdf-renderer": "^2.3.0"` and `"expo-file-system": "~19.0.17"` (exact ranges may differ; do not hand-edit them).

- [ ] **Step 2: Verify the native side links**

```bash
npx expo install --check
```

Expected: no complaint about `expo-file-system`. `react-native-pdf-renderer` is not an Expo package and will not be listed — that is correct, it autolinks against the committed `android/` and `ios/` folders.

> **iOS:** a `pod install` is needed before the next native build. Do not run it here if the working tree has unrelated native changes; note it for the rebuild instead.

- [ ] **Step 3: Write the guarded resolve**

Create `src/components/filePreview/pdfRenderer.ts`:

```ts
/**
 * react-native-pdf-renderer ships a native Fabric view. In Expo Go the native
 * component does not exist.
 *
 * The require()-then-probe-a-method guard used by contactPicker/documentPicker
 * does NOT work here: those modules expose functions, so accessing a method
 * trips the lazy native proxy and throws where we can catch it. A component is
 * never *called* — it is *mounted* — so the failure would land inside React's
 * render, not in our try. Resolve once at module load and export null instead,
 * exactly as src/utils/keyboardAvoidingView.ts does for KeyboardGestureArea.
 */
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

export interface PdfRendererProps {
  /** Local path only — a file:// uri that already exists on disk. */
  source: string;
  /** Renders only the first page, without scroll. */
  singlePage?: boolean;
  maxZoom?: number;
  /** Android only. Caps page resolution so a zoomed page cannot blow the bitmap budget. */
  maxPageResolution?: number;
  onError?: () => void;
  style?: StyleProp<ViewStyle>;
}

let resolved: ComponentType<PdfRendererProps> | null = null;
if (!isExpoGo) {
  try {
    resolved = require('react-native-pdf-renderer').default ?? null;
  } catch {
    resolved = null; // dep missing, or a build that predates it
  }
}

/** null when the native view is unavailable — callers MUST branch on it. */
export const PdfRendererView = resolved;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If TS complains it cannot find `react-native-pdf-renderer` types, the `require()` is untyped by design — the file declares its own `PdfRendererProps`, so there should be no error.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/filePreview/pdfRenderer.ts
git commit -m "feat(chat): add react-native-pdf-renderer behind an Expo Go guard"
```

---

### Task 4: `FileCard` — the fallback and the error state

**Files:**
- Create: `src/components/filePreview/FileCard.tsx`

**Interfaces:**
- Consumes: `iconForExt` (Task 2), `formatBytes` from `src/services/messaging/fileAttachmentPolicy`.
- Produces: `export function FileCard(props: { displayName: string; ext: string; sizeBytes: number; note?: string }): JSX.Element`

This is the `'none'` branch, the over-cap text branch, the Expo Go PDF branch, and the PDF error branch. Four callers, one component. It sits on the dark preview background, so its colors are the inverse of `FileBubble`'s.

- [ ] **Step 1: Write the component**

Create `src/components/filePreview/FileCard.tsx`:

```tsx
/**
 * The honest fallback for a file we cannot render: a big icon, the name, and
 * the size. Used for unrenderable types, for a text file over the read cap,
 * for a PDF in Expo Go, and when the PDF view fails. A blank pane is never an
 * acceptable outcome — this is what we show instead.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconForExt } from '../messages/fileIcon';
import { formatBytes } from '../../services/messaging/fileAttachmentPolicy';
import { ff, fs } from '../../theme/fonts';

interface FileCardProps {
  displayName: string;
  ext: string;
  sizeBytes: number;
  /** Replaces the "EXT · size" sub-label when we owe the user an explanation. */
  note?: string;
}

export function FileCard({ displayName, ext, sizeBytes, note }: FileCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={iconForExt(ext)} size={56} color="#FFFFFF" />
      </View>
      <Text numberOfLines={2} style={styles.name}>
        {displayName}
      </Text>
      <Text style={styles.sub}>
        {note ?? `${ext.toUpperCase()} · ${formatBytes(sizeBytes)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  name: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(17),
    color: '#FFFFFF',
    textAlign: 'center',
    includeFontPadding: false,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(13),
    color: 'rgba(255,255,255,0.6)',
    marginTop: 6,
    includeFontPadding: false,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/filePreview/FileCard.tsx
git commit -m "feat(chat): FileCard — the fallback surface for unrenderable files"
```

---

### Task 5: `FilePreviewBody` — the four-way dispatch, with an error boundary

**Files:**
- Create: `src/components/filePreview/FilePreviewBody.tsx`

**Interfaces:**
- Consumes: `previewKindForExt`, `MAX_TEXT_PREVIEW_BYTES` (Task 1); `FileCard` (Task 4); `PdfRendererView` (Task 3).
- Produces: `export function FilePreviewBody(props: { uri: string; displayName: string; ext: string; sizeBytes: number }): JSX.Element`

The whole point of this component is that **every failure path lands on `FileCard`**. A class error boundary is required because a native view that throws during mount cannot be caught by a hook.

- [ ] **Step 1: Write the component**

Create `src/components/filePreview/FilePreviewBody.tsx`:

```tsx
/**
 * Renders a locally-picked file for the pre-send review screen.
 *
 * Security: this renders only the OUTGOING file the sender just chose in their
 * own picker, before upload. FileBubble's rule — a RECEIVED file is never
 * rendered in-app, it opens through the OS share sheet — is unchanged.
 *
 * Every branch degrades to FileCard: unrenderable type, text over the cap, a
 * failed read, Expo Go, or a PDF view that throws. There is no path to a blank
 * pane.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import {
  previewKindForExt,
  MAX_TEXT_PREVIEW_BYTES,
} from '../../services/messaging/fileAttachmentPolicy';
import { PdfRendererView } from './pdfRenderer';
import { FileCard } from './FileCard';
import { ff, fs } from '../../theme/fonts';

interface FilePreviewBodyProps {
  uri: string;
  displayName: string;
  ext: string;
  sizeBytes: number;
}

/** A native view that throws on mount can only be caught by a class boundary. */
class RenderBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[FilePreviewBody] renderer failed, falling back to the card:', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function TextPreview({ uri }: { uri: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Safe to read whole: the caller already gated on MAX_TEXT_PREVIEW_BYTES.
        // The byte-capped alternative (file.open().readBytes) needs TextDecoder,
        // which this project does not polyfill.
        const { File } = await import('expo-file-system');
        const contents = await new File(uri).text();
        if (!cancelled) setText(contents);
      } catch (e) {
        console.warn('[FilePreviewBody] could not read text file:', e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (failed) throw new Error('text read failed'); // caught by RenderBoundary
  if (text === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  return (
    <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
      <Text style={styles.text} selectable>
        {text}
      </Text>
    </ScrollView>
  );
}

export function FilePreviewBody({ uri, displayName, ext, sizeBytes }: FilePreviewBodyProps) {
  const card = <FileCard displayName={displayName} ext={ext} sizeBytes={sizeBytes} />;
  const kind = previewKindForExt(ext);

  if (kind === 'image') {
    return (
      <RenderBoundary fallback={card}>
        <Image source={{ uri }} style={styles.image} contentFit="contain" transition={120} />
      </RenderBoundary>
    );
  }

  if (kind === 'pdf') {
    // Expo Go, or a build without the native view.
    if (!PdfRendererView) return card;
    return (
      <RenderBoundary fallback={card}>
        {/* borderRadius on this native view is ignored on Android and CRASHES on
            iOS — never round it directly; wrap it if you ever need rounding. */}
        <PdfRendererView
          source={uri}
          singlePage
          maxZoom={1}
          maxPageResolution={2048}
          style={styles.pdf}
        />
      </RenderBoundary>
    );
  }

  if (kind === 'text') {
    if (sizeBytes > MAX_TEXT_PREVIEW_BYTES) {
      return (
        <FileCard
          displayName={displayName}
          ext={ext}
          sizeBytes={sizeBytes}
          note="Too large to preview"
        />
      );
    }
    return (
      <RenderBoundary fallback={card}>
        <TextPreview uri={uri} />
      </RenderBoundary>
    );
  }

  return card;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1, width: '100%' },
  pdf: { flex: 1, width: '100%', backgroundColor: '#1A1A1A' },
  textScroll: { flex: 1, backgroundColor: '#FFFFFF' },
  textContent: { padding: 16 },
  text: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fs(12),
    lineHeight: 18,
    color: '#1A1A1A',
    includeFontPadding: false,
  },
});
```

> `ff()` is deliberately not used for the monospace text body — `Menlo`/`monospace` are system fonts and are not registered in `src/theme/fonts.ts`. `fs()` still applies.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/filePreview/FilePreviewBody.tsx
git commit -m "feat(chat): FilePreviewBody renders image/pdf/text, always degrading to the card"
```

---

### Task 6: `FilePreviewModal` — the shell

**Files:**
- Create: `src/components/FilePreviewModal.tsx`

**Interfaces:**
- Consumes: `FilePreviewBody` (Task 5), `ChatTextInput`.
- Produces:
  ```ts
  export interface PickedFilePreview {
    uri: string;
    display_name: string;
    ext: string;
    mime_type: string;
    size_bytes: number;
  }
  export const FilePreviewModal: React.FC<{
    visible: boolean;
    file: PickedFilePreview;
    onSend: (caption?: string) => void;
    onCancel: () => void;
    isProcessing?: boolean;
    primaryColor?: string;
  }>
  ```

This is `ImagePreviewModal` with the image swapped for `FilePreviewBody` and a filename in the header. Keep the gesture thresholds, the `sendingRef` double-send guard, and the Modal props identical — they are load-bearing and already tuned.

- [ ] **Step 1: Write the component**

Create `src/components/FilePreviewModal.tsx`:

```tsx
/**
 * FilePreviewModal — the WhatsApp-style review screen for a picked document.
 * Cancel sends nothing and uploads nothing; the upload only starts on send.
 *
 * Structurally a clone of ImagePreviewModal: the Modal → GestureHandlerRootView
 * → GestureDetector → Animated.View → KeyboardAvoidingView nesting is load-
 * bearing. RNGH gestures never fire inside an Android Modal without a local
 * GestureHandlerRootView.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ChatTextInput } from './ChatTextInput';
import { FilePreviewBody } from './filePreview/FilePreviewBody';
import { ff, fs } from '../theme/fonts';

export interface PickedFilePreview {
  uri: string;
  display_name: string;
  ext: string;
  mime_type: string;
  size_bytes: number;
}

interface FilePreviewModalProps {
  visible: boolean;
  file: PickedFilePreview;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  primaryColor?: string;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DISTANCE = 120; // px — past this, release dismisses
const DISMISS_VELOCITY = 800; // px/s — past this, release dismisses regardless of distance

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  visible,
  file,
  onSend,
  onCancel,
  isProcessing = false,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');
  const translateY = useSharedValue(0);
  // onSend is async and the modal stays mounted across the round-trip, so state
  // updates too slowly to block a double-tap. A ref blocks it in the same tick.
  const sendingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      translateY.value = 0;
      sendingRef.current = false;
    }
  }, [visible, translateY]);

  const handleSend = () => {
    if (isProcessing) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    onSend(caption.trim() || undefined);
    setCaption('');
  };

  const handleCancel = () => {
    if (isProcessing) return;
    setCaption('');
    onCancel();
  };

  const panGesture = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const distance = Math.abs(e.translationY);
      const velocity = Math.abs(e.velocityY);
      if (distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
        const destination = e.translationY > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT;
        translateY.value = withTiming(destination, { duration: 220 }, (finished) => {
          if (finished) {
            runOnJS(handleCancel)();
          }
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
      }
    });

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(
      Math.abs(translateY.value),
      [0, SCREEN_HEIGHT * 0.4],
      [1, 0.6],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.container}>
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.flex, animatedContentStyle]}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex}
              >
                <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={handleCancel}
                    disabled={isProcessing}
                    hitSlop={10}
                  >
                    <CloseIcon />
                  </TouchableOpacity>
                  <Text numberOfLines={1} style={styles.title}>
                    {file.display_name}
                  </Text>
                  {/* Balances the close button so the title stays centered. */}
                  <View style={styles.closeButton} />
                </View>

                <View style={styles.body}>
                  <FilePreviewBody
                    uri={file.uri}
                    displayName={file.display_name}
                    ext={file.ext}
                    sizeBytes={file.size_bytes}
                  />
                </View>

                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                  <ChatTextInput
                    value={caption}
                    onChangeText={setCaption}
                    onSend={handleSend}
                    placeholder="Add a comment…"
                    allowEmpty
                    disabled={isProcessing}
                    primaryColor={primaryColor}
                    backgroundColor="#2A2A2A"
                    textColor="#FFFFFF"
                    placeholderColor="rgba(255,255,255,0.5)"
                  />
                </View>
              </KeyboardAvoidingView>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '600'),
    fontSize: fs(16),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  body: { flex: 1 },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    minHeight: 64,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/FilePreviewModal.tsx
git commit -m "feat(chat): FilePreviewModal — review a document before sending it"
```

---

### Task 7: Caption plumbing through the service and the read surfaces

**Files:**
- Modify: `src/services/messaging/messagingService.ts` (`createTypedMessageWithMetadata`, `createFileMessageWithMetadata`, `createContactMessageWithMetadata`)
- Modify: `src/services/messaging/messagePreviewText.ts`
- Modify: `src/components/messages/FileBubble.tsx`
- Test: `src/services/messaging/__tests__/messagePreviewText.test.ts` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `createFileMessageWithMetadata(conversationId: string, fileMetadata: FileMetadata, clientId: string, body?: string): Promise<Message>`
  - `createContactMessageWithMetadata(conversationId: string, contactMetadata: ContactMetadata, clientId: string, body?: string): Promise<Message>`
  - `FileBubble` gains an optional `textAlign?: 'left' | 'right'` prop.

`body` is unconstrained for `file`/`contact` in `check_message_type`, so no migration is needed. `body` is appended last and defaults to `''`, so every existing call site keeps compiling.

`getBodyTextAlign` is a private function inside each screen, not exported — so the *screen* computes the alignment and passes it down, exactly as it does for the image caption.

- [ ] **Step 1: Write the failing test**

Create `src/services/messaging/__tests__/messagePreviewText.test.ts`:

```ts
import { messagePreviewText } from '../messagePreviewText';

describe('messagePreviewText', () => {
  describe('file messages', () => {
    it('shows the filename when there is no caption', () => {
      expect(
        messagePreviewText({ type: 'file', body: '', file_metadata: { display_name: 'trip.pdf' } }),
      ).toBe('📎 trip.pdf');
    });
    it('prefers the caption when one was typed', () => {
      expect(
        messagePreviewText({
          type: 'file',
          body: 'here is the itinerary',
          file_metadata: { display_name: 'trip.pdf' },
        }),
      ).toBe('here is the itinerary');
    });
    it('falls back when the metadata has no name', () => {
      expect(messagePreviewText({ type: 'file', body: '', file_metadata: {} })).toBe('📎 File');
    });
  });

  describe('contact messages', () => {
    it('shows the contact name', () => {
      expect(
        messagePreviewText({ type: 'contact', contact_metadata: { display_name: 'Ana' } }),
      ).toBe('👤 Ana');
    });
  });

  describe('other types are unchanged', () => {
    it('labels media', () => {
      expect(messagePreviewText({ type: 'image' })).toBe('Image');
      expect(messagePreviewText({ type: 'video' })).toBe('Video');
      expect(messagePreviewText({ type: 'audio' })).toBe('Voice message');
    });
    it('returns the body for text', () => {
      expect(messagePreviewText({ type: 'text', body: 'hola' })).toBe('hola');
    });
    it('returns empty for nothing', () => {
      expect(messagePreviewText(null)).toBe('');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/messaging/__tests__/messagePreviewText.test.ts`
Expected: FAIL on "prefers the caption when one was typed" — received `📎 trip.pdf`, expected `here is the itinerary`. Every other test passes.

- [ ] **Step 3: Make `messagePreviewText` prefer the caption**

In `src/services/messaging/messagePreviewText.ts`, replace the `file` and `contact` lines:

```ts
  if (m.type === 'file' || m.file_metadata) {
    // A caption is what the sender chose to say — it beats the filename.
    return m.body?.trim() || `📎 ${m.file_metadata?.display_name ?? 'File'}`;
  }
  if (m.type === 'contact' || m.contact_metadata) {
    return `👤 ${m.contact_metadata?.display_name ?? 'Contact'}`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/messaging/__tests__/messagePreviewText.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread `body` through the service**

In `src/services/messaging/messagingService.ts`, change `createTypedMessageWithMetadata`'s signature and payload:

```ts
  private async createTypedMessageWithMetadata(
    conversationId: string,
    type: MessageType,
    metadataColumn: 'file_metadata' | 'contact_metadata',
    metadata: unknown,
    clientId: string,
    body: string = '',
  ): Promise<Message> {
```

and, in the `payload` object, replace `body: '',` with:

```ts
      body,
```

Then both public methods:

```ts
  /** Upload-first file message (bytes already uploaded to storage). */
  async createFileMessageWithMetadata(
    conversationId: string,
    fileMetadata: FileMetadata,
    clientId: string,
    body: string = '',
  ): Promise<Message> {
    return this.createTypedMessageWithMetadata(
      conversationId, 'file', 'file_metadata', fileMetadata, clientId, body,
    );
  }

  /** Shared-contact message (inline metadata, no upload). */
  async createContactMessageWithMetadata(
    conversationId: string,
    contactMetadata: ContactMetadata,
    clientId: string,
    body: string = '',
  ): Promise<Message> {
    return this.createTypedMessageWithMetadata(
      conversationId, 'contact', 'contact_metadata', contactMetadata, clientId, body,
    );
  }
```

- [ ] **Step 6: Render the caption in `FileBubble`**

In `src/components/messages/FileBubble.tsx`, extend the props:

```ts
interface FileBubbleProps {
  message: Message;
  isOwn: boolean;
  onLongPress?: (e: any) => void;
  /** Computed by the screen (getBodyTextAlign is screen-private). */
  textAlign?: 'left' | 'right';
}
```

and destructure `textAlign` in the signature. The component currently returns a bare row `Pressable`; a caption cannot be a third child of a `flexDirection: 'row'` without becoming a third column. Wrap it. Replace the `return ( ... )` with:

```tsx
  return (
    <View>
      <Pressable onPress={handleOpen} onLongPress={onLongPress} delayLongPress={300} style={styles.row}>
        {/* ...icon box and text column unchanged... */}
      </Pressable>
      {!!message.body?.trim() && (
        <Text style={[styles.caption, { color: nameColor, textAlign: textAlign ?? 'left' }]}>
          {message.body}
        </Text>
      )}
    </View>
  );
```

and add to the StyleSheet:

```ts
  caption: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(15),
    lineHeight: 20,
    marginTop: 6,
    paddingHorizontal: 2,
    maxWidth: 240,
    includeFontPadding: false,
  },
```

- [ ] **Step 7: Pass `textAlign` from both screens**

In `src/screens/DirectMessageScreen.tsx` and `src/screens/DirectGroupChat.tsx`, find the `<FileBubble` render (grep: `grep -n "<FileBubble" src/screens/*.tsx`) and add the prop:

```tsx
  textAlign={getBodyTextAlign(message.body)}
```

- [ ] **Step 8: Typecheck and run the whole messaging test suite**

Run: `npx tsc --noEmit && npm test -- src/services/messaging`
Expected: `tsc` clean; all messaging tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/services/messaging/messagingService.ts \
        src/services/messaging/messagePreviewText.ts \
        src/services/messaging/__tests__/messagePreviewText.test.ts \
        src/components/messages/FileBubble.tsx \
        src/screens/DirectMessageScreen.tsx \
        src/screens/DirectGroupChat.tsx
git commit -m "feat(chat): carry a caption on file messages, end to end"
```

---

### Task 8: Wire `FilePreviewModal` into `DirectMessageScreen`

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx`

**Interfaces:**
- Consumes: `FilePreviewModal`, `PickedFilePreview` (Task 6); `createFileMessageWithMetadata(..., body)` (Task 7).
- Produces: nothing consumed by later tasks.

`handlePickDocument` currently calls `handleFileSend` straight from the picker result. It must instead park the picked file in state and open the modal. `handleFileSend` grows a `caption` parameter, which it writes to the optimistic message's `body` and passes to `uploadAndCreateFile`.

- [ ] **Step 1: Import and add state**

Add next to the other component imports (near line 62):

```tsx
import { FilePreviewModal, type PickedFilePreview } from '../components/FilePreviewModal';
```

Add next to the other preview-modal state (near line 566):

```tsx
  const [pendingFile, setPendingFile] = useState<PickedFilePreview | null>(null);
  const [filePreviewVisible, setFilePreviewVisible] = useState(false);
```

- [ ] **Step 2: Make `handlePickDocument` open the modal instead of sending**

Replace the body of `handlePickDocument`:

```tsx
  const handlePickDocument = async () => {
    if (!currentConversationId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }
    const { pickDocument } = await import('../services/messaging/documentPicker');
    const picked = await pickDocument();
    if (!picked) return;
    // Review before sending — nothing is uploaded until the user hits send.
    setPendingFile(picked);
    setFilePreviewVisible(true);
  };
```

`pickDocument()` already returns exactly the `PickedFilePreview` shape (`uri`, `display_name`, `ext`, `mime_type`, `size_bytes`), so no mapping is needed.

- [ ] **Step 3: Give `handleFileSend` a caption**

Change its signature and the two places `body` appears:

```tsx
  const handleFileSend = async (
    localUri: string,
    baseMeta: { display_name: string; ext: string; mime_type: string; size_bytes: number },
    caption?: string,
  ) => {
```

In the `optimistic` object, replace `body: '',` with:

```tsx
      body: caption ?? '',
```

and in the `try` block, pass it through:

```tsx
      const { created, fileMetadata } = await uploadAndCreateFile(conversationId, clientId, localUri, baseMeta, caption);
```

- [ ] **Step 4: Give `uploadAndCreateFile` a caption**

```tsx
  const uploadAndCreateFile = async (
    convId: string,
    clientId: string,
    localUri: string,
    baseMeta: { display_name: string; ext: string; mime_type: string; size_bytes: number },
    caption?: string,
  ): Promise<{ created: Message; fileMetadata: FileMetadata }> => {
```

and the create call at the end of it:

```tsx
    const created = await messagingService.createFileMessageWithMetadata(convId, fileMetadata, clientId, caption ?? '');
```

> The retry path further down the file also calls `uploadAndCreateFile`. Find it with `grep -n "uploadAndCreateFile" src/screens/DirectMessageScreen.tsx` — there are three hits: the definition, the call in `handleFileSend`, and the retry. The retry must pass the failed message's own body so a retried caption is not lost: add `, m.body || undefined` (or the local variable holding the failed message) as the fifth argument. Read the surrounding code and use the variable that is actually in scope.

- [ ] **Step 5: Render the modal**

Next to the `ImagePreviewModal` render (near line 5384), add:

```tsx
      {/* File Preview Modal — review the document, add a comment, then send. */}
      {pendingFile && (
        <FilePreviewModal
          visible={filePreviewVisible}
          file={pendingFile}
          onSend={(caption) => {
            const f = pendingFile;
            setFilePreviewVisible(false);
            setPendingFile(null);
            if (f) {
              void handleFileSend(f.uri, {
                display_name: f.display_name,
                ext: f.ext,
                mime_type: f.mime_type,
                size_bytes: f.size_bytes,
              }, caption);
            }
          }}
          onCancel={() => {
            setFilePreviewVisible(false);
            setPendingFile(null);
          }}
          primaryColor={composerPrimaryColor}
        />
      )}
```

> The modal closes *before* the upload starts, matching the file-send flow's existing optimistic-message behavior (the bubble appears immediately with `upload_state: 'uploading'`). There is no `isProcessing` spinner to thread here.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Confirm the picker no longer sends directly**

Run: `grep -n "handleFileSend" src/screens/DirectMessageScreen.tsx`
Expected: the definition, and exactly one call — inside `FilePreviewModal`'s `onSend`. `handlePickDocument` must no longer call it.

- [ ] **Step 8: Commit**

```bash
git add src/screens/DirectMessageScreen.tsx
git commit -m "feat(chat): review a document before sending it in 1:1 chats"
```

---

### Task 9: Mirror the file preview into `DirectGroupChat`

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx`

**Interfaces:**
- Consumes: same as Task 8.
- Produces: nothing.

The four handlers in this file are byte-for-byte identical to `DirectMessageScreen`'s, and the variable names match exactly (`currentConversationId`, `currentUserId`, `scrollToBottom`, `chatHistoryCache`, `composerPrimaryColor`). Apply Task 8 verbatim here. Do not extract a shared hook — both screens are under concurrent edit.

- [ ] **Step 1: Apply every step of Task 8 to this file**

Steps 1 through 5 of Task 8, unchanged. The only differences are line numbers:
- Imports near line 62.
- Preview-modal state near line 500.
- `uploadAndCreateFile` at ~2724, `handleFileSend` at ~2747, `handlePickDocument` at ~2807.
- `ImagePreviewModal` render at ~5240.
- `composerPrimaryColor` at line 549.

Locate every one by symbol name, not by line number — Ohad is editing this file in parallel.

- [ ] **Step 2: Verify the two screens agree**

```bash
diff \
  <(sed -n '/const handleFileSend = async/,/^  };$/p' src/screens/DirectMessageScreen.tsx) \
  <(sed -n '/const handleFileSend = async/,/^  };$/p' src/screens/DirectGroupChat.tsx)
```

Expected: no output. The two `handleFileSend` bodies were identical before this change and must stay identical after it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/screens/DirectGroupChat.tsx
git commit -m "feat(chat): review a document before sending it in group chats"
```

---

### Task 10: `ContactPreviewModal`

**Files:**
- Create: `src/components/ContactPreviewModal.tsx`

**Interfaces:**
- Consumes: `ContactMetadata` from `src/services/messaging/messagingService`.
- Produces:
  ```ts
  export const ContactPreviewModal: React.FC<{
    visible: boolean;
    contact: ContactMetadata;
    onSend: (contact: ContactMetadata) => void;
    onCancel: () => void;
    primaryColor?: string;
  }>
  ```

`onSend` hands back a **filtered** `ContactMetadata` containing only the checked rows. Everything starts checked. Send is disabled when nothing is checked.

`ContactMetadata` is `{ display_name: string; phone_numbers: { label?: string; number: string }[]; emails?: { label?: string; email: string }[] }`.

- [ ] **Step 1: Write the component**

Create `src/components/ContactPreviewModal.tsx`:

```tsx
/**
 * ContactPreviewModal — the WhatsApp-style review screen for a shared contact.
 * Every number and email starts checked; unchecking one drops it from the sent
 * metadata. Send is disabled once nothing is left to send.
 *
 * No caption here — WhatsApp has none on this screen either.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import type { ContactMetadata } from '../services/messaging/messagingService';
import { ff, fs } from '../theme/fonts';

interface ContactPreviewModalProps {
  visible: boolean;
  contact: ContactMetadata;
  onSend: (contact: ContactMetadata) => void;
  onCancel: () => void;
  primaryColor?: string;
}

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Stable key for a row, so selection survives a re-render. */
const phoneKey = (i: number) => `phone:${i}`;
const emailKey = (i: number) => `email:${i}`;

export const ContactPreviewModal: React.FC<ContactPreviewModalProps> = ({
  visible,
  contact,
  onSend,
  onCancel,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();

  const allKeys = useMemo(() => {
    const keys = (contact.phone_numbers ?? []).map((_, i) => phoneKey(i));
    (contact.emails ?? []).forEach((_, i) => keys.push(emailKey(i)));
    return keys;
  }, [contact]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(allKeys));

  // Reopening with a different contact must not inherit the old selection.
  useEffect(() => {
    if (visible) setSelected(new Set(allKeys));
  }, [visible, allKeys]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canSend = selected.size > 0;

  const handleSend = () => {
    if (!canSend) return;
    const phone_numbers = (contact.phone_numbers ?? []).filter((_, i) => selected.has(phoneKey(i)));
    const emails = (contact.emails ?? []).filter((_, i) => selected.has(emailKey(i)));
    onSend({
      display_name: contact.display_name,
      phone_numbers,
      ...(emails.length ? { emails } : {}),
    });
  };

  const Row = ({
    label,
    value,
    checked,
    onPress,
  }: {
    label: string;
    value: string;
    checked: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.checkbox, checked && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
        {checked && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: primaryColor }]}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onCancel} hitSlop={10}>
            <CloseIcon />
          </TouchableOpacity>
          <Text style={styles.title}>Send contact</Text>
          <TouchableOpacity
            style={[
              styles.sendPill,
              { backgroundColor: canSend ? primaryColor : '#3A3A3A' },
            ]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            <Text style={[styles.sendText, !canSend && styles.sendTextDisabled]}>Send</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={28} color="#FFFFFF" />
            </View>
            <Text numberOfLines={1} style={styles.name}>
              {contact.display_name}
            </Text>
          </View>

          {(contact.phone_numbers ?? []).map((p, i) => (
            <Row
              key={phoneKey(i)}
              label={p.label ? p.label : 'Phone'}
              value={p.number}
              checked={selected.has(phoneKey(i))}
              onPress={() => toggle(phoneKey(i))}
            />
          ))}

          {(contact.emails ?? []).map((e, i) => (
            <Row
              key={emailKey(i)}
              label={e.label ? e.label : 'Email'}
              value={e.email}
              checked={selected.has(emailKey(i))}
              onPress={() => toggle(emailKey(i))}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '600'),
    fontSize: fs(17),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  sendPill: {
    paddingHorizontal: 18,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(15),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  sendTextDisabled: { color: 'rgba(255,255,255,0.4)' },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    fontSize: fs(19),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: {
    fontFamily: ff('Inter', '500'),
    fontSize: fs(13),
    includeFontPadding: false,
  },
  rowValue: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(17),
    color: '#FFFFFF',
    marginTop: 2,
    includeFontPadding: false,
  },
});
```

> No `GestureHandlerRootView` here: this modal has no `GestureDetector`. Adding an unused RNGH root inside a Modal is harmless but noise.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ContactPreviewModal.tsx
git commit -m "feat(chat): ContactPreviewModal — pick which numbers to share"
```

---

### Task 11: Wire `ContactPreviewModal` into both screens

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx`
- Modify: `src/screens/DirectGroupChat.tsx`

**Interfaces:**
- Consumes: `ContactPreviewModal` (Task 10), `createContactMessageWithMetadata(..., body)` (Task 7).
- Produces: nothing.

`handlePickContact` today does pick + optimistic insert + send in one function. Split it: the picker fills state and opens the modal; a new `sendContact(contact)` does everything that came after `if (!contact) return;`.

- [ ] **Step 1: Import and add state (both screens)**

```tsx
import { ContactPreviewModal } from '../components/ContactPreviewModal';
```

```tsx
  const [pendingContact, setPendingContact] = useState<ContactMetadata | null>(null);
  const [contactPreviewVisible, setContactPreviewVisible] = useState(false);
```

`ContactMetadata` is already imported in both screens via the messaging service types — verify with `grep -n "ContactMetadata" src/screens/DirectMessageScreen.tsx` and add it to the existing type import if missing.

- [ ] **Step 2: Split `handlePickContact` (both screens)**

Replace the whole function with these two:

```tsx
  const handlePickContact = async () => {
    if (!currentConversationId || !currentUserId) {
      Alert.alert('Error', 'Please wait for the conversation to load');
      return;
    }
    try {
      const { pickContact } = await import('../services/messaging/contactPicker');
      const contact = await pickContact();
      if (!contact) return;
      // Review before sending — the user chooses which numbers to share.
      setPendingContact(contact);
      setContactPreviewVisible(true);
    } catch (error: any) {
      console.error('Error picking contact:', error);
      Alert.alert('Error', friendlyErrorMessage(error, 'Failed to pick a contact'));
    }
  };

  const sendContact = async (contact: ContactMetadata) => {
    if (!currentConversationId || !currentUserId) return;
    const conversationId = currentConversationId;
    const clientId = Crypto.randomUUID();

    const optimistic: Message = {
      id: clientId,
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: '',
      type: 'contact',
      contact_metadata: contact,
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      upload_state: 'sent',
    } as Message;

    setMessages((prev) => {
      const next = [...prev, optimistic];
      chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
      return next;
    });
    scrollToBottom();

    try {
      const created = await messagingService.createContactMessageWithMetadata(conversationId, contact, clientId);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId
            ? { ...created, contact_metadata: created.contact_metadata ?? contact, upload_state: 'sent' as const }
            : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
    } catch (error: any) {
      console.error('Error sending contact:', error);
      setMessages((prev) => {
        const next = prev.map(m =>
          m.id === clientId ? { ...m, upload_state: 'failed' as const, upload_error: error?.message } : m
        );
        chatHistoryCache.saveMessages(conversationId, next).catch(() => {});
        return next;
      });
      Alert.alert('Could not send contact', friendlyErrorMessage(error, 'Failed to send contact'));
    }
  };
```

- [ ] **Step 3: Render the modal (both screens)**

Next to the `FilePreviewModal` render:

```tsx
      {/* Contact Preview Modal — choose which numbers/emails to share. */}
      {pendingContact && (
        <ContactPreviewModal
          visible={contactPreviewVisible}
          contact={pendingContact}
          onSend={(filtered) => {
            setContactPreviewVisible(false);
            setPendingContact(null);
            void sendContact(filtered);
          }}
          onCancel={() => {
            setContactPreviewVisible(false);
            setPendingContact(null);
          }}
          primaryColor={composerPrimaryColor}
        />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Confirm the picker no longer sends directly (both screens)**

Run: `grep -n "createContactMessageWithMetadata" src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx`
Expected: exactly one hit per screen, inside `sendContact`. `handlePickContact` must not reference it.

- [ ] **Step 6: Commit**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
git commit -m "feat(chat): review a contact before sharing it"
```

---

### Task 12: Fix the empty push body for file and contact messages

**Files:**
- Modify: `supabase/functions/send-push-notification/index.ts:98-118`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Pre-existing bug, unrelated to the review screens but directly in their path. `file` and `contact` fall into the final `else`, which reads `msg.body` — empty for both types today. **Their pushes currently arrive with no body at all.** With Task 7 a file may now carry a caption, so the fix is worth doing at the same time.

The `.select()` fetches only `body, type`, so the metadata is not even available to build a label from.

- [ ] **Step 1: Download and diff the live function first**

This function has drifted from the repo before. Do not deploy on top of an unknown live version.

```bash
npx supabase functions download send-push-notification --project-ref rfdhtvcmagsbxqntnepv
diff supabase/functions/send-push-notification/index.ts supabase/functions/send-push-notification/index.ts.downloaded
```

(The project ref comes from `supabase/config.toml:1`. The CLI writes the downloaded copy back over the same path, so copy the repo file aside first if you want a clean diff.)

Expected: understand every difference before touching anything. If the live version has changes not in the repo, stop and surface them.

- [ ] **Step 2: Extend the select**

Replace lines 98-102:

```ts
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('body, type, file_metadata, contact_metadata')
    .eq('id', messageId)
    .single();
```

- [ ] **Step 3: Add the two branches**

Replace lines 109-118:

```ts
  let body: string;
  if (msg.type === 'image') {
    body = 'Sent a photo';
  } else if (msg.type === 'audio') {
    body = 'Sent a voice message';
  } else if (msg.type === 'video') {
    body = 'Sent a video';
  } else if (msg.type === 'file') {
    // Mirrors messagePreviewText.ts so the push and the conversation list agree.
    body = msg.body?.trim()
      ? truncateForPush(msg.body)
      : `📎 ${msg.file_metadata?.display_name ?? 'File'}`;
  } else if (msg.type === 'contact') {
    body = `👤 ${msg.contact_metadata?.display_name ?? 'Contact'}`;
  } else {
    body = truncateForPush(msg.body || '');
  }
```

- [ ] **Step 4: Typecheck the edge function**

Run: `npx tsc --noEmit` (the repo's tsconfig may exclude `supabase/functions`; if so, this step is a no-op and the Deno types are checked at deploy).
Expected: no error introduced in `src/`.

- [ ] **Step 5: Commit (do NOT deploy yet)**

```bash
git add supabase/functions/send-push-notification/index.ts
git commit -m "fix(push): file and contact messages pushed with an empty body"
```

- [ ] **Step 6: Deploy, after Ohad approves**

```bash
npx supabase functions deploy send-push-notification --use-api --project-ref rfdhtvcmagsbxqntnepv
```

Deploying sends real pushes to real users on the next message. Confirm before running. `config.toml` has no `[functions.send-push-notification]` block, so pass `--no-verify-jwt` only if the current live function has JWT verification off — check first, or the deploy silently flips it on and every push breaks.

---

## Verification (whole feature)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test` — the full suite passes
- [ ] `grep -rn "react-native-pdf\"" package.json` — **no match** (we must not have installed wonday's library)
- [ ] The native rebuild is queued. `react-native-pdf-renderer` cannot ship over the air.

**On-device, by Ohad** (do not attempt in a simulator or with Maestro):

1. Pick a PDF → renders page one; close → nothing sent.
2. Pick a PDF **in Expo Go** → file card, no crash, no alert.
3. Pick a `.png` → renders; pick a `.csv` under 256 KB → raw text; pick a `.zip` → card.
4. Type a comment on a document, send → the caption shows under the bubble, in the conversation list, and in the push on the other device.
5. Pick a contact with two numbers → uncheck one → send → the bubble and the saved contact carry only the checked number.
6. Uncheck every row → Send is disabled.
7. Repeat 1 and 5 in a group chat.

## Follow-ups (not in this plan)

- `handleFileSend`, `uploadAndCreateFile`, `handlePickDocument`, and `sendContact` are byte-for-byte duplicated across `DirectMessageScreen` and `DirectGroupChat`. Extract into a `useAttachmentSend` hook once both files are quiet.
- Multiple contacts per share (needs a custom contact list; `presentContactPickerAsync` returns one).
- CSV rendered as a table rather than raw text.
