# Unsent-message UX (1:1 & group chats) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop text messages from disappearing from the open chat thread on a bad connection; remove the "Tap to retry" UI for text (text relies on the already-built silent outbox auto-resend); and in 1:1 chats hide the delivery double-tick until the message is actually server-confirmed.

**Architecture:** Three targeted edits. Fix #1: apply the existing server-fetch merge-preserve guard to the two cache-hit branches of `loadMessages()` in both chat screens. Fix #2: in each screen's text `sendMessage` catch, stop setting `upload_state:'failed'` so text shows no failed/retry UI. Fix #4 (1:1 only): teach `getReceiptState`/`ReadReceipt` that a text row still on its temporary client id is not confirmed, and render no tick until it is. Silent auto-resend already exists and is not modified.

**Tech Stack:** React Native 0.81 / Expo 54 / React 19, TypeScript. Existing modules: `chatHistoryCache.mergeMessages`, `messageOutbox`, `MessagingProvider` outbox flush wiring, `Images.doubleTick`.

## Global Constraints

- OTA-able only — no native module change, no DB migration, no edge-function change, no new image asset.
- The two screens (`DirectMessageScreen.tsx`, `DirectGroupChat.tsx`) carry near-identical duplicated logic; **Fix #1 and Fix #2 must be mirrored across both**. Fix #4 is 1:1-only → `DirectMessageScreen.tsx` only.
- Do NOT modify `messageOutbox`, the `MessagingProvider` flush wiring, or any media/video/voice/file/contact send/retry/upload path.
- Do NOT add a single-tick / clock / "Sending…" indicator, and do NOT add ticks to group chats.
- Ohad reviews and commits manually — commit commands are provided for him to run after review; do not auto-commit unless asked.
- These are 3,500-line screen components with no isolated unit-test harness; verification is `tsc` + a scripted manual on-device repro (Ohad tests on-device — no simulator/Maestro). Do not fabricate unit tests that cannot run.

---

### Task 1: Fix #1 — merge-preserve optimistic rows on cache-hit reload (both screens)

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx:1586` (memory-cache hit) and `:1675` (AsyncStorage-cache hit)
- Modify: `src/screens/DirectGroupChat.tsx:1404` (memory-cache hit) and `:1493` (AsyncStorage-cache hit)

**Interfaces:**
- Consumes: `chatHistoryCache.mergeMessages(cached: Message[], newMessages: Message[]): Message[]` — dedupes by `id`, `newMessages` win on conflict, preserves entries from `cached` not present in `newMessages`, sorts by `created_at` then `id`.
- Produces: nothing new; behavior change only.

**Context:** The reference guard already exists at `DirectMessageScreen.tsx:1731` (server-fetch branch). These four cache-hit branches currently blind-replace and are the root cause of the disappearance.

- [ ] **Step 1: DirectMessageScreen — memory-cache branch (`:1586`)**

Replace this exact line:

```tsx
      setMessages(cachedMessages);
```

with:

```tsx
      // Preserve any local-only (un-acked optimistic) messages for THIS
      // conversation. A bad connection trips a Realtime CHANNEL_ERROR, which
      // bumps reconnectAttempt and re-runs this loader; a blind replace would
      // wipe an in-flight send from the thread even though it's still visible
      // in the conversation-list preview. Mirrors the server-fetch guard below.
      setMessages((prev) => {
        const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
        if (localForThisConvo.length === 0) return cachedMessages;
        return chatHistoryCache.mergeMessages(localForThisConvo, cachedMessages);
      });
```

- [ ] **Step 2: DirectMessageScreen — AsyncStorage-cache branch (`:1675`)**

Replace this exact line:

```tsx
        setMessages(asyncCachedMessages);
```

with:

```tsx
        // Preserve any local-only (un-acked optimistic) messages for THIS
        // conversation across a reconnect-triggered reload (see memory-cache
        // branch above). Mirrors the server-fetch guard.
        setMessages((prev) => {
          const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
          if (localForThisConvo.length === 0) return asyncCachedMessages;
          return chatHistoryCache.mergeMessages(localForThisConvo, asyncCachedMessages);
        });
```

- [ ] **Step 3: DirectGroupChat — memory-cache branch (`:1404`)**

Replace this exact line:

```tsx
      setMessages(cachedMessages);
```

with:

```tsx
      // Preserve any local-only (un-acked optimistic) messages for THIS
      // conversation across a reconnect-triggered reload (CHANNEL_ERROR bumps
      // reconnectAttempt). Mirrors the server-fetch guard below.
      setMessages((prev) => {
        const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
        if (localForThisConvo.length === 0) return cachedMessages;
        return chatHistoryCache.mergeMessages(localForThisConvo, cachedMessages);
      });
```

- [ ] **Step 4: DirectGroupChat — AsyncStorage-cache branch (`:1493`)**

Replace this exact line:

```tsx
        setMessages(asyncCachedMessages);
```

with:

```tsx
        // Preserve any local-only (un-acked optimistic) messages for THIS
        // conversation across a reconnect-triggered reload. Mirrors the
        // server-fetch guard.
        setMessages((prev) => {
          const localForThisConvo = prev.filter(m => m.conversation_id === currentConversationId);
          if (localForThisConvo.length === 0) return asyncCachedMessages;
          return chatHistoryCache.mergeMessages(localForThisConvo, asyncCachedMessages);
        });
```

- [ ] **Step 5: Confirm the group screen references are in scope**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative
grep -n "chatHistoryCache.mergeMessages\|currentConversationId" src/screens/DirectGroupChat.tsx | head
```

Expected: `chatHistoryCache` and `currentConversationId` are already used in that file (server-fetch branch and elsewhere). If `chatHistoryCache` is somehow not imported, add the same import `DirectMessageScreen.tsx` uses. (Expected: already present.)

- [ ] **Step 6: Type-check**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative && npx tsc --noEmit
```

Expected: no new errors introduced by these four edits.

- [ ] **Step 7: Commit (Ohad, after review)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
git commit -m "fix(chat): keep in-flight message visible on reconnect reload

Cache-hit branches of loadMessages() blind-replaced local state, wiping an
optimistic message from the thread when a bad-connection CHANNEL_ERROR
re-ran the loader. Apply the same merge-preserve guard the server-fetch
branch already uses, in both DM and group screens."
```

---

### Task 2: Fix #2 — no failed/retry UI for text (both screens)

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx:2113-2126` (text `sendMessage` catch/finally)
- Modify: `src/screens/DirectGroupChat.tsx:1931-1944` (text `sendMessage` catch/finally)

**Interfaces:**
- Consumes: `messageOutbox.markFailed(clientId, error)` (unchanged — bookkeeping only; entry stays enqueued for the next flush).
- Produces: text optimistic rows never receive `upload_state:'failed'`, so the "Tap to retry" footer (`DirectMessageScreen.tsx:4707`, group `:4561`) and the long-press "Resend/Reenviar" option (DM `:3681`, group `:3501`) never appear for text. Media/file/contact paths set their own `upload_state` elsewhere and are unaffected.

**Context:** This `sendMessage` handler is text-only — it calls `messagingService.sendMessage(..., 'text', ...)`. The failed-state set is removed outright; no type-branch needed. `handleRetryTextMessage` and the footer are left in place (inert for text; still wired for the pre-existing, out-of-scope media-failed menu path — do not delete).

- [ ] **Step 1: DirectMessageScreen — remove the text failed-state set (`:2113-2126`)**

Replace this exact block:

```tsx
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Do NOT remove the optimistic row — leave it visible with a failed
      // indicator so the user knows it's retryable. The outbox entry stays
      // enqueued and will be retried on the next flush trigger.
      messageOutbox.markFailed(clientId, error).catch(() => {});
      setMessages((prev) => prev.map(msg =>
        msg.id === clientId
          ? { ...msg, upload_state: 'failed', upload_error: error?.message ?? 'Send failed' }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
```

with:

```tsx
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Text messages show no failed/retry UI. Leave the optimistic bubble
      // untouched (Fix #1 keeps it visible in the thread, with no tick until it
      // is server-confirmed) and let the persistent outbox resend it silently on
      // the next flush trigger (app foreground / NetInfo reconnect / Realtime
      // reconnect / conversation open). markFailed only bumps attempt
      // bookkeeping; the entry stays enqueued.
      messageOutbox.markFailed(clientId, error).catch(() => {});
    } finally {
      setIsLoading(false);
    }
```

- [ ] **Step 2: DirectGroupChat — remove the text failed-state set (`:1931-1944`)**

Replace this exact block:

```tsx
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Do NOT remove the optimistic row — leave it visible with a failed
      // indicator so the user knows it's retryable. The outbox entry stays
      // enqueued and will be retried on the next flush trigger.
      messageOutbox.markFailed(clientId, error).catch(() => {});
      setMessages((prev) => prev.map(msg =>
        msg.id === clientId
          ? { ...msg, upload_state: 'failed', upload_error: error?.message ?? 'Send failed' }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
```

with:

```tsx
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Text messages show no failed/retry UI. Leave the optimistic bubble
      // untouched (Fix #1 keeps it visible) and let the persistent outbox resend
      // it silently on the next flush trigger. markFailed only bumps attempt
      // bookkeeping; the entry stays enqueued.
      messageOutbox.markFailed(clientId, error).catch(() => {});
    } finally {
      setIsLoading(false);
    }
```

- [ ] **Step 3: Verify no other path sets `upload_state:'failed'` on a text send**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative
grep -n "upload_state: 'failed'" src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
```

Expected: the only remaining `upload_state: 'failed'` assignments are inside `handleRetryTextMessage` (retry-fail path) and media handlers — NOT in the text `sendMessage` catch. `handleRetryTextMessage` is now unreachable for text but is left in place for the shared media-menu path; acceptable and out of scope.

- [ ] **Step 4: Type-check**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative && npx tsc --noEmit
```

Expected: no new errors. (`error` is still referenced by `console.error` and `markFailed`.)

- [ ] **Step 5: Commit (Ohad, after review)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
git commit -m "fix(chat): no failed/retry UI for text messages

Text sends no longer flip to upload_state:'failed' on error, so the red
'Tap to retry' footer and long-press Resend never show for text. The
optimistic bubble stays visible and the persistent outbox resends it
silently on the next flush trigger. Media/video/voice/file/contact retry
is unchanged."
```

---

### Task 3: Fix #4 — hide the 1:1 delivery tick until server-confirmed

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx:98-104` (`getReceiptState`)
- Modify: `src/screens/DirectMessageScreen.tsx:106-122` (`ReadReceipt`)

**Interfaces:**
- Consumes: `Message` shape — `upload_state?: 'uploading' | 'sent' | 'failed'`, `id: string`, `client_id?: string`. An optimistic own-row has `id === client_id`; after reconciliation the server row has a real `id !== client_id`.
- Produces: the `ReadReceipt` renders nothing for a not-yet-confirmed message; grey/coloured double-tick render unchanged once confirmed.

**Context:** 1:1 only. Group screens pass `enabled={isDirect}` (false) → `ReadReceipt` already returns null there, so no group edit is needed. Today `getReceiptState` returns `'delivered'` for a text optimistic row (its `upload_state` is undefined), so the grey double-tick shows *before* the server confirms — this task makes it honest.

- [ ] **Step 1: Extend `getReceiptState` to detect unconfirmed text (`:98-104`)**

Replace this exact block:

```tsx
function getReceiptState(msg: Message, otherReadAt: string | null): ReceiptState {
  if (msg.upload_state === 'uploading' || msg.upload_state === 'failed') return 'pending';
  if (!otherReadAt) return 'delivered';
  return new Date(msg.created_at).getTime() <= new Date(otherReadAt).getTime()
    ? 'read'
    : 'delivered';
}
```

with:

```tsx
function getReceiptState(msg: Message, otherReadAt: string | null): ReceiptState {
  // Not yet confirmed by the server: media still uploading/failed, OR a text
  // row that still carries its temporary client id (id === client_id) because
  // sendMessage hasn't reconciled it to the server row yet. Show no tick until
  // it lands (ReadReceipt returns null for 'pending').
  if (
    msg.upload_state === 'uploading' ||
    msg.upload_state === 'failed' ||
    (!!msg.client_id && msg.id === msg.client_id)
  ) return 'pending';
  if (!otherReadAt) return 'delivered';
  return new Date(msg.created_at).getTime() <= new Date(otherReadAt).getTime()
    ? 'read'
    : 'delivered';
}
```

- [ ] **Step 2: Render no tick for `'pending'` in `ReadReceipt` (`:106-122`)**

Replace this exact block:

```tsx
function ReadReceipt({ state, enabled = true }: { state: ReceiptState; onDark?: boolean; enabled?: boolean }) {
  // Group chats pass enabled={isDirect} so the tick is hidden — read state across
  // multiple recipients isn't a single boolean.
  if (!enabled) return null;
  // Gray when delivered (or pending — UI shows "Sending…" alongside it anyway),
  // white when the other user has read up to this message (sits on the celeste own bubble).
  const color = state === 'read' ? '#FFFFFF' : '#C2C2C2';
```

with:

```tsx
function ReadReceipt({ state, enabled = true }: { state: ReceiptState; onDark?: boolean; enabled?: boolean }) {
  // Group chats pass enabled={isDirect} so the tick is hidden — read state across
  // multiple recipients isn't a single boolean.
  if (!enabled) return null;
  // No tick until the server confirms the message (see getReceiptState). This
  // covers a text still on its temporary client id and a failed-and-retrying
  // text — both read as "not sent yet".
  if (state === 'pending') return null;
  // Gray when delivered, white when the other user has read up to this message
  // (sits on the celeste own bubble).
  const color = state === 'read' ? '#FFFFFF' : '#C2C2C2';
```

(The remainder of `ReadReceipt` — the `Reanimated.View` + `Image` — is unchanged.)

- [ ] **Step 3: Type-check**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative && npx tsc --noEmit
```

Expected: no new errors. `ReceiptState` still has three members (`'pending' | 'delivered' | 'read'`); `'pending'` now renders null instead of a grey tick.

- [ ] **Step 4: Commit (Ohad, after review)**

```bash
git add src/screens/DirectMessageScreen.tsx
git commit -m "fix(chat): hide 1:1 delivery tick until message is server-confirmed

A text bubble showed the grey double-tick immediately on send, before the
server confirmed it (upload_state was undefined so getReceiptState fell
through to 'delivered'). Treat a row still on its temporary client id as
unconfirmed and render no tick until it lands. Grey/coloured ticks
unchanged once confirmed. 1:1 only; groups still show no ticks."
```

---

### Task 4: Verify end-to-end (type-check + manual on-device repro)

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full type-check**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative && npx tsc --noEmit
```

Expected: passes with no new errors from Tasks 1–3.

- [ ] **Step 2: Confirm the silent-resend wiring is intact (read-only)**

Run:

```bash
cd /Users/ohadstorfer/swellyoNative
grep -n "flushOutbox\|messageOutbox.enqueue\|messageOutbox.flushAll\|NetInfo.addEventListener" src/context/MessagingProvider.tsx
grep -n "messageOutbox.enqueue\|messageOutbox.getByConversation" src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
```

Expected: enqueue-on-send, per-conversation flush-on-open, and the MessagingProvider `flushOutbox` on mount / AppState-active / NetInfo-reconnect are all still present and untouched.

- [ ] **Step 3: Manual on-device repro — disappearance (Ohad)**

  1. Open a 1:1 chat with existing history (memory cache warm).
  2. Force a Realtime `CHANNEL_ERROR` during send (Network Link Conditioner, airplane-mode flap, or a very slow profile).
  3. Send a text.
  4. **Expected:** the bubble appears immediately and **stays visible** the whole time — no vanish — and matches the conversation-list preview. On recovery it reconciles to the server row (no duplicate).
  5. Repeat in a group chat (bubble must not vanish; groups show no ticks).

- [ ] **Step 4: Manual on-device repro — ticks + no text retry (Ohad, 1:1)**

  1. Network off, send a text. **Expected:** bubble visible, **no tick**, no clock/"Sending…", no red "Tap to retry"; long-press shows no "Resend/Reenviar".
  2. Network on (or background→foreground). **Expected:** it sends silently and shows the **grey double-tick**; no user action, no duplicate.
  3. Have the other user open the chat. **Expected:** the tick turns **coloured** (read), as today.
  4. Send a photo/voice/file with network off. **Expected:** its existing "Tap to retry" still appears — unchanged.

- [ ] **Step 5: Done**

No commit — verification only. Report tsc output + repro observations for review.

---

## Self-Review

**Spec coverage:**
- Fix #1 (stop disappearance, both screens): Task 1 — all four cache-hit branches. ✓
- Fix #2 (no text retry UI, both screens): Task 2 — both text catch blocks. ✓
- Fix #4 (hide 1:1 tick until confirmed): Task 3 — getReceiptState + ReadReceipt in DM only. ✓
- Silent auto-resend already built: Task 4 Step 2 verifies, no code change. ✓
- Acceptance criteria 1–6: Task 4 Steps 3–4 (repro), Step 1 (tsc); mirror-across-both enforced in Tasks 1–2; groups-no-ticks preserved (Fix #4 untouched in group file). ✓
- Accepted tradeoff (permanent-failure text sits with no tick): inherent in Task 2 + Task 3; documented in spec. ✓

**Placeholder scan:** No TBD/TODO; every code step shows exact before/after. ✓

**Type consistency:** `ReceiptState` unchanged (`'pending' | 'delivered' | 'read'`); `'pending'` now maps to null render. `mergeMessages(cached, newMessages)` used with the same arg order as the proven server-branch guard. `currentConversationId`, `chatHistoryCache`, `messageOutbox`, `clientId`, `Images.doubleTick` all already in scope. ✓

**Deviation from an earlier draft noted:** an interim design proposed a single-tick asset; final decision is to render *no* tick until confirmed (reuse the existing double-tick, no new art) — reflected in Task 3.
