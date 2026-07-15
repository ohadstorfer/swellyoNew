# Album "reply to whole batch" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long-pressing any tile in a chat photo/video album selects the whole batch, and Reply quotes it as "N photos" / "N videos" / "N photos, M videos" (WhatsApp-style), in both direct and group chats.

**Architecture:** Albums are a render-time grouping (`mediaAlbums.ts`) — no DB change. Add a pure label helper, a "selected" scrim on the album bubble, and album-aware reply state in the two chat screens. The reply anchors to the tapped tile's `message_id`; scroll-to-original already resolves any tile → its album row.

**Tech Stack:** React Native 0.81, Expo 54, TypeScript, jest-expo (pure-helper unit test only; UI verified by tsc + on-device — Ohad tests on device, no simulator/Maestro).

## Global Constraints

- Do NOT commit — Ohad reviews and commits manually. Skip every `git commit` step; stage nothing.
- Verify each task with `npx tsc --noEmit` (no new errors) and, for Task 1, the jest test.
- Fonts: use existing `ff()` if adding text (none needed here).
- Copy strings exactly: `"1 photo"`, `"N photos"`, `"1 video"`, `"N videos"`, mixed `"N photos, M videos"`.
- Mirror every screen change in BOTH `DirectMessageScreen.tsx` and `DirectGroupChat.tsx`. `ChatScreen.tsx` (Swelly AI) is out of scope.

---

### Task 1: `describeAlbum` label helper

**Files:**
- Modify: `src/utils/mediaAlbums.ts` (add exported function at end)
- Test: `src/utils/__tests__/mediaAlbums.test.ts` (create)

**Interfaces:**
- Produces: `describeAlbum(items: Message[]): string` — used by both chat screens in Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/mediaAlbums.test.ts`:

```ts
import { describeAlbum } from '../mediaAlbums';
import type { Message } from '../../services/messaging/messagingService';

const img = (): Message => ({ id: 'i', conversation_id: 'c', sender_id: 's', type: 'image' } as Message);
const vid = (): Message => ({ id: 'v', conversation_id: 'c', sender_id: 's', type: 'video' } as Message);
// video detected via metadata even when type is missing
const vidMeta = (): Message =>
  ({ id: 'v2', conversation_id: 'c', sender_id: 's', video_metadata: { thumbnail_url: 'x' } } as unknown as Message);

describe('describeAlbum', () => {
  it('counts all photos', () => {
    expect(describeAlbum([img(), img(), img(), img()])).toBe('4 photos');
  });
  it('counts all videos', () => {
    expect(describeAlbum([vid(), vid(), vid()])).toBe('3 videos');
  });
  it('detects videos by metadata', () => {
    expect(describeAlbum([vidMeta(), vidMeta()])).toBe('2 videos');
  });
  it('formats mixed', () => {
    expect(describeAlbum([img(), img(), img(), img(), vid(), vid()])).toBe('4 photos, 2 videos');
  });
  it('is singular-aware in a mixed set', () => {
    expect(describeAlbum([img(), vid()])).toBe('1 photo, 1 video');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utils/__tests__/mediaAlbums.test.ts`
Expected: FAIL — `describeAlbum is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/utils/mediaAlbums.ts`:

```ts
/** Whole-album reply label: "N photos" / "N videos" / "N photos, M videos". */
export function describeAlbum(items: Message[]): string {
  const isVideo = (m: Message): boolean => m.type === 'video' || !!m.video_metadata;
  const videos = items.filter(isVideo).length;
  const photos = items.length - videos;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (photos > 0 && videos > 0) {
    return `${plural(photos, 'photo', 'photos')}, ${plural(videos, 'video', 'videos')}`;
  }
  if (videos > 0) return plural(videos, 'video', 'videos');
  return plural(photos, 'photo', 'photos');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utils/__tests__/mediaAlbums.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Do NOT commit.)

---

### Task 2: Selected scrim on `MediaAlbumBubble`

**Files:**
- Modify: `src/components/MediaAlbumBubble.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MediaAlbumBubble` gains optional prop `isSelected?: boolean`; consumed by both screens in Task 3.

- [ ] **Step 1: Add the prop to the interface**

In `MediaAlbumBubbleProps` (after `receipt?`), add:

```ts
  /** Whole-batch selected state (long-press). Renders a dim scrim over the grid. */
  isSelected?: boolean;
```

- [ ] **Step 2: Destructure and render the scrim**

Change the component signature to include `isSelected`:

```ts
export const MediaAlbumBubble: React.FC<MediaAlbumBubbleProps> = ({
  items,
  onPressItem,
  onLongPressItem,
  onRetryItem,
  onPressMore,
  timeLabel,
  receipt,
  isSelected,
}) => {
```

Inside the outer `<View style={styles.bubble}>`, after the `timestampPill` view, add:

```tsx
      {isSelected && <View style={styles.selectedScrim} pointerEvents="none" />}
```

- [ ] **Step 3: Add the style**

In `StyleSheet.create`, add to the `styles` object:

```ts
  selectedScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Do NOT commit.)

---

### Task 3: Album-aware reply in `DirectMessageScreen.tsx`

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx`
- Modify: `src/components/ReplyPreviewBanner.tsx` (add label override prop)

**Interfaces:**
- Consumes: `describeAlbum` (Task 1), `MediaAlbumBubble.isSelected` (Task 2).
- Produces: `ReplyPreviewBanner` gains optional `previewOverride?: string` (reused by Task 4).

- [ ] **Step 1: Add `previewOverride` to `ReplyPreviewBanner`**

In `ReplyPreviewBannerProps` add `previewOverride?: string;`. Destructure it. Then make the label prefer it — change the preview computation block so it starts:

```ts
  let preview: string;
  if (previewOverride) {
    preview = previewOverride;
  } else if (message.type === 'image') {
    preview = 'Photo';
  } else if (message.type === 'video') {
```

(leave the rest of the `else if` chain unchanged).

- [ ] **Step 2: Add album reply/selection state**

In `DirectMessageScreen.tsx`, next to the existing `const [replyingTo, setReplyingTo] = useState<Message | null>(null);` add:

```ts
  // Whole-album reply: when set, the reply quote reads "N photos" instead of the
  // single-tile "Photo" label. Cleared alongside replyingTo.
  const [replyingToAlbumLabel, setReplyingToAlbumLabel] = useState<string | null>(null);
  // Album long-press selection (for the whole-batch scrim + album-aware Reply).
  const [selectedAlbumItems, setSelectedAlbumItems] = useState<Message[] | null>(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
```

Add the import for `describeAlbum` — update the existing mediaAlbums import line to include it:

```ts
import { buildDisplayRows, findRowIndexByMessageId, describeAlbum, type ChatDisplayRow, type AlbumRow } from '../utils/mediaAlbums';
```

(If `AlbumRow`/`ChatDisplayRow` aren't already in that import on this screen, keep whatever is already imported and just add `describeAlbum`.)

- [ ] **Step 3: Add the album long-press handler**

Immediately after `handleMessageLongPress` (ends near line 3762), add:

```ts
  // Long-press a tile inside an album → select the WHOLE batch. Anchor the menu
  // to the tapped tile (Report target + reply/scroll anchor), but remember the
  // album so Reply quotes "N photos".
  const handleAlbumLongPress = (album: AlbumRow, tappedMessage: Message, event: any) => {
    setSelectedAlbumItems(album.items);
    setSelectedAlbumKey(album.key);
    handleMessageLongPress(tappedMessage, event, false);
  };
```

- [ ] **Step 4: Wire the album bubble**

At the `<MediaAlbumBubble ... />` (line ~4102), change `onLongPressItem` and add `isSelected`:

```tsx
              onLongPressItem={(m, e) => handleAlbumLongPress(album, m, e)}
```

and add, alongside the other props:

```tsx
              isSelected={menuVisible && selectedAlbumKey === album.key}
```

- [ ] **Step 5: Clear album selection on menu close**

In the `<MessageActionsMenu onClose={...}>` handler (line ~5803) add the two clears:

```ts
        onClose={() => {
          setMenuVisible(false);
          setSelectedMessage(null);
          setBubbleRect(null);
          setSelectedAlbumItems(null);
          setSelectedAlbumKey(null);
        }}
```

- [ ] **Step 6: Album-aware Reply**

In `onReply` (line ~5839):

```ts
        onReply={() => {
          if (selectedMessage) {
            setReplyingTo(selectedMessage);
            setReplyingToAlbumLabel(selectedAlbumItems ? describeAlbum(selectedAlbumItems) : null);
            // Focus the input so the keyboard comes up right away.
            chatInputRef.current?.focus?.();
          }
        }}
```

- [ ] **Step 7: Use the label in the send snapshot**

In `sendMessage`, the snapshot `body` (lines ~2039-2046) — wrap the existing expression so the album label wins:

```ts
          body: replyingToAlbumLabel
            ? replyingToAlbumLabel
            : replyingTo.type === 'image'
              ? 'Photo'
              : replyingTo.type === 'video'
                ? 'Video'
                : replyingTo.type === 'audio'
                  ? 'Voice message'
                  : (replyingTo.body ?? ''),
```

- [ ] **Step 8: Clear the album label whenever the reply clears**

Find every `setReplyingTo(null)` in this file (the send path near line 2049 and the banner `onCancel` near line 5359). After each, add `setReplyingToAlbumLabel(null);`. For the banner also pass the override (next step).

- [ ] **Step 9: Feed the label to the banner**

At `<ReplyPreviewBanner ...>` (line ~5355):

```tsx
              <ReplyPreviewBanner
                message={replyingTo}
                currentUserId={currentUserId}
                otherUserName={otherUserName}
                previewOverride={replyingToAlbumLabel ?? undefined}
                onCancel={() => { setReplyingTo(null); setReplyingToAlbumLabel(null); }}
              />
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Do NOT commit.)

---

### Task 4: Mirror in `DirectGroupChat.tsx`

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx`

**Interfaces:**
- Consumes: `describeAlbum` (Task 1), `MediaAlbumBubble.isSelected` (Task 2), `ReplyPreviewBanner.previewOverride` (Task 3).

This screen has the SAME structure but TWO snapshot-build sites (text send ~line 1828 and media send ~line 3146). Apply the album label to both.

- [ ] **Step 1: Add state + import**

`describeAlbum` is already exported and `AlbumRow` is already imported here (line 75). Just add `describeAlbum` to that import line. Next to `const [replyingTo, setReplyingTo] = useState<Message | null>(null);` (line ~495) add:

```ts
  const [replyingToAlbumLabel, setReplyingToAlbumLabel] = useState<string | null>(null);
  const [selectedAlbumItems, setSelectedAlbumItems] = useState<Message[] | null>(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
```

- [ ] **Step 2: Add the album long-press handler**

After `handleMessageLongPress` (ends ~line 3670), add the same handler as Task 3 Step 3 (identical code — repeated here so you don't need to cross-reference):

```ts
  const handleAlbumLongPress = (album: AlbumRow, tappedMessage: Message, event: any) => {
    setSelectedAlbumItems(album.items);
    setSelectedAlbumKey(album.key);
    handleMessageLongPress(tappedMessage, event, false);
  };
```

- [ ] **Step 3: Wire the album bubble**

At `<MediaAlbumBubble>` (line ~3982), change line 3985:

```tsx
              onLongPressItem={(m, e) => handleAlbumLongPress(album, m, e)}
```

and add:

```tsx
              isSelected={menuVisible && selectedAlbumKey === album.key}
```

- [ ] **Step 4: Clear selection on menu close**

In this screen's `<MessageActionsMenu onClose={...}>`, add:

```ts
          setSelectedAlbumItems(null);
          setSelectedAlbumKey(null);
```

- [ ] **Step 5: Album-aware Reply**

In this screen's menu `onReply`, after `setReplyingTo(selectedMessage)` add:

```ts
            setReplyingToAlbumLabel(selectedAlbumItems ? describeAlbum(selectedAlbumItems) : null);
```

- [ ] **Step 6: Apply label to BOTH snapshot sites**

At line ~1844 (text send) and line ~3162 (media send), wrap the `body` expression the same way:

```ts
            body: replyingToAlbumLabel
              ? replyingToAlbumLabel
              : replyingTo.type === 'image'
                ? 'Photo'
                : replyingTo.type === 'video'
                  ? 'Video'
                  : replyingTo.type === 'audio'
                    ? 'Voice message'
                    : (replyingTo.body ?? ''),
```

(Match each site's existing indentation and its trailing `?? ''` vs `.body` shape — line 1850 uses `?? ''`, line 3168 uses `replyingTo.body`. Keep each site's original fallback.)

- [ ] **Step 7: Clear the album label everywhere the reply clears**

After each `setReplyingTo(null)` (send paths ~line 1853 and ~3175, and the banner cancel), add `setReplyingToAlbumLabel(null);`.

- [ ] **Step 8: Feed the label to the banner**

At `<ReplyPreviewBanner>` (line ~5266) add `previewOverride={replyingToAlbumLabel ?? undefined}` and update its `onCancel` to also clear the label.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Do NOT commit.)

---

## Manual verification (Ohad, on device)

- DM + group: long-press any tile of a 4+ media album → whole bubble dims (selected), menu shows Reply + Report.
- Reply → composer banner reads "N photos" / "N videos" / "N photos, M videos".
- Send → the sent bubble's quote shows the same count + media icon.
- Tap the quote → scrolls/highlights the original album.
- Report → reports the single tapped tile (unchanged).
- Single (non-album) media bubbles: reply still shows "Photo"/"Video" as before.
- Reply to an album, then cancel the banner → next reply to a single photo shows "Photo" (label cleared, no leak).

## Self-review notes

- Spec coverage: helper (T1), scrim (T2), DM wiring (T3), group wiring incl. both snapshot sites (T4) — all spec sections covered.
- Type consistency: `describeAlbum(items: Message[]): string`, `isSelected?: boolean`, `previewOverride?: string`, `replyingToAlbumLabel: string | null` used identically across tasks.
- Label-leak guard: every `setReplyingTo(null)` is paired with `setReplyingToAlbumLabel(null)` (T3 S8, T4 S7).
