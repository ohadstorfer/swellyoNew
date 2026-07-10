# Multi-photo/video Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp-style multi-select of photos/videos in the chat gallery picker, reviewed in one fullscreen screen with per-item captions, sent as a burst of individual messages.

**Architecture:** A new `MediaReviewModal` component handles batches of ≥2 picked assets (pager + filmstrip + per-item captions). The existing single-item preview modals and the upload-first send pipeline are untouched; the host screens' `handleImagePicker` routes 1 asset to the old flow and ≥2 to the new modal, whose `onSend` loops the existing `handleImageSend`/`handleVideoSend` with `(caption, overrideUri)`.

**Tech Stack:** React Native + Expo 54, `expo-image-picker` (multi-select), `expo-video` (active-page playback), `expo-video-thumbnails` (filmstrip/poster thumbs), `react-native-svg` icons, `ff()` fonts.

**Spec:** `docs/superpowers/specs/2026-07-10-multi-media-send-design.md`

## Global Constraints

- Native only — web branch of `handleImagePicker` is untouched.
- `selectionLimit: 30`, `orderedSelection: true`, mixed photos+videos allowed.
- Per-item captions; each item becomes its own message via the EXISTING `handleImageSend(caption?, overrideImageUri?)` / `handleVideoSend(caption?, overrideVideoUri?)`.
- Single-asset picks must route through today's exact flow (zero regression).
- Text styles use `ff()` from `src/theme/fonts` — never bare fontFamily+fontWeight.
- Verification per project convention: `npx tsc --noEmit` + Ohad tests on-device (no Jest for screens — overrides the skill's TDD default per CLAUDE.md/memory).
- Known accepted limitation (documented in spec): in mixed batches, a video's bubble appears only after its poster is generated, so it can land after a later-picked photo. Ordering is by `created_at` for both sides; not a bug.

---

### Task 1: `MediaReviewModal` component

**Files:**
- Create: `src/components/MediaReviewModal.tsx`

**Interfaces:**
- Produces (consumed by Tasks 2–3):

```ts
export interface MediaReviewItem {
  uri: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  duration?: number;   // seconds
  mimeType?: string;
  fileSize?: number;
}

interface MediaReviewModalProps {
  visible: boolean;
  items: MediaReviewItem[];
  onSend: (items: Array<MediaReviewItem & { caption?: string }>) => void;
  onCancel: () => void;
  /** Host's existing cropImage helper (photos only). */
  onCropImage?: (uri: string, width: number, height: number) => Promise<{ uri: string; width: number; height: number } | null>;
  primaryColor?: string;
}
```

- [ ] **Step 1: Write the component** — fullscreen `<Modal>` (mirror `ImagePreviewModal`'s shell props: `animationType="fade"`, `statusBarTranslucent` on Android, `onRequestClose → onCancel`). Internals:
  - Local `items` state copied from props on `visible` flip (deletes/crops are local until Send); `captions: Record<uri, string>`; `activeIndex`.
  - **Pager:** horizontal `FlatList`, `pagingEnabled`, `keyExtractor = uri`, `getItemLayout` from `useWindowDimensions().width`, `onMomentumScrollEnd` → `setActiveIndex(round(x / width))`. Photo page = `<Image resizeMode="contain">` (like `ImagePreviewContent`). Video page = dedicated `VideoPage` child mounted ONLY when `index === activeIndex` (one live `useVideoPlayer` at a time, starts paused, tap toggles, ▶ overlay when paused — copy the `playingChange` listener pattern from `VideoPreviewContent.tsx:124-152`); inactive video pages render the generated poster thumb + ▶.
  - **Video thumbs:** `useEffect` walks video items and fills `thumbs: Record<uri, string>` via `expo-video-thumbnails` `getThumbnailAsync(uri, { time: 0 })` (guarded try/catch → fallback dark tile with ▶).
  - **Bottom chrome** (KAV `behavior="padding"` iOS like `ImagePreviewContent.tsx:281`, floats over media): dark pill `TextInput` bound to `captions[items[activeIndex].uri]` (placeholder "Add a caption...", maxLength 500, white text on `#2B2B2B`, NOT ChatTextInput — its built-in send button would duplicate the FAB); below it the **filmstrip** — horizontal `ScrollView` of 52px thumbs in order, active = 2px `primaryColor` border, tap → `scrollToIndex`; video thumbs get a small ▶ glyph; right of the filmstrip a circular **send FAB** (`primaryColor`, white send arrow SVG `M2.01 21L23 12 2.01 3 2 10l15 2-15 2z`) with a count badge.
  - **Top chrome:** X top-left → `onCancel`; top-right **trash** (removes current item: drop from `items`, clamp `activeIndex`, last item removed → `onCancel()`) and **crop** (photos only, shown only when `onCropImage` provided): `await onCropImage(uri, width ?? 0, height ?? 0)`; on result swap the item's uri/width/height and carry the caption to the new uri key. Icon buttons mirror `ImagePreviewContent`'s 36px circles at `insets.top + 12`.
  - **Send:** `sendingRef` re-entrancy guard (same rationale as `ImagePreviewContent.tsx:127`); builds `items.map(it => ({ ...it, caption: captions[it.uri]?.trim() || undefined }))` and calls `onSend`.
  - All labels/badges use `ff('Inter', ...)` sizes via existing conventions.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/MediaReviewModal.tsx
git commit -m "feat(chat): MediaReviewModal — WhatsApp-style multi-media review screen"
```

### Task 2: Wire DirectMessageScreen

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx` (picker ~line 2606; modals block ~line 5437)

**Interfaces:**
- Consumes: `MediaReviewModal`, `MediaReviewItem` from Task 1; existing `handleImageSend(caption?, overrideImageUri?)` (line 2836), `handleVideoSend(caption?, overrideVideoUri?)` (line 3146), `cropImage(uri, width, height)` (line 2729), `composerPrimaryColor`.

- [ ] **Step 1: Add state + import**

```ts
import { MediaReviewModal, MediaReviewItem } from '../components/MediaReviewModal';
// …
const [multiReviewItems, setMultiReviewItems] = useState<MediaReviewItem[] | null>(null);
```

- [ ] **Step 2: Picker options + routing** — in the native branch of `handleImagePicker`:

```ts
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ['images', 'videos'],
  quality: 1,
  allowsMultipleSelection: true,
  selectionLimit: 30,
  orderedSelection: true,
});

if (!result.canceled && (result.assets?.length ?? 0) > 1) {
  const items: MediaReviewItem[] = result.assets.map((a: any) => ({
    uri: a.uri,
    isVideo: a.type === 'video' || a.uri.endsWith('.mp4') || a.uri.endsWith('.mov'),
    width: a.width > 0 ? a.width : undefined,
    height: a.height > 0 ? a.height : undefined,
    duration: typeof a.duration === 'number' ? a.duration / 1000 : undefined, // picker reports ms
    mimeType: a.mimeType ?? undefined,
    fileSize: a.fileSize ?? undefined,
  }));
  setMultiReviewItems(items);
  return;
}
// …existing single-asset routing unchanged (asset = result.assets?.[0]) …
```

- [ ] **Step 3: Send loop + render** — next to the other preview modals (~line 5437):

```tsx
{multiReviewItems && (
  <MediaReviewModal
    visible
    items={multiReviewItems}
    onSend={(reviewed) => {
      setMultiReviewItems(null);
      for (const item of reviewed) {
        if (item.isVideo) void handleVideoSend(item.caption, item.uri);
        else void handleImageSend(item.caption, item.uri);
      }
    }}
    onCancel={() => setMultiReviewItems(null)}
    onCropImage={Platform.OS !== 'web' && getImageCropPicker() ? cropImage : undefined}
    primaryColor={composerPrimaryColor}
  />
)}
```

- [ ] **Step 4: Type-check** — `npx tsc --noEmit`, expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/screens/DirectMessageScreen.tsx
git commit -m "feat(chat): multi-photo/video select + send in DMs"
```

### Task 3: Wire DirectGroupChat

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx` (picker ~line 2409; modals block near its ImagePreviewModal)

Same three edits as Task 2, using the group screen's own `handleImageSend` (line 2639), `handleVideoSend` (line 2946), `cropImage` (line 2532), `composerPrimaryColor` (`#05BCD3`). Code identical to Task 2's snippets.

- [ ] **Step 1: state + import**
- [ ] **Step 2: picker options + >1 routing**
- [ ] **Step 3: send loop + render MediaReviewModal**
- [ ] **Step 4: `npx tsc --noEmit` clean**
- [ ] **Step 5: Commit**

```bash
git add src/screens/DirectGroupChat.tsx
git commit -m "feat(chat): multi-photo/video select + send in group chats"
```

### Task 4: On-device verification (Ohad)

- [ ] Mixed batch (photos+videos) in a DM and in a group chat: order, per-item captions on the right bubbles, upload progress/retry per message.
- [ ] Trash current item; trash down to last item closes the modal.
- [ ] Crop a photo mid-batch; caption survives the crop.
- [ ] Single-pick still routes to the old ImagePreviewModal/VideoPreviewModal.
- [ ] Expo Go smoke (all modules are Expo SDK — no native rebuild needed; OTA-able).
