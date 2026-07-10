# Received File Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a received image, PDF, or text file opens it inside the app instead of handing it to the OS share sheet.

**Architecture:** Extract the shared chrome of the existing send-side `FilePreviewModal` into a headless `FilePreviewShell` (header + dismiss gesture + `FilePreviewBody`, footer as `children`). Add a receive-side `FileViewerModal` wrapping the shell with a caption + share footer. `FileBubble.handleOpen` branches on `previewKindForExt`: renderable kinds download to a safe cache path and open the viewer; everything else keeps today's share-sheet path. The viewer deletes its cache file on close.

**Tech Stack:** React Native 0.81.5, Expo SDK 54, React 19, Reanimated, react-native-gesture-handler, expo-image, react-native-pdf-renderer, expo-file-system 19, expo-sharing 14, Jest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-10-received-file-viewer-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **One area of the tree.** Only `src/components/FilePreviewModal.tsx`, `src/components/messages/FileBubble.tsx`, and two new files under `src/components/`. **Nothing** in `DirectMessageScreen.tsx` or `DirectGroupChat.tsx`.
- **Fonts:** every `fontFamily` from `ff(family, weight)` in `src/theme/fonts.ts`; every `fontSize` wrapped in `fs(...)`; `includeFontPadding: false` on every `Text` style. `fontWeight` web-only.
- **Modal chrome is load-bearing and must be preserved byte-for-byte when moved:** the nesting `Modal → GestureHandlerRootView → View → GestureDetector → Animated.View → KeyboardAvoidingView`, the gesture thresholds (`activeOffsetY([-15,15])`, `failOffsetX([-25,25])`, dismiss at distance `>120` or velocity `>800`, fly-off `withTiming` 220ms, snap-back `withSpring({damping:22,stiffness:180})`), and the Modal props (`animationType="fade"`, `onRequestClose`, `statusBarTranslucent={Platform.OS === 'android'}`, no `navigationBarTranslucent`, no `transparent`). RNGH gestures never fire inside an Android Modal without a local `GestureHandlerRootView`.
- **`KeyboardAvoidingView` is imported from `react-native`** here (matches the existing file), not from `src/utils/keyboardAvoidingView`.
- **`FilePreviewBody` is reused unchanged.** Its props: `{ uri: string; displayName: string; ext: string; sizeBytes: number }`. It already degrades every failure to `FileCard` and guards Expo Go.
- **`previewKindForExt(ext): 'image' | 'pdf' | 'text' | 'none'`** from `src/services/messaging/fileAttachmentPolicy.ts` is the single source of truth for what is renderable. Do not re-derive it.
- **Cache filenames must be `${message.id}.${ext}`** — never the sender's `display_name`. Unescaped characters in a `file://` uri fail silently on Android.
- **Git:** stage explicit paths. Never `git commit -a`, never `git reset --hard`. Ohad edits in parallel.
- **Typecheck:** `npx tsc --noEmit`. Baseline is 253 pre-existing errors in unrelated files. Bar: no NEW error mentioning a touched file.
- **Tests:** `npx jest <path>` (preset jest-expo).
- **Do not verify on a simulator or with Maestro.** `tsc` + on-device by Ohad.
- **Native rebuild already shipped** for the send-side feature; no new native dep is added here (`react-native-pdf-renderer`, `expo-file-system`, `expo-sharing` are all present).

---

### Task 1: Extract `FilePreviewShell`

**Files:**
- Create: `src/components/filePreview/FilePreviewShell.tsx`
- Modify: `src/components/FilePreviewModal.tsx`

**Interfaces:**
- Consumes: `FilePreviewBody` (`{ uri, displayName, ext, sizeBytes }`).
- Produces:
  ```ts
  export interface FilePreviewShellProps {
    visible: boolean;
    title: string;
    uri: string;
    ext: string;
    sizeBytes: number;
    onDismiss: () => void;
    dismissDisabled?: boolean;   // send side disables the close button mid-upload
    children?: React.ReactNode;  // the footer
  }
  export const FilePreviewShell: React.FC<FilePreviewShellProps>
  ```

The shell owns everything `FilePreviewModal` and `FileViewerModal` share: the Modal, the RNGH root, the swipe-dismiss gesture, the header, the body, and a footer slot. It owns **no caption state and no send logic** — those stay in `FilePreviewModal`.

The gesture's fly-off calls `onDismiss` via `runOnJS`. `title` shows in the header (the shell's caller passes the pretty `display_name`, even when the cache file is named by id).

- [ ] **Step 1: Write the shell**

Create `src/components/filePreview/FilePreviewShell.tsx`. This is the chrome lifted verbatim from `FilePreviewModal.tsx` (lines 54-232 of the current file), with the caption footer replaced by `{children}` and the send-specific pieces removed:

```tsx
/**
 * FilePreviewShell — the dark full-screen chrome shared by the send-side
 * FilePreviewModal and the receive-side FileViewerModal: a close X, a centered
 * filename, swipe-down-to-dismiss, and FilePreviewBody. The footer is a slot.
 *
 * The Modal → GestureHandlerRootView → GestureDetector → Animated.View →
 * KeyboardAvoidingView nesting is load-bearing: RNGH gestures never fire inside
 * an Android Modal without a local GestureHandlerRootView.
 */
import React from 'react';
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
import { FilePreviewBody } from './FilePreviewBody';
import { ff, fs } from '../../theme/fonts';

export interface FilePreviewShellProps {
  visible: boolean;
  title: string;
  uri: string;
  ext: string;
  sizeBytes: number;
  onDismiss: () => void;
  dismissDisabled?: boolean;
  children?: React.ReactNode;
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

export const FilePreviewShell: React.FC<FilePreviewShellProps> = ({
  visible,
  title,
  uri,
  ext,
  sizeBytes,
  onDismiss,
  dismissDisabled = false,
  children,
}) => {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);

  // Reset the drag offset whenever the shell reopens.
  React.useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

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
            runOnJS(onDismiss)();
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
      onRequestClose={onDismiss}
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
                    onPress={onDismiss}
                    disabled={dismissDisabled}
                    hitSlop={10}
                  >
                    <CloseIcon />
                  </TouchableOpacity>
                  <Text numberOfLines={1} style={styles.title}>
                    {title}
                  </Text>
                  {/* Balances the close button so the title stays centered. */}
                  <View style={styles.closeButton} />
                </View>

                <View style={styles.body}>
                  <FilePreviewBody
                    uri={uri}
                    displayName={title}
                    ext={ext}
                    sizeBytes={sizeBytes}
                  />
                </View>

                {children}
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
});
```

- [ ] **Step 2: Rewrite `FilePreviewModal` over the shell**

Replace the whole of `src/components/FilePreviewModal.tsx` with a thin wrapper. The caption state, `sendingRef`, and send logic stay here; the chrome comes from the shell. The footer (the `ChatTextInput`) becomes the shell's `children`.

```tsx
/**
 * FilePreviewModal — the WhatsApp-style review screen for a picked document,
 * before sending. Cancel sends nothing; the upload only starts on send.
 * The dark chrome (header, swipe-dismiss, body) lives in FilePreviewShell.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatTextInput } from './ChatTextInput';
import { FilePreviewShell } from './filePreview/FilePreviewShell';

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
  // onSend is async and the modal stays mounted across the round-trip, so state
  // updates too slowly to block a double-tap. A ref blocks it in the same tick.
  const sendingRef = useRef(false);

  useEffect(() => {
    if (visible) sendingRef.current = false;
  }, [visible]);

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

  return (
    <FilePreviewShell
      visible={visible}
      title={file.display_name}
      uri={file.uri}
      ext={file.ext}
      sizeBytes={file.size_bytes}
      onDismiss={handleCancel}
      dismissDisabled={isProcessing}
    >
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
    </FilePreviewShell>
  );
};

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    minHeight: 64,
  },
});
```

> `PickedFilePreview` is re-exported from the same path, so `import { FilePreviewModal, type PickedFilePreview } from '../components/FilePreviewModal'` in both screens keeps compiling untouched. Confirm with `grep -rn "PickedFilePreview" src/screens/` → two import sites, both still valid.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "FilePreviewModal|FilePreviewShell"`
Expected: no output. Then `npx tsc --noEmit 2>&1 | wc -l` → still 253.

- [ ] **Step 4: Confirm the send side is behaviorally unchanged**

Read the new `FilePreviewModal.tsx` against the old one (the diff will be large because the chrome moved). Verify: caption still trims to `undefined` when empty; `sendingRef` still guards a double-tap and resets on reopen; the close button is still disabled while `isProcessing`; the footer still passes the same `ChatTextInput` props. These are the send-side invariants a reviewer will check.

- [ ] **Step 5: Commit**

```bash
git add src/components/filePreview/FilePreviewShell.tsx src/components/FilePreviewModal.tsx
git commit -m "refactor(filePreview): extract FilePreviewShell so the viewer can reuse it"
```

---

### Task 2: `FileViewerModal`

**Files:**
- Create: `src/components/FileViewerModal.tsx`

**Interfaces:**
- Consumes: `FilePreviewShell` (Task 1); `Sharing` from `expo-sharing`.
- Produces:
  ```ts
  export const FileViewerModal: React.FC<{
    visible: boolean;
    uri: string;          // a local file:// path, already downloaded
    displayName: string;  // the pretty name, for the header
    ext: string;
    sizeBytes: number;
    mimeType: string;
    caption?: string;
    onClose: () => void;  // caller deletes the cache file here
  }>
  ```

The viewer is a shell plus a footer: the caption (when present) and a floating share button. It does **not** download and does **not** delete — the caller (`FileBubble`) owns the file's lifecycle. The viewer only reads the local uri it is handed and offers to share it.

- [ ] **Step 1: Write the component**

Create `src/components/FileViewerModal.tsx`:

```tsx
/**
 * FileViewerModal — opens a RECEIVED file in place (image / pdf / text) instead
 * of bouncing to the OS share sheet. A share button remains, as the escape hatch
 * to save to Files, open elsewhere, or forward.
 *
 * The file is already downloaded to the cache by the caller (FileBubble), which
 * also deletes it on close. This component only renders the local uri and shares
 * it; it owns no file lifecycle.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { FilePreviewShell } from './filePreview/FilePreviewShell';
import { friendlyErrorMessage } from '../utils/friendlyError';
import { ff, fs } from '../theme/fonts';

interface FileViewerModalProps {
  visible: boolean;
  uri: string;
  displayName: string;
  ext: string;
  sizeBytes: number;
  mimeType: string;
  caption?: string;
  onClose: () => void;
}

// Square-with-up-arrow — the platform "share" affordance.
const ShareIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 3v13M12 3l-4 4M12 3l4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  visible,
  uri,
  displayName,
  ext,
  sizeBytes,
  mimeType,
  caption,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  const handleShare = async () => {
    try {
      const Sharing = require('expo-sharing');
      if (Sharing && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { mimeType });
        return;
      }
      const { Linking } = require('react-native');
      await Linking.openURL(uri);
    } catch (e: any) {
      const { Alert } = require('react-native');
      Alert.alert('Could not share', friendlyErrorMessage(e, 'Failed to share the file.'));
    }
  };

  return (
    <FilePreviewShell
      visible={visible}
      title={displayName}
      uri={uri}
      ext={ext}
      sizeBytes={sizeBytes}
      onDismiss={onClose}
    >
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {!!caption?.trim() && (
          <Text style={styles.caption} numberOfLines={4}>
            {caption}
          </Text>
        )}
        <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.85}>
          <ShareIcon />
        </TouchableOpacity>
      </View>
    </FilePreviewShell>
  );
};

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  caption: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: fs(15),
    lineHeight: 20,
    color: 'rgba(255,255,255,0.9)',
    includeFontPadding: false,
  },
  shareButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#05BCD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

> `expo-sharing` is loaded with `require()` inside the handler, mirroring how `FileBubble.handleOpen` already loads it — the native module may be absent in an old build, and a lazy `require` degrades to `Linking` instead of crashing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i FileViewerModal`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/FileViewerModal.tsx
git commit -m "feat(chat): FileViewerModal — open a received file in place"
```

---

### Task 3: Branch `FileBubble.handleOpen`, fix the cache path, wire the viewer

**Files:**
- Modify: `src/components/messages/FileBubble.tsx`

**Interfaces:**
- Consumes: `previewKindForExt` from `src/services/messaging/fileAttachmentPolicy`; `FileViewerModal` (Task 2).
- Produces: nothing downstream.

Three changes in one file:
1. Renderable kinds (`image`/`pdf`/`text`) download to a **safe** cache path and open the viewer instead of the share sheet.
2. The download target is `${cacheDirectory}${message.id}.${ext}`, never the sender's `display_name`.
3. On close, delete the cached file.

The `'none'` path (zip, docx, …) is untouched: download, share sheet, as today.

- [ ] **Step 1: Add imports and viewer state**

At the top of `src/components/messages/FileBubble.tsx`, add to the existing imports:

```tsx
import { formatBytes, previewKindForExt } from '../../services/messaging/fileAttachmentPolicy';
import { FileViewerModal } from '../FileViewerModal';
```

(`formatBytes` is already imported from that module — extend the existing named import rather than adding a second line.)

Inside the component, next to `const [busy, setBusy] = useState(false);`:

```tsx
  const [viewer, setViewer] = useState<{ uri: string } | null>(null);
```

- [ ] **Step 2: Rewrite `handleOpen` to branch**

Replace the current `handleOpen` body. The download-to-cache logic is shared; only the last step (share sheet vs. viewer) differs by kind. The cache filename is now id-based.

```tsx
  const handleOpen = async () => {
    if (busy) return;
    if (!meta.storage_path) {
      Alert.alert('Not ready', 'This file is still uploading.');
      return;
    }
    setBusy(true);
    try {
      const url = await getFileDownloadUrl(message.conversation_id, meta.storage_path);
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.open(url, '_blank');
        return;
      }

      // Download to a cache path named by message id — NEVER the sender's
      // display_name, whose spaces/accents/# break a file:// uri silently on
      // Android (and the native pdf/text readers reject it).
      const LegacyFS = require('expo-file-system/legacy');
      const target = `${LegacyFS.cacheDirectory}${message.id}.${meta.ext}`;
      const { uri: localUri } = await LegacyFS.downloadAsync(url, target);

      // Renderable in-app? Open the viewer. Otherwise keep today's share-sheet path.
      if (previewKindForExt(meta.ext) !== 'none') {
        setViewer({ uri: localUri });
        return;
      }

      let shared = false;
      try {
        const Sharing = require('expo-sharing');
        if (Sharing && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(localUri, { mimeType: meta.mime_type, UTI: undefined });
          shared = true;
        }
      } catch { /* expo-sharing missing/unavailable — fall through to Linking */ }
      if (!shared) {
        const { Linking } = require('react-native');
        await Linking.openURL(url);
      }
    } catch (e: any) {
      Alert.alert('Could not open file', friendlyErrorMessage(e, 'Failed to open the file.'));
    } finally {
      setBusy(false);
    }
  };

  const closeViewer = () => {
    const open = viewer;
    setViewer(null);
    // Delete the cached copy of the received file. Best-effort: a failed delete
    // is not worth surfacing (the OS clears cacheDirectory under pressure anyway).
    if (open) {
      try {
        const { File } = require('expo-file-system');
        new File(open.uri).delete();
      } catch { /* already gone, or module unavailable — ignore */ }
    }
  };
```

- [ ] **Step 3: Mount the viewer in the render tree**

`FileBubble` currently returns `<View>…</View>` wrapping the row and the caption. Add the modal as a sibling of the row, still inside that outer `<View>`, so it mounts only when a file is open:

```tsx
      {viewer && (
        <FileViewerModal
          visible={true}
          uri={viewer.uri}
          displayName={meta.display_name}
          ext={meta.ext}
          sizeBytes={meta.size_bytes}
          mimeType={meta.mime_type}
          caption={message.body ?? undefined}
          onClose={closeViewer}
        />
      )}
```

Find the outer `</View>` that closes the component (after the caption `Text` added in the send-side work) and place this just before it.

- [ ] **Step 4: Rewrite the security comment in the file header**

The header still claims the file is never rendered in-app. Replace that sentence. The new header must state what is true:

```tsx
/**
 * FileBubble — renders a chat file attachment (type='file'). Shows a file-type
 * icon, the sanitized display name, and a human-readable size.
 *
 * Tapping downloads the file to the cache (named by message id, never the
 * sender's display_name — unescaped chars break a file:// uri on Android) and
 * then, for an image / pdf / text file, opens it in-app via FileViewerModal.
 * Everything else is handed to the OS share sheet as before.
 *
 * Security note: rendering a RECEIVED file in-app is a deliberate reversal of
 * the old "never render" posture. Images already decode in-process via
 * expo-image for type='image' messages; text has no parser; a PDF is the only
 * new attack surface, and it runs through the SYSTEM parsers (PDFKit / PDFium)
 * — the same ones the OS share sheet would use — which are patched by OS
 * updates, not ours. A render failure lands on FileCard, never a crash.
 */
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i FileBubble`
Expected: no output. Then `npx tsc --noEmit 2>&1 | wc -l` → still 253.

- [ ] **Step 6: Confirm the branch points and the `'none'` path**

Run: `grep -n "previewKindForExt\|shareAsync\|setViewer\|new File(" src/components/messages/FileBubble.tsx`
Expected: `previewKindForExt` gates the viewer; `shareAsync` remains reachable only in the `'none'` branch; `setViewer` fires only for renderable kinds; `new File(...).delete()` is in `closeViewer`.

- [ ] **Step 7: Commit**

```bash
git add src/components/messages/FileBubble.tsx
git commit -m "feat(chat): open received images, PDFs, and text in-app"
```

---

## Verification (whole feature)

- [ ] `npx tsc --noEmit 2>&1 | wc -l` → 253 (baseline, no new errors).
- [ ] `npx jest src/services/messaging` → still green (the shared `previewKindForExt` tests).
- [ ] `grep -rn "PickedFilePreview" src/screens/` → two import sites, both still resolve (the type is still exported from `FilePreviewModal.tsx`).
- [ ] `grep -rn "is NEVER rendered" src/components/messages/FileBubble.tsx` → **no match** (the stale posture comment is gone).

**On-device, by Ohad** (no simulator, no Maestro):

1. Receive a PDF → tap → opens in-app, page one renders.
2. Receive a `.zip` → tap → OS share sheet, exactly as before.
3. Receive a `.csv` under 256 KB → raw text; a large one → the file card.
4. Receive an image sent as a document → renders.
5. Tap the share button in the viewer → OS sheet with the right file.
6. Receive a file whose name has a space or accent → renders on Android (the id-based cache path).
7. Close the viewer, reopen the same file → still works (proves the delete didn't wedge anything).
8. In Expo Go, a received PDF → file card, no crash.
9. Send-side: pick a document → the review modal still looks and behaves exactly as before (the shell extraction changed nothing user-visible).

## Follow-ups (not in this plan)

- The viewer and the send-preview both mount their own `FilePreviewShell`; if a third caller appears, consider a single owner. Two is fine.
- Cache cleanup is per-close. A background sweep of stale `${id}.${ext}` files on app launch would catch files whose viewer was killed by an OS process-kill mid-view. Not worth it yet.
