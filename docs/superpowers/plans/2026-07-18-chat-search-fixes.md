# In-Chat Search Reliability & UX Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-chat message search navigation (▲/▼ between hits) land reliably, behave correctly on Android back, stop re-jumping while typing, dismiss the keyboard on navigation, fail silently instead of alerting, and show "50+" when the hit cap is reached.

**Architecture:** All changes are client-side React Native, confined to the two chat screens (whose search code is byte-identical) and the shared `ChatSearchHeader`. The jump path (`handleReplyPreviewPress`) gains a `silent` option; the FlatList's `onScrollToIndexFailed` gains an offset-approximation step; search-session state gains one ref (`lastSearchJumpRef`).

**Tech Stack:** React Native 0.81 / Expo 54, TypeScript. Spec: `docs/superpowers/specs/2026-07-18-chat-search-fixes-design.md`.

## Global Constraints

- **No commits.** Ohad reviews and commits manually — leave all changes staged-nothing, working tree only.
- **No jest tests.** Project convention: verify with `npx tsc --noEmit` + on-device testing by Ohad (no simulator/Maestro).
- **JS-only / OTA-able.** Do not touch native code, `app.json`, or Edge Functions.
- **The two screens must stay byte-identical in the search region** — apply every screen edit to BOTH files, with one known divergence: `DirectMessageScreen.tsx` uses a straight apostrophe in `'We could not find the original message.'`; `DirectGroupChat.tsx` uses a curly one: `'We couldn’t find the original message.'`. Preserve each file's existing string exactly.
- Line numbers below are approximate anchors (files are ~6000 lines and shift); match on the quoted code, not the number.

---

### Task 1: `ChatSearchHeader` — `capped` prop ("50+" counter)

**Files:**
- Modify: `src/components/chat/ChatSearchHeader.tsx`

**Interfaces:**
- Produces: `ChatSearchHeaderProps` gains `capped?: boolean` (default `false`). When true and there are hits, the counter renders `` `${currentIndex + 1} of ${total}+` ``. Tasks 2–3 pass this prop from the screens.

- [ ] **Step 1: Add the prop to the interface**

In the `ChatSearchHeaderProps` interface, after the `jumping?: boolean;` line:

```tsx
  /** A hit jump is fetching an off-window message — show a spinner in the counter. */
  jumping?: boolean;
  /** Hit list reached the server cap — more matches exist beyond `total`. */
  capped?: boolean;
```

- [ ] **Step 2: Destructure it in the component**

```tsx
  loading,
  jumping = false,
  capped = false,
}) => {
```

- [ ] **Step 3: Render "+" in the counter**

Replace the counter `<Text>`:

```tsx
        <Text style={styles.counter}>
          {hasHits ? `${currentIndex + 1} of ${total}` : query.trim().length >= 2 && !loading ? '0 of 0' : ''}
        </Text>
```

with:

```tsx
        <Text style={styles.counter}>
          {hasHits
            ? `${currentIndex + 1} of ${total}${capped ? '+' : ''}`
            : query.trim().length >= 2 && !loading ? '0 of 0' : ''}
        </Text>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep ChatSearchHeader`
Expected: no output (clean).

---

### Task 2: `DirectMessageScreen.tsx` — all screen-side fixes

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx` (search state ~line 4080, jump handler ~line 3940, FlatList props ~line 5849, header render ~line 5586, imports ~line 1–20)

**Interfaces:**
- Consumes: `ChatSearchHeader`'s `capped` prop from Task 1.
- Produces: `handleReplyPreviewPress(id: string, opts?: { animated?: boolean; span?: number; silent?: boolean })` — Task 3 mirrors this exact signature in the group screen.

- [ ] **Step 1 (Fix 2): Add `BackHandler` to the react-native import**

The file already imports `Keyboard` from `react-native`. Extend that same import block:

```tsx
  Linking,
  Keyboard,
  BackHandler,
} from 'react-native';
```

- [ ] **Step 2 (Fix 5): Add `silent` to the jump handler's opts**

In `handleReplyPreviewPress` (~line 3940). Three edits:

(a) The ref type:

```tsx
  const handleReplyPreviewPressRef =
    useRef<((id: string, opts?: { animated?: boolean; span?: number }) => void) | undefined>(undefined);
```

becomes:

```tsx
  const handleReplyPreviewPressRef =
    useRef<((id: string, opts?: { animated?: boolean; span?: number; silent?: boolean }) => void) | undefined>(undefined);
```

(b) The signature + option read:

```tsx
  const handleReplyPreviewPress = useCallback(async (
    parentMessageId: string,
    opts?: { animated?: boolean; span?: number },
  ) => {
    const animated = opts?.animated ?? true;
    const span = opts?.span ?? 20;
```

becomes:

```tsx
  const handleReplyPreviewPress = useCallback(async (
    parentMessageId: string,
    opts?: { animated?: boolean; span?: number; silent?: boolean },
  ) => {
    const animated = opts?.animated ?? true;
    const span = opts?.span ?? 20;
    // Search navigation passes silent: a modal alert mid-▲/▼ browsing is
    // jarring; the jump just doesn't happen. Reply-preview taps keep the alert.
    const silent = opts?.silent ?? false;
```

(c) Both failure alerts (empty result + catch) gain the guard. This file uses a straight apostrophe:

```tsx
        if (result.messages.length === 0) {
          if (!silent) Alert.alert('Message not available', 'We could not find the original message.');
          pendingJumpTargetRef.current = null;
          return;
        }
```

```tsx
      } catch {
        if (!silent) Alert.alert('Message not available', 'We could not find the original message.');
        pendingJumpTargetRef.current = null;
        return;
      } finally {
```

- [ ] **Step 3 (Fix 3): Add `lastSearchJumpRef` and gate the auto-jump**

In the search state block (~line 4080), after `const chatSearchReqRef = useRef(0);`:

```tsx
  const chatSearchReqRef = useRef(0);
  // Last message the search navigated to (auto-jump or ▲/▼). Gates the
  // auto-jump so retyping doesn't re-scroll/re-flash the bubble we're already
  // on; reset on query-clear/close so a fresh search always shows its top hit.
  const lastSearchJumpRef = useRef<string | null>(null);
```

In the debounced search effect, the `< 2 chars` early-return branch:

```tsx
    if (trimmed.length < 2) {
      setChatSearchHits([]);
      setChatSearchIndex(0);
      setChatSearchLoading(false);
      return;
    }
```

becomes:

```tsx
    if (trimmed.length < 2) {
      setChatSearchHits([]);
      setChatSearchIndex(0);
      setChatSearchLoading(false);
      lastSearchJumpRef.current = null;
      return;
    }
```

The success branch:

```tsx
        if (chatSearchReqRef.current !== id) return;
        setChatSearchHits(hits);
        setChatSearchIndex(0);
        if (hits.length > 0) handleReplyPreviewPress(hits[0].messageId, { animated: false, span: 40 });
```

becomes:

```tsx
        if (chatSearchReqRef.current !== id) return;
        setChatSearchHits(hits);
        setChatSearchIndex(0);
        const top = hits[0]?.messageId ?? null;
        // Jump only when the top hit is a message we're not already parked on.
        if (top && top !== lastSearchJumpRef.current) {
          lastSearchJumpRef.current = top;
          handleReplyPreviewPress(top, { animated: false, span: 40, silent: true });
        }
```

- [ ] **Step 4 (Fixes 3+4+5): Update `goToChatSearchHit`**

```tsx
  const goToChatSearchHit = useCallback((index: number) => {
    const hit = chatSearchHits[index];
    if (!hit) return;
    setChatSearchIndex(index);
    handleReplyPreviewPress(hit.messageId, { animated: false, span: 40 });
  }, [chatSearchHits, handleReplyPreviewPress]);
```

becomes:

```tsx
  const goToChatSearchHit = useCallback((index: number) => {
    const hit = chatSearchHits[index];
    if (!hit) return;
    Keyboard.dismiss(); // arrows mean "show me the messages" — free the screen
    setChatSearchIndex(index);
    lastSearchJumpRef.current = hit.messageId;
    handleReplyPreviewPress(hit.messageId, { animated: false, span: 40, silent: true });
  }, [chatSearchHits, handleReplyPreviewPress]);
```

- [ ] **Step 5 (Fixes 2+3): Reset the ref in `closeChatSearch`, add the BackHandler effect**

```tsx
  const closeChatSearch = useCallback(() => {
    setChatSearchActive(false);
    setChatSearchQuery('');
    setChatSearchHits([]);
    setChatSearchIndex(0);
    chatSearchReqRef.current++;
  }, []);
```

becomes:

```tsx
  const closeChatSearch = useCallback(() => {
    setChatSearchActive(false);
    setChatSearchQuery('');
    setChatSearchHits([]);
    setChatSearchIndex(0);
    chatSearchReqRef.current++;
    lastSearchJumpRef.current = null;
  }, []);

  // Android hardware back closes the search bar instead of leaving the chat
  // (mirrors the global MessageSearchOverlay's handler).
  useEffect(() => {
    if (!chatSearchActive) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeChatSearch();
      return true;
    });
    return () => sub.remove();
  }, [chatSearchActive, closeChatSearch]);
```

- [ ] **Step 6 (Fix 1): Rewrite `onScrollToIndexFailed`**

On the FlatList (~line 5849):

```tsx
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                // The window can be replaced by a re-anchor fetch (search ▲/▼,
                // reply jump) between the failed scroll and this retry, leaving
                // info.index out of range. Guard it — an out-of-range
                // scrollToIndex throws and crashes the screen.
                if (info.index < displayRowsRef.current.length) {
                  flatListRef.current?.scrollToIndex({
                    index: info.index,
                    viewPosition: 0.5,
                    animated: true,
                  });
                }
              }, 100);
            }}
```

becomes:

```tsx
            onScrollToIndexFailed={(info) => {
              // Target row isn't measured yet (jump beyond the render window,
              // no getItemLayout). Hop to an estimated offset first so the
              // rows around the target render, then retry the precise scroll;
              // if that fails too, this handler re-fires and converges.
              flatListRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(() => {
                // The window can be replaced by a re-anchor fetch between the
                // failure and this retry, leaving info.index out of range —
                // an out-of-range scrollToIndex throws and crashes the screen.
                if (info.index < displayRowsRef.current.length) {
                  flatListRef.current?.scrollToIndex({
                    index: info.index,
                    viewPosition: 0.5,
                    animated: false,
                  });
                }
              }, 120);
            }}
```

- [ ] **Step 7 (Fix 7): Pass `capped` to the header**

In the header render (~line 5586):

```tsx
              onClose={closeChatSearch}
              loading={chatSearchLoading}
              jumping={resolvingReplyJumpId !== null}
            />
```

becomes:

```tsx
              onClose={closeChatSearch}
              loading={chatSearchLoading}
              jumping={resolvingReplyJumpId !== null}
              capped={chatSearchHits.length >= 50} // 50 = the `limit` passed to searchMessages
            />
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit 2>&1 | grep DirectMessageScreen`
Expected: no output (clean).

---

### Task 3: `DirectGroupChat.tsx` — mirror every Task 2 edit

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx` (search state ~line 3905, jump handler ~line 3760, FlatList props ~line 5760, header render ~line 5483, imports ~line 1–20)

**Interfaces:**
- Consumes: `ChatSearchHeader.capped` (Task 1); identical `handleReplyPreviewPress(id, opts?: { animated?; span?; silent? })` shape as Task 2.

Apply Task 2's Steps 1–7 verbatim to this file — the search region is byte-identical, so every `old_string` matches — **except** the two failure alerts in Step 2(c), which in this file use a curly apostrophe. Use exactly:

```tsx
        if (result.messages.length === 0) {
          if (!silent) Alert.alert('Message not available', 'We couldn’t find the original message.');
          pendingJumpTargetRef.current = null;
          return;
        }
```

```tsx
      } catch {
        if (!silent) Alert.alert('Message not available', 'We couldn’t find the original message.');
        pendingJumpTargetRef.current = null;
        return;
      } finally {
```

- [ ] **Step 1: Add `BackHandler` to the react-native import** (Task 2 Step 1 code)
- [ ] **Step 2: Add `silent` to the jump handler** (Task 2 Step 2 code, curly-apostrophe alerts above)
- [ ] **Step 3: Add `lastSearchJumpRef` + gate the auto-jump** (Task 2 Step 3 code)
- [ ] **Step 4: Update `goToChatSearchHit`** (Task 2 Step 4 code)
- [ ] **Step 5: Reset ref in `closeChatSearch` + BackHandler effect** (Task 2 Step 5 code)
- [ ] **Step 6: Rewrite `onScrollToIndexFailed`** (Task 2 Step 6 code)
- [ ] **Step 7: Pass `capped` to the header** (Task 2 Step 7 code)
- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit 2>&1 | grep DirectGroupChat`
Expected: no output (clean).

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "DirectMessageScreen|DirectGroupChat|ChatSearchHeader"`
Expected: no output.

- [ ] **Step 2: Parity check — the two screens' search regions stayed in sync**

Run:
```bash
for f in src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx; do
  echo "== $f =="
  grep -c "lastSearchJumpRef\|silent: true\|BackHandler\|averageItemLength\|capped={chatSearchHits" "$f"
done
```
Expected: the same count (≥ 10) for both files.

- [ ] **Step 3: Hand off the on-device checklist (Ohad tests; do not claim done)**

Report to Ohad, per fix — in BOTH a DM and a group chat:
1. Search a term with hits far back in history; press ▲ repeatedly — every press lands centered on the highlighted hit, spinner shows during fetches, no crash.
2. (Android) With search open, hardware back closes the bar and stays in the chat; second back leaves.
3. Type a query incrementally ("hel" → "hello") — the list jumps/flashes once, not per keystroke.
4. First ▲ press dismisses the keyboard; tapping the input re-opens it.
5. Delete a matched message from another device, arrow onto it — no popup; a reply-preview tap to an unavailable message still alerts.
6. Query with >50 matches shows "1 of 50+"; smaller result sets show plain "1 of N".
