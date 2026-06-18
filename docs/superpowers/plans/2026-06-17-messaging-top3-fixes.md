# Messaging Top-3 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ Commit policy (Ohad's rule):** Do NOT run `git commit` yourself. At each "Commit" step, STAGE the files and STOP — Ohad reviews and commits manually. The suggested commit message is provided for him. Treat each commit boundary as a review checkpoint.
>
> **Verification reality:** Ohad tests on a real device (no simulator/Maestro). Pure logic and service queries are covered by `jest-expo` unit tests in this plan. UI/scroll/error-boundary behavior is verified on-device via the explicit manual steps in each phase.

**Goal:** Fix the three high-severity messaging issues — (1) a single bad message crashing the whole app, (2) a ~5-DB-op burst per incoming message, (3) unbounded memory growth in long threads — grounded in how WhatsApp/Messenger/Signal/Slack/Telegram/Stream handle them.

**Architecture:** Four sequential phases (they overlap in `DirectMessageScreen`/`DirectGroupChat`/`MessagingProvider`, so no parallelization). Phase 0 fixes a real send-timeout freeze (added after cross-checking a second independent review — see `messaging-reviews-compared.html`). Phase 1 adds layered crash isolation (edge validation + screen boundary + per-bubble boundary). Phase 2 decouples the instant "Seen" broadcast from a debounced durable read-watermark write and drops the per-message recount. Phase 3 caps the in-memory message array with viewport-safe pruning, tunes FlatList, and replaces reply-jump's page-until-found loop with a fetch-around-target window reset.

**Tech Stack:** React Native 0.81 / Expo 54 / React 19, Supabase (Postgres + Realtime Broadcast), `react-error-boundary`, `@stream-io/flat-list-mvcp`, Sentry, Jest (`jest-expo`).

**Reference spec:** `docs/superpowers/specs/2026-06-17-messaging-top3-fixes-design.md`

---

## PHASE 0 — Send-timeout freeze fix

**Why first:** This is a real bug (verified), not perf — and the Phase 1 error boundary does NOT cover it (nothing throws; the send promise hangs). The text path already has `catch → upload_state:'failed'` (`DirectMessageScreen.tsx:1689-1692`) and `finally → setIsLoading(false)` (`:1694-1696`); the freeze happens only because `messagingService.sendMessage` (`messagingService.ts:811-902`) has **no timeout**, so on a network stall it never resolves/rejects, `finally` never runs, and the send button stays `disabled={isLoading}` (`:3996`) forever. The fix: make `sendMessage` (and the media upload call) reject on timeout so the existing error paths unfreeze the UI.

### Task 0.1: `withTimeout` utility (TDD)

**Files:**
- Create: `src/services/messaging/withTimeout.ts`
- Test: `src/services/messaging/__tests__/withTimeout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/messaging/__tests__/withTimeout.test.ts
import { withTimeout, TimeoutError } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('rejects with the original error when the promise rejects in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when the promise hangs past the deadline', async () => {
    const hang = new Promise(() => {}); // never settles
    const p = withTimeout(hang, 5000, 'send');
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    jest.advanceTimersByTime(5000);
    await assertion;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/withTimeout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/messaging/withTimeout.ts
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Reject if `promise` does not settle within `ms`. Used to bound network calls
 * on the send path so a stalled request surfaces as an error (→ message marked
 * 'failed', composer unfrozen) instead of hanging forever.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/withTimeout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/withTimeout.ts src/services/messaging/__tests__/withTimeout.test.ts
# feat(messaging): add withTimeout helper for send-path deadlines
```

---

### Task 0.2: Bound the network calls in `messagingService.sendMessage`

**Files:**
- Modify: `src/services/messaging/messagingService.ts:855-895`

- [ ] **Step 1: Import the helper + add a constant**

At the top of `messagingService.ts` (with the other imports):
```ts
import { withTimeout } from './withTimeout';
```
Near the top of the class or module, add:
```ts
const SEND_TIMEOUT_MS = 30000; // matches the new-conversation timeout already used in the screens
```

- [ ] **Step 2: Wrap the upsert / fetch / insert awaits**

Replace the idempotent upsert block (lines 861–865):
```ts
        const { data: upserted, error } = await withTimeout(
          supabase
            .from('messages')
            .upsert(payload, { onConflict: 'sender_id,client_id', ignoreDuplicates: true })
            .select()
            .maybeSingle(),
          SEND_TIMEOUT_MS,
          'send-upsert'
        );
```

Replace the existing-row fetch (lines 872–877):
```ts
          const { data: existing, error: fetchErr } = await withTimeout(
            supabase.from('messages').select().eq('sender_id', senderId).eq('client_id', clientId).single(),
            SEND_TIMEOUT_MS,
            'send-fetch'
          );
```

Replace the non-idempotent insert (lines 882–886):
```ts
        const { data: inserted, error } = await withTimeout(
          supabase.from('messages').insert(payload).select().single(),
          SEND_TIMEOUT_MS,
          'send-insert'
        );
```

- [ ] **Step 3: Make the `updated_at` touch non-blocking**

Replace the awaited conversation touch (lines 892–895) so a stalled metadata write can never freeze the send return:
```ts
      // Fire-and-forget: bounded, and never blocks the send return. The message
      // is already inserted; updated_at is non-critical recency metadata.
      withTimeout(
        supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId),
        10000,
        'send-touch'
      ).catch((e) => console.warn('[messagingService] updated_at touch failed:', e));
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`withTimeout` accepts the PostgREST builder, which is a thenable.)

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/messagingService.ts
# fix(messaging): bound sendMessage network calls with a timeout (unfreezes composer on stall)
```

---

### Task 0.3: Bound the media upload calls (both screens)

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx` — image/video/audio send handlers
- Modify: `src/screens/DirectGroupChat.tsx` — same handlers

- [ ] **Step 1: Locate the media upload awaits**

Run: `grep -n "await .*[Uu]pload\|uploadService\|imageUploadService\|videoUpload\|audioUpload" src/screens/DirectMessageScreen.tsx`
This lists the upload `await`s inside the media send handlers (the ones that set `upload_state: 'uploading'` on the optimistic bubble and, on error, set `upload_state: 'failed'`).

- [ ] **Step 2: Wrap each upload await in `withTimeout`**

Import at top of the screen: `import { withTimeout } from '../services/messaging/withTimeout';`

For each upload `await` found in Step 1, wrap the uploaded-promise in `withTimeout(..., 60000, 'media-upload')` (60s — uploads are larger than a text insert). Pattern — change:
```ts
const uploaded = await someUploadService.upload(localUri, ...);
```
to:
```ts
const uploaded = await withTimeout(someUploadService.upload(localUri, ...), 60000, 'media-upload');
```
This is the only change per site: the existing surrounding `try { ... } catch { setMessages(... upload_state: 'failed' ...) }` already flips the bubble to "failed" on rejection — the timeout simply guarantees a rejection instead of an infinite spinner. Do **not** alter the catch blocks.

> If a media handler uploads then calls `messagingService.sendMessage`, that second call is already bounded by Task 0.2 — only the upload await needs wrapping here.

- [ ] **Step 3: Mirror Step 2 in `DirectGroupChat.tsx`** (`grep -n "await .*[Uu]pload" src/screens/DirectGroupChat.tsx`, wrap each).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: On-device verification**

- Turn on Airplane Mode mid-send of a text message → within ~30s the bubble shows "failed" (retryable) and the send button re-enables (not stuck). Restore network → outbox retry delivers it (no duplicate).
- Repeat with a photo/video → the bubble's spinner stops and flips to "failed" within ~60s instead of spinning forever.

- [ ] **Step 6: Commit (STAGE + hand off)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
# fix(messaging): bound media uploads with a timeout so the bubble can't spin forever
```

---

## PHASE 1 — Crash isolation

### Task 1.1: Add `react-error-boundary` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the library**

Run: `npx expo install react-error-boundary`
Expected: `react-error-boundary` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit (STAGE + hand off to Ohad)**

```bash
git add package.json package-lock.json
# Suggested message:
# chore(messaging): add react-error-boundary for chat crash isolation
```

---

### Task 1.2: `sanitizeMessage` — edge validation helper (TDD)

**Files:**
- Create: `src/services/messaging/messageSanitizer.ts`
- Test: `src/services/messaging/__tests__/messageSanitizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/messaging/__tests__/messageSanitizer.test.ts
import { sanitizeMessage, sanitizeMessages } from '../messageSanitizer';

describe('sanitizeMessage', () => {
  const valid = {
    id: 'm1',
    conversation_id: 'c1',
    sender_id: 'u1',
    created_at: '2026-06-17T00:00:00.000Z',
    type: 'text',
    body: 'hi',
  };

  it('returns the message when all required fields are present', () => {
    expect(sanitizeMessage(valid)).toEqual(valid);
  });

  it('returns null when a required field is missing', () => {
    expect(sanitizeMessage({ ...valid, id: undefined })).toBeNull();
    expect(sanitizeMessage({ ...valid, conversation_id: null })).toBeNull();
    expect(sanitizeMessage({ ...valid, created_at: '' })).toBeNull();
    expect(sanitizeMessage({ ...valid, type: undefined })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizeMessage(null)).toBeNull();
    expect(sanitizeMessage(undefined)).toBeNull();
    expect(sanitizeMessage('nope')).toBeNull();
  });

  it('drops invalid rows from an array and keeps valid ones', () => {
    const out = sanitizeMessages([valid, { ...valid, id: undefined }, { ...valid, id: 'm2' }]);
    expect(out.map(m => m.id)).toEqual(['m1', 'm2']);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeMessages(null as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/messageSanitizer.test.ts`
Expected: FAIL — "Cannot find module '../messageSanitizer'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/messaging/messageSanitizer.ts
import type { Message } from '../../types/messaging';

// Required fields without which a message cannot be rendered safely.
const REQUIRED_KEYS: Array<keyof Message> = ['id', 'conversation_id', 'created_at', 'type'];

/**
 * Validate a raw message object before it enters component state.
 * Returns the message unchanged when valid, or null when a required field
 * is missing/empty. This keeps malformed rows out of the render tree (the
 * edge-validation layer of our crash-isolation strategy).
 */
export function sanitizeMessage(raw: any): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of REQUIRED_KEYS) {
    const v = (raw as any)[key];
    if (v === undefined || v === null || v === '') return null;
  }
  return raw as Message;
}

/** Sanitize an array, dropping any invalid rows. Never throws. */
export function sanitizeMessages(raw: any): Message[] {
  if (!Array.isArray(raw)) return [];
  const out: Message[] = [];
  for (const r of raw) {
    const m = sanitizeMessage(r);
    if (m) out.push(m);
  }
  return out;
}
```

> If the `Message` type is not exported from `src/types/messaging`, locate it via `grep -rn "export interface Message" src/types` and fix the import path in both the test and the implementation before running.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/messageSanitizer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/messageSanitizer.ts src/services/messaging/__tests__/messageSanitizer.test.ts
# feat(messaging): add sanitizeMessage edge validation
```

---

### Task 1.3: `ChatErrorBoundary` screen-level boundary

**Files:**
- Create: `src/components/chat/ChatErrorBoundary.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/chat/ChatErrorBoundary.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ErrorBoundary } from 'react-error-boundary';
import * as Sentry from '@sentry/react-native';
import { ff } from '../../theme/fonts';

interface Props {
  children: React.ReactNode;
  /** Boundary auto-resets when any value here changes (e.g. [conversationId]). */
  resetKeys?: Array<string | number | undefined>;
  /** Optional callback for the "Go back" button (e.g. navigation.goBack). */
  onGoBack?: () => void;
}

function Fallback({ resetErrorBoundary, onGoBack }: { resetErrorBoundary: () => void; onGoBack?: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.subtitle}>This chat hit an error. You can retry or go back.</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.button} onPress={resetErrorBoundary}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
        {onGoBack && (
          <TouchableOpacity style={[styles.button, styles.secondary]} onPress={onGoBack}>
            <Text style={styles.buttonText}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/**
 * Screen-level crash isolation for chat screens. A render error inside the
 * wrapped screen shows a recoverable fallback instead of white-screening the
 * whole app. `resetKeys={[conversationId]}` auto-recovers on navigation.
 * Sentry capture happens here; do NOT also wrap the subtree in
 * Sentry.ErrorBoundary (double-reporting — getsentry/sentry-javascript#1432).
 */
export function ChatErrorBoundary({ children, resetKeys, onGoBack }: Props) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error, info) => {
        Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
      }}
      fallbackRender={({ resetErrorBoundary }) => (
        <Fallback resetErrorBoundary={resetErrorBoundary} onGoBack={onGoBack} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { ...ff('Poppins', '600'), fontSize: 18, marginBottom: 8, color: '#111' },
  subtitle: { ...ff('Poppins', '400'), fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20 },
  row: { flexDirection: 'row', gap: 12 },
  button: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#111' },
  secondary: { backgroundColor: '#888' },
  buttonText: { ...ff('Poppins', '600'), color: '#fff', fontSize: 14 },
});
```

> Verify the Sentry import path and the `ff` signature before running: `grep -rn "from '@sentry/react-native'" src | head -1` and `grep -n "export function ff\|export const ff" src/theme/fonts.ts`. Match the existing font family name used elsewhere (e.g. run `grep -rn "ff('" src/screens/DirectMessageScreen.tsx | head -3`) and use that family instead of `'Poppins'` if it differs.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit (STAGE + hand off)**

```bash
git add src/components/chat/ChatErrorBoundary.tsx
# feat(messaging): add ChatErrorBoundary screen-level crash isolation
```

---

### Task 1.4: `SafeMessageBubble` per-item boundary

**Files:**
- Create: `src/components/chat/SafeMessageBubble.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/chat/SafeMessageBubble.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ErrorBoundary } from 'react-error-boundary';
import * as Sentry from '@sentry/react-native';
import { ff } from '../../theme/fonts';

interface Props {
  /** Stable id used both for Sentry context and as the boundary reset key. */
  messageId: string;
  children: React.ReactNode;
}

function BubbleFallback() {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>Message unavailable</Text>
    </View>
  );
}

/**
 * Per-bubble crash isolation. A render error in one message renders a muted
 * "Message unavailable" placeholder instead of crashing the whole thread.
 * MUST be a named component (not inline JSX) so React can isolate the subtree.
 */
export function SafeMessageBubble({ messageId, children }: Props) {
  return (
    <ErrorBoundary
      resetKeys={[messageId]}
      onError={(error) => {
        Sentry.captureException(error, { tags: { surface: 'message_bubble' }, extra: { messageId } });
      }}
      fallback={<BubbleFallback />}
    >
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  fallback: { paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 12, borderRadius: 12, backgroundColor: '#f0f0f0' },
  fallbackText: { ...ff('Poppins', '400'), fontSize: 13, color: '#999', fontStyle: 'italic' },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit (STAGE + hand off)**

```bash
git add src/components/chat/SafeMessageBubble.tsx
# feat(messaging): add SafeMessageBubble per-item crash isolation
```

---

### Task 1.5: Wire edge validation into the message ingest paths

**Files:**
- Modify: `src/services/messaging/chatHistoryCache.ts:243-266` (`loadCachedMessages`) and `:286-289` (`loadCachedMessagesAsync`)
- Modify: `src/screens/DirectMessageScreen.tsx:657` and `:1351` (state writes) — apply at the realtime ingest + older-page merge
- Modify: `src/screens/DirectGroupChat.tsx:655` and `:1280`

- [ ] **Step 1: Sanitize cache reads**

In `chatHistoryCache.ts`, import the sanitizer at the top:

```ts
import { sanitizeMessages } from './messageSanitizer';
```

In `loadCachedMessages` (sync) and `loadCachedMessagesAsync` (async), wrap the array you return so corrupt cached rows are filtered. Find each `return <messagesArray>;` at the end of the memory/AsyncStorage hit paths and change it to return `sanitizeMessages(<messagesArray>)`. Example for the memory path:

```ts
// before:  return cached.messages;
return sanitizeMessages(cached.messages);
```

Apply the same wrap to the AsyncStorage path's returned array.

- [ ] **Step 2: Sanitize the realtime-ingest append in `DirectMessageScreen.tsx`**

At the top of the `onNewMessage` callback (the block starting at line 615), guard the incoming message. Add, as the first lines inside the callback body (before `if (me && newMessage.sender_id !== me)` at line 615):

```ts
import { sanitizeMessage } from '../services/messaging/messageSanitizer'; // add to imports at top of file
```

```ts
// inside the realtime new-message handler, first line:
const safe = sanitizeMessage(newMessage);
if (!safe) {
  console.warn('[DirectMessageScreen] Dropping malformed realtime message');
  return;
}
// then use `safe` in place of `newMessage` for the rest of the handler
```

Replace subsequent uses of `newMessage` in that handler with `safe` (the `setMessages` updater at 618–664, the `markAsRead`/dispatch at 665–676). The minimal change: `const newMessage = safe;` immediately after the guard so the rest of the block is untouched — declare it as a new `const` only if `newMessage` is a parameter you can shadow; otherwise rename the parameter usage. Prefer the shadow:

```ts
onNewMessage: (rawMessage) => {
  const newMessage = sanitizeMessage(rawMessage);
  if (!newMessage) { console.warn('[DM] dropped malformed realtime message'); return; }
  // ... existing body unchanged, still referencing `newMessage`
```

> Find the exact parameter name of the `onNewMessage` callback first (`grep -n "onNewMessage" src/screens/DirectMessageScreen.tsx`). If it's already named `newMessage`, rename the parameter to `rawMessage` and add the two guard lines as shown.

- [ ] **Step 3: Mirror the guard in `DirectGroupChat.tsx`**

Apply the identical `onNewMessage` parameter rename + sanitize guard in `DirectGroupChat.tsx` (its append site is line 655).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/chatHistoryCache.ts src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
# feat(messaging): sanitize messages at cache + realtime ingest
```

---

### Task 1.6: Wrap screens + bubbles with the boundaries

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx` — `renderItem` (2948–2987) + the screen's top-level return
- Modify: `src/screens/DirectGroupChat.tsx` — equivalent `renderItem` + return
- Modify: `src/screens/ConversationsScreen.tsx` — top-level return

- [ ] **Step 1: Wrap each bubble in `renderItem` (DirectMessageScreen)**

Import at top: `import { SafeMessageBubble } from '../components/chat/SafeMessageBubble';`

Change the `renderItem` return (lines 2979–2986) to wrap the rendered message:

```tsx
return (
  <Reanimated.View
    entering={enteringAnim}
    style={{ marginBottom: messageGap }}
  >
    <SafeMessageBubble messageId={item.id}>
      {renderMessage(item, isLastInRun)}
    </SafeMessageBubble>
  </Reanimated.View>
);
```

- [ ] **Step 2: Wrap the screen return (DirectMessageScreen)**

Import at top: `import { ChatErrorBoundary } from '../components/chat/ChatErrorBoundary';`

Find the component's top-level `return (` (the outermost JSX of the screen function). Wrap the entire returned tree:

```tsx
return (
  <ChatErrorBoundary resetKeys={[currentConversationId]} onGoBack={() => navigation.goBack()}>
    {/* existing returned tree unchanged */}
  </ChatErrorBoundary>
);
```

> Find the outermost return with `grep -n "return (" src/screens/DirectMessageScreen.tsx | head` and confirm `navigation` is in scope (it is used elsewhere — `grep -n "navigation" src/screens/DirectMessageScreen.tsx | head -1`). If the screen already returns a single root element, wrap that element directly.

- [ ] **Step 3: Mirror in `DirectGroupChat.tsx`** (bubble wrap in its `renderItem`, screen wrap on its outermost return, `resetKeys={[currentConversationId]}`).

- [ ] **Step 4: Wrap `ConversationsScreen.tsx` return** with `ChatErrorBoundary` (no `resetKeys` needed; pass `onGoBack` only if the screen has a back action — otherwise omit).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: On-device verification**

Temporarily add, inside `renderMessage`, a throw for a test message to confirm isolation:
```tsx
if (message.body === '__CRASH_TEST__') throw new Error('crash test');
```
- Send yourself a message `__CRASH_TEST__` → only that bubble shows "Message unavailable"; the rest of the thread and app keep working.
- Confirm one Sentry event arrives (not 2–3).
- Remove the test throw.

- [ ] **Step 7: Commit (STAGE + hand off)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx src/screens/ConversationsScreen.tsx
# feat(messaging): wrap chat screens + bubbles in error boundaries
```

---

## PHASE 2 — Read-receipt load (keep "Seen" instant)

> **Read receipts are 1:1-only (design decision).** Group chats do NOT display a "Seen" indicator, so we must NOT broadcast read receipts in groups — that per-member fan-out is pure wasted data. The broadcast is gated to direct chats via `readReceiptsEnabled(isDirect)`. Because the receipt is a *live broadcast*, gating the SEND means groups generate **zero** read-receipt traffic (the listener simply never fires — nobody sends).
>
> **Forward compatibility (group "seen by" later).** We still persist `last_read_at` per member for groups (the inbox unread badge needs it) — and that per-member watermark in `conversation_members.last_read_at` is exactly the data a future "who viewed your message" feature reads. So enabling group read receipts later is a **one-line flip** (`readReceiptsEnabled` returns `true`, or gate it on a per-group setting). It takes effect for **new messages only** — it's a live broadcast, never retroactive — and needs **no schema change**.

### Task 2.1: Split `markAsRead` into broadcast + persist in `messagingService` (TDD)

**Files:**
- Modify: `src/services/messaging/messagingService.ts:1494-1554` (add two methods; keep `markAsRead`)
- Test: `src/services/messaging/__tests__/readWatermark.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/messaging/__tests__/readWatermark.test.ts
// Pure characterization test for persistReadWatermark: it must do exactly ONE
// conversation_members UPDATE and NOT count unread.
const mockUpdateBuilder = () => {
  const b: any = {};
  for (const m of ['update', 'eq', 'select', 'maybeSingle']) b[m] = jest.fn(() => b);
  b.then = (ok: any, err: any) => Promise.resolve({ data: null, error: null }).then(ok, err);
  return b;
};
const fromCalls: string[] = [];
const builder = mockUpdateBuilder();

jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: (t: string) => { fromCalls.push(t); return builder; },
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}));

import { messagingService } from '../messagingService';

describe('persistReadWatermark', () => {
  beforeEach(() => { fromCalls.length = 0; jest.clearAllMocks(); });

  it('issues exactly one conversation_members UPDATE and no messages query', async () => {
    await messagingService.persistReadWatermark('c1', 'u1', 'm9', '2026-06-17T00:00:00.000Z');
    expect(fromCalls).toEqual(['conversation_members']);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_read_message_id: 'm9', last_read_at: '2026-06-17T00:00:00.000Z' })
    );
  });
});
```

> Confirm the supabase import path the service actually uses (`grep -n "from '.*config/supabase'\|from '.*supabaseClient'" src/services/messaging/messagingService.ts | head -1`) and adjust the `jest.mock` path to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/readWatermark.test.ts`
Expected: FAIL — `messagingService.persistReadWatermark is not a function`.

- [ ] **Step 3: Add the two methods**

In `messagingService.ts`, immediately after `markAsRead` (after line 1554), add:

```ts
  /**
   * Broadcast the read receipt on the conversation channel ONLY (no DB write).
   * This is what drives the sender's instant "Seen" indicator. Cheap — reuses
   * the already-open per-conversation channel and takes the caller's userId so
   * it never makes an auth round-trip on the hot per-message path.
   */
  broadcastReadReceipt(conversationId: string, userId: string, lastReadAt: string): void {
    const channel = this.getChannel(conversationId);
    if (!channel) return;
    channel
      .send({ type: 'broadcast', event: 'read_receipt', payload: { userId, lastReadAt } })
      .catch((e: unknown) => console.warn('[messagingService] read_receipt broadcast failed:', e));
  }

  /**
   * Persist the read watermark to conversation_members. Durability only
   * (cold-load, multi-device, push badges) — NOT on the visible path. Safe to
   * debounce/coalesce. Does a single UPDATE; does not recount unread.
   */
  async persistReadWatermark(
    conversationId: string,
    userId: string,
    messageId: string | undefined,
    lastReadAt: string
  ): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const { error } = await supabase
        .from('conversation_members')
        .update({ last_read_message_id: messageId, last_read_at: lastReadAt })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (error) {
      console.error('[messagingService] persistReadWatermark failed:', error);
    }
  }
```

> `channel.send` returns a Promise in supabase-js v2; `.catch` is valid. If the local types disagree, wrap in `void (async () => { try { await channel.send(...) } catch (e) { ... } })();`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/readWatermark.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/messagingService.ts src/services/messaging/__tests__/readWatermark.test.ts
# feat(messaging): split read receipt into instant broadcast + durable persist
```

---

### Task 2.2: `readWatermarkQueue` — debounced coalescing util (TDD)

**Files:**
- Create: `src/services/messaging/readWatermarkQueue.ts`
- Test: `src/services/messaging/__tests__/readWatermarkQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/messaging/__tests__/readWatermarkQueue.test.ts
import { schedule, flush, flushAll, _resetForTests } from '../readWatermarkQueue';

describe('readWatermarkQueue', () => {
  beforeEach(() => { jest.useFakeTimers(); _resetForTests(); });
  afterEach(() => { jest.useRealTimers(); });

  it('coalesces rapid schedules for the same key into one run after the delay', () => {
    const fn = jest.fn();
    schedule('c1', fn, 2000);
    schedule('c1', fn, 2000);
    schedule('c1', fn, 2000);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs the LATEST scheduled fn for a key', () => {
    const first = jest.fn(); const last = jest.fn();
    schedule('c1', first, 2000);
    schedule('c1', last, 2000);
    jest.advanceTimersByTime(2000);
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(1);
  });

  it('flush(key) runs immediately and cancels the timer', () => {
    const fn = jest.fn();
    schedule('c1', fn, 2000);
    flush('c1');
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flushAll runs all pending keys once', () => {
    const a = jest.fn(); const b = jest.fn();
    schedule('c1', a, 2000); schedule('c2', b, 2000);
    flushAll();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/readWatermarkQueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/messaging/readWatermarkQueue.ts
// Per-conversation trailing debounce for durable read-watermark writes.
// The visible "Seen" is broadcast immediately elsewhere; this only coalesces
// the DB persistence so a burst of incoming messages produces ≤1 write/window.
type Pending = { fn: () => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, Pending>();

/** Schedule (or reschedule) the latest write for `key`, firing after `delayMs` of quiet. */
export function schedule(key: string, fn: () => void, delayMs = 2000): void {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => { pending.delete(key); fn(); }, delayMs);
  pending.set(key, { fn, timer });
}

/** Run the pending write for `key` immediately (e.g. on screen blur). */
export function flush(key: string): void {
  const existing = pending.get(key);
  if (!existing) return;
  clearTimeout(existing.timer);
  pending.delete(key);
  existing.fn();
}

/** Run every pending write immediately (e.g. on AppState → background). */
export function flushAll(): void {
  for (const [key] of pending) flush(key);
}

/** Test-only: clear state without running anything. */
export function _resetForTests(): void {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/readWatermarkQueue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/readWatermarkQueue.ts src/services/messaging/__tests__/readWatermarkQueue.test.ts
# feat(messaging): add debounced read-watermark queue
```

---

### Task 2.3: Rewire the provider's `markAsRead` + add realtime + flush APIs

**Files:**
- Modify: `src/context/MessagingProvider.tsx:8` (imports), `:988-1001` (`markAsRead`), `:1169-1174` (AppState background listener), the context value/type

- [ ] **Step 1: Add imports + a current-user ref**

At top of `MessagingProvider.tsx` add:
```ts
import { messagingService } from '../services/messaging/messagingService';        // confirm it's already imported; if so skip
import * as readWatermarkQueue from '../services/messaging/readWatermarkQueue';
```
Add a ref to hold the current user id (the provider already resolves the user when loading conversations — set it there). Near the other refs:
```ts
const currentUserIdRef = useRef<string | null>(null);
```

Add the read-receipt feature gate at module scope (top of the file, outside the component):
```ts
// Read receipts (the peer "Seen" indicator) are a 1:1-only feature today.
// Groups don't display them, so we skip the broadcast to avoid per-member
// fan-out traffic. To enable group read receipts LATER, return `true` here (or
// gate on a per-group setting/flag). It takes effect for NEW messages only —
// the receipt is a live broadcast, never retroactive — and the per-member read
// position already lives in conversation_members.last_read_at, so a future
// "seen by" needs no schema change.
function readReceiptsEnabled(isDirect: boolean): boolean {
  return isDirect;
}
```
> Find where the provider obtains the user (`grep -n "auth.getUser\|getSession\|user.id" src/context/MessagingProvider.tsx | head`). At that point set `currentUserIdRef.current = user.id;`. If the provider never resolves a user directly, resolve it once in an effect: `useEffect(() => { supabase.auth.getUser().then(({ data }) => { currentUserIdRef.current = data.user?.id ?? null; }); }, []);` (import `supabase` from the same path the service uses).

- [ ] **Step 2: Rewrite `markAsRead` (open path — instant, no recount)**

Replace lines 988–1001 with:
```ts
  // Mark conversation as read (called on chat OPEN). Opening means the user has
  // seen everything, so unread becomes 0 locally — no authoritative recount
  // query. The visible "Seen" is broadcast immediately; the durable watermark
  // write is debounced/coalesced.
  const markAsRead = useCallback((conversationId: string, isDirect: boolean, messageId?: string) => {
    const userId = currentUserIdRef.current;
    const lastReadAt = new Date().toISOString();
    // 1) instant local badge clear (both 1:1 and groups — inbox unread needs it)
    dispatch({ type: 'SET_UNREAD_COUNT', payload: { conversationId, count: 0 } });
    if (!userId) return;
    // 2) instant "Seen" for the peer — 1:1 ONLY (groups don't show read receipts)
    if (readReceiptsEnabled(isDirect)) {
      messagingService.broadcastReadReceipt(conversationId, userId, lastReadAt);
    }
    // 3) debounced durable write (both — powers the unread badge + future group "seen by")
    readWatermarkQueue.schedule(conversationId, () => {
      messagingService.persistReadWatermark(conversationId, userId, messageId, lastReadAt);
    });
  }, []);
```

- [ ] **Step 3: Add `markReadRealtime` (per-incoming-message path)**

Right after `markAsRead`, add:
```ts
  // Per-incoming-message read marking while the chat is focused. Same shape as
  // markAsRead but always carries the just-received messageId for the watermark.
  const markReadRealtime = useCallback((conversationId: string, messageId: string, isDirect: boolean) => {
    const userId = currentUserIdRef.current;
    const lastReadAt = new Date().toISOString();
    dispatch({ type: 'SET_UNREAD_COUNT', payload: { conversationId, count: 0 } });
    if (!userId) return;
    // 1:1 ONLY — groups produce zero read-receipt traffic by design.
    if (readReceiptsEnabled(isDirect)) {
      messagingService.broadcastReadReceipt(conversationId, userId, lastReadAt);
    }
    readWatermarkQueue.schedule(conversationId, () => {
      messagingService.persistReadWatermark(conversationId, userId, messageId, lastReadAt);
    });
  }, []);

  // Force-flush a single conversation's pending watermark (call on screen blur/unmount).
  const flushReadWatermark = useCallback((conversationId: string) => {
    readWatermarkQueue.flush(conversationId);
  }, []);
```

- [ ] **Step 4: Flush all watermarks on background**

In the existing AppState background listener (lines 1169–1174), add a `readWatermarkQueue.flushAll();` call alongside the cache flush:
```ts
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        readWatermarkQueue.flushAll();              // <-- add
        if (cacheWriteTimerRef.current) {
          clearTimeout(cacheWriteTimerRef.current);
          // ...existing
```

- [ ] **Step 5: Expose the new methods on the context**

Add `markReadRealtime` and `flushReadWatermark` to the context value object and to its TypeScript type. Update the signatures (they are no longer async):
- `markAsRead: (conversationId: string, isDirect: boolean, messageId?: string) => void`
- `markReadRealtime: (conversationId: string, messageId: string, isDirect: boolean) => void`
- `flushReadWatermark: (conversationId: string) => void`
> Find the context type and value (`grep -n "markAsRead" src/context/MessagingProvider.tsx`). Update both the `interface`/`type` for the context and the object passed to the `Provider value={...}`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only at call sites that `await markAsRead(...)` — fixed in the next task. No errors inside the provider.

- [ ] **Step 7: Commit (STAGE + hand off)**

```bash
git add src/context/MessagingProvider.tsx
# feat(messaging): instant-broadcast read receipts, debounce durable write, drop per-message recount
```

---

### Task 2.4: Update the screen call sites

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx:665-669` (incoming-message path) + add unmount/blur flush
- Modify: `src/screens/DirectGroupChat.tsx:664` + add unmount/blur flush

- [ ] **Step 1: Swap the per-message call (DirectMessageScreen)**

Pull the new methods from the messaging context where `markAsRead` is currently destructured (`grep -n "markAsRead" src/screens/DirectMessageScreen.tsx`). Add `markReadRealtime, flushReadWatermark` to that destructure.

Replace lines 665–669 (DirectMessageScreen is a 1:1 chat → pass `true`; use the screen's `isDirect` variable if present, otherwise literal `true`):
```ts
            if (me && convId) {
              markReadRealtime(convId, newMessage.id, true);
            }
```
(`markReadRealtime` is fire-and-forget/sync — drop the `.catch`.)

- [ ] **Step 2: Update the on-open `markAsRead` call**

The existing on-open `markAsRead(convId)` call now takes `isDirect`: change it to `markAsRead(convId, true)` in DirectMessageScreen (it's sync and instant — remove any `await`/`.catch`). `grep -n "markAsRead(" src/screens/DirectMessageScreen.tsx` to find it.

- [ ] **Step 3: Flush the watermark on unmount/blur (DirectMessageScreen)**

Add an effect near the subscribe effect:
```ts
  useEffect(() => {
    return () => {
      if (currentConversationId) flushReadWatermark(currentConversationId);
    };
  }, [currentConversationId, flushReadWatermark]);
```

- [ ] **Step 4: Mirror Steps 1–3 in `DirectGroupChat.tsx` — but pass `false` for `isDirect`** (groups never broadcast read receipts):
  - Per-message (line 664): `markReadRealtime(convId, newMessage.id, false);`
  - On-open: `markAsRead(convId, false);`
  - Unmount flush: identical to DirectMessageScreen.

  This gives groups the instant local unread-badge clear and the debounced durable watermark write (for the inbox badge + future group "seen by"), with **no** read-receipt broadcast. Since no group member broadcasts, the group read-receipt channel carries zero traffic.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: On-device verification**

- Open a chat from the other account; send messages rapidly → sender sees "Seen" with no added delay (broadcast still instant).
- Open a chat with several unread → badge clears instantly.
- In a fast burst, confirm via Supabase logs / network that there is **no per-message `getUnreadCount`** and at most ~1 `conversation_members` UPDATE per ~2s.
- **In a GROUP chat:** confirm there are **zero** `read_receipt` broadcasts (none sent, none received) while messages stream in — but the inbox unread badge still clears and the `last_read_at` watermark still persists.
- Background the app mid-chat, force-quit, relaunch → read position correct (watermark flushed on background). Confirm on a second device too.
- Inbox unread badges remain correct after leaving the chat.

- [ ] **Step 7: Commit (STAGE + hand off)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
# feat(messaging): use instant-broadcast realtime read marking in chat screens
```

---

## PHASE 3 — Long-conversation memory

### Task 3.1: Lower FlatList render budgets (both screens)

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx:3931-3933`
- Modify: `src/screens/DirectGroupChat.tsx:3865-3867`

- [ ] **Step 1: Change the three props (DirectMessageScreen)**

Replace lines 3931–3933:
```tsx
            initialNumToRender={20}
            maxToRenderPerBatch={15}
            windowSize={7}
```

- [ ] **Step 2: Same change in `DirectGroupChat.tsx`** (lines 3865–3867).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: On-device verification**

Open a busy chat; scroll up and down. Confirm scrolling is as smooth or smoother and no blank gaps appear during normal-speed scroll. (No memory cap yet — this is the zero-risk win.)

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
# perf(messaging): lower FlatList render budgets for chat threads
```

---

### Task 3.2: `capMessages` window helper (TDD)

**Files:**
- Create: `src/services/messaging/messageWindow.ts`
- Test: `src/services/messaging/__tests__/messageWindow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/messaging/__tests__/messageWindow.test.ts
import { capMessages, MAX_IN_MEMORY_MESSAGES } from '../messageWindow';

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` } as any));

describe('capMessages', () => {
  it('returns the array unchanged when at or under the cap', () => {
    const arr = make(10);
    expect(capMessages(arr, 50, 'tail')).toBe(arr);
  });

  it("dropFrom 'head' keeps the newest `max` (drops oldest)", () => {
    const arr = make(60); // chronological: m0 oldest ... m59 newest
    const out = capMessages(arr, 50, 'head');
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('m10');   // oldest 10 dropped
    expect(out[49].id).toBe('m59');  // newest kept
  });

  it("dropFrom 'tail' keeps the oldest `max` (drops newest)", () => {
    const arr = make(60);
    const out = capMessages(arr, 50, 'tail');
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('m0');    // oldest kept
    expect(out[49].id).toBe('m49');  // newest 10 dropped
  });

  it('exports a sane default cap', () => {
    expect(MAX_IN_MEMORY_MESSAGES).toBeGreaterThanOrEqual(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/messageWindow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/messaging/messageWindow.ts
import type { Message } from '../../types/messaging';

/** Max messages kept in a screen's in-memory array (chronological, oldest→newest). */
export const MAX_IN_MEMORY_MESSAGES = 250;

/**
 * Bound an in-memory chat array. `dropFrom: 'head'` keeps the newest `max`
 * (used when at the bottom receiving new messages); `'tail'` keeps the oldest
 * `max` (used when scrolling UP / prepending older — the newest end is far
 * off-screen). Returns the same reference when no trim is needed.
 */
export function capMessages(messages: Message[], max: number, dropFrom: 'head' | 'tail'): Message[] {
  if (messages.length <= max) return messages;
  return dropFrom === 'head' ? messages.slice(messages.length - max) : messages.slice(0, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/messageWindow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/messageWindow.ts src/services/messaging/__tests__/messageWindow.test.ts
# feat(messaging): add in-memory message window cap helper
```

---

### Task 3.3: Apply the cap + scroll anchoring (both screens)

**Files:**
- Modify: `package.json` (add `@stream-io/flat-list-mvcp` for Android anchoring)
- Modify: `src/screens/DirectMessageScreen.tsx` — `loadOlderMessages` (1347–1359), `onNewMessage` append (657–663), FlatList props (3899+), add `isNearBottomRef`
- Modify: `src/screens/DirectGroupChat.tsx` — equivalents

- [ ] **Step 1: Add the Android scroll-anchor dependency**

Run: `npx expo install @stream-io/flat-list-mvcp`
Expected: appears in `package.json`. (iOS uses RN-native `maintainVisibleContentPosition`; this package backfills Android.)

- [ ] **Step 2: Track near-bottom in `onScroll` (DirectMessageScreen)**

Add a ref near the others: `const isNearBottomRef = useRef(true);`
In the FlatList `onScroll` (lines 3920–3928), after computing `distanceFromTop`, add (inverted list: offset.y near 0 = bottom):
```ts
              isNearBottomRef.current = contentOffset.y < 200;
```

- [ ] **Step 3: Cap on prepend (drop newest tail) in `loadOlderMessages`**

Import at top: `import { capMessages, MAX_IN_MEMORY_MESSAGES } from '../services/messaging/messageWindow';`

In `loadOlderMessages`, change the merge (lines 1351–1358) to cap from the tail (we are scrolled up; newest are off-screen below):
```ts
          const merged = capMessages([...uniqueNew, ...prev], MAX_IN_MEMORY_MESSAGES, 'tail');
          chatHistoryCache.saveMessages(currentConversationId, merged).catch(err => {
            console.error('Error saving merged messages:', err);
          });
          return merged;
```
> Because we may drop the newest from memory here, set a flag so we know the window no longer ends at "latest": add `const hasNewerTrimmedRef = useRef(false);` near the other refs, and after the merge set `hasNewerTrimmedRef.current = merged.length === MAX_IN_MEMORY_MESSAGES && (uniqueNew.length + prev.length) > MAX_IN_MEMORY_MESSAGES;`

- [ ] **Step 4: Cap on append (drop oldest head) only when near bottom**

In the `onNewMessage` append (line 657), change:
```ts
              const appended = [...prev, newMessage];
              const updated = isNearBottomRef.current
                ? capMessages(appended, MAX_IN_MEMORY_MESSAGES, 'head')
                : appended;
              if (convId) {
                chatHistoryCache.saveMessages(convId, updated).catch(err => {
                  console.error('Error updating cache:', err);
                });
              }
              return updated;
```

- [ ] **Step 5: Add `maintainVisibleContentPosition` to the FlatList**

In the FlatList props (after `windowSize={7}`), add:
```tsx
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
```
> On Android, stock RN ignores this. Wire the MVCP package per its README (it provides a patched scroll component / hook). Follow `@stream-io/flat-list-mvcp` docs: typically import its `useMVCPScrollHandler`/component and apply only when `Platform.OS === 'android'`. Verify the exact API in `node_modules/@stream-io/flat-list-mvcp/README.md` after install and apply the minimal documented wiring. If integration proves invasive, keep `maintainVisibleContentPosition` (iOS-native) and gate the Android package behind a follow-up — note this in the commit.

- [ ] **Step 6: Reset to latest when scrolling to bottom after a tail-trim**

Find `scrollToBottom` (`grep -n "scrollToBottom" src/screens/DirectMessageScreen.tsx`). Wrap its body so that, if `hasNewerTrimmedRef.current`, it first reloads the latest window:
```ts
  const scrollToBottom = useCallback(async () => {
    if (hasNewerTrimmedRef.current && currentConversationId) {
      const result = await messagingService.getMessages(currentConversationId, 30);
      setMessages(result.messages);
      setHasMoreMessages(result.hasMore);
      oldestMessageIdRef.current = result.messages[0]?.id ?? null;
      hasNewerTrimmedRef.current = false;
    }
    // ...existing scroll-to-offset-0 behavior
  }, [currentConversationId /* + existing deps */]);
```
> Keep the existing scroll mechanics; only prepend the reload guard. If `scrollToBottom` is not a `useCallback`, adapt accordingly.

- [ ] **Step 7: Mirror Steps 2–6 in `DirectGroupChat.tsx`.**

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: On-device verification**

- In a 1000+ message thread, scroll far up: confirm scroll position does NOT jump as older pages load, and (via dev memory tooling / Sentry perf, or just sustained smoothness) memory stays bounded.
- Receive new messages while at the bottom → smooth, oldest silently trimmed.
- After scrolling far up, tap "scroll to bottom" → latest reloads correctly.

- [ ] **Step 10: Commit (STAGE + hand off)**

```bash
git add package.json package-lock.json src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
# perf(messaging): cap in-memory message window with viewport-safe pruning
```

---

### Task 3.4: `getMessagesAround` service query (TDD)

**Files:**
- Modify: `src/services/messaging/messagingService.ts` (add method after `getMessages`, ~line 803)
- Test: `src/services/messaging/__tests__/getMessagesAround.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/messaging/__tests__/getMessagesAround.test.ts
// Verifies getMessagesAround fetches a window centered on the target and
// returns a single chronological array (older + target + newer), enriched.
const queues: Record<string, { data: any; error: any }[]> = {};
const makeBuilder = (result: { data: any; error: any }) => {
  const b: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'lte', 'gt', 'in', 'single', 'maybeSingle']) b[m] = jest.fn(() => b);
  b.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
  return b;
};
jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: (t: string) => {
      const q = queues[t];
      if (!q || !q.length) throw new Error(`unexpected query on ${t}`);
      return makeBuilder(q.shift()!);
    },
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}));
import { messagingService } from '../messagingService';

describe('getMessagesAround', () => {
  beforeEach(() => { for (const k of Object.keys(queues)) delete queues[k]; });

  it('merges older + target + newer chronologically and enriches senders', async () => {
    const target = { id: 't', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T12:00:00Z', type: 'text' };
    const older = [{ id: 'o1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T11:00:00Z', type: 'text' }];
    const newer = [{ id: 'n1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T13:00:00Z', type: 'text' }];
    queues['messages'] = [
      { data: target, error: null },        // target lookup
      { data: [...older].reverse(), error: null }, // older (desc)
      { data: newer, error: null },         // newer (asc)
    ];
    queues['surfers'] = [{ data: [{ user_id: 'u2', name: 'Ana', profile_image_url: null }], error: null }];

    const out = await messagingService.getMessagesAround('c1', 't', 10);
    expect(out.messages.map(m => m.id)).toEqual(['o1', 't', 'n1']);
    expect(out.messages.find(m => m.id === 't')?.sender_name).toBe('Ana');
  });
});
```

> Adjust the `jest.mock` supabase path and the exact chained methods to match `getMessages`' real query style if needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/getMessagesAround.test.ts`
Expected: FAIL — `getMessagesAround is not a function`.

- [ ] **Step 3: Implement (mirrors `getMessages` enrichment)**

After `getMessages` (line 803), add:
```ts
  /**
   * Fetch a window of messages centered on a target message: `span` older +
   * the target + `span` newer, in chronological order, enriched with sender
   * info. Used by reply-jump so we can re-anchor the in-memory window without
   * paging through everything in between (Telegram-style "jump to message").
   */
  async getMessagesAround(
    conversationId: string,
    targetMessageId: string,
    span: number = 20
  ): Promise<{ messages: Message[]; hasMoreOlder: boolean }> {
    if (!isSupabaseConfigured()) throw new Error('Supabase is not configured');
    const cols = 'id, conversation_id, sender_id, body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, audio_metadata, commitment_metadata, reply_to_message_id, reply_to_snapshot';
    try {
      const { data: target } = await supabase
        .from('messages').select('created_at').eq('id', targetMessageId).single();
      if (!target) return { messages: [], hasMoreOlder: false };

      const { data: olderDesc } = await supabase
        .from('messages').select(cols)
        .eq('conversation_id', conversationId)
        .lte('created_at', target.created_at)
        .order('created_at', { ascending: false })
        .limit(span + 1); // +1 to detect more-older

      const { data: newerAsc } = await supabase
        .from('messages').select(cols)
        .eq('conversation_id', conversationId)
        .gt('created_at', target.created_at)
        .order('created_at', { ascending: true })
        .limit(span);

      const hasMoreOlder = (olderDesc?.length ?? 0) > span;
      const olderTrimmed = (olderDesc ?? []).slice(0, span).reverse(); // chronological, includes target
      const merged = [...olderTrimmed, ...(newerAsc ?? [])];

      const senderIds = [...new Set(merged.map(m => m.sender_id))];
      if (senderIds.length === 0) return { messages: merged as Message[], hasMoreOlder };
      const { data: surfersData } = await supabase
        .from('surfers').select('user_id, name, profile_image_url').in('user_id', senderIds);
      const surferMap = new Map((surfersData ?? []).map(s => [s.user_id, s]));
      return {
        messages: merged.map(m => ({
          ...m,
          sender_name: surferMap.get(m.sender_id)?.name,
          sender_avatar: surferMap.get(m.sender_id)?.profile_image_url,
        })) as Message[],
        hasMoreOlder,
      };
    } catch (error) {
      console.error('Error fetching messages around target:', error);
      throw error;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/getMessagesAround.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (STAGE + hand off)**

```bash
git add src/services/messaging/messagingService.ts src/services/messaging/__tests__/getMessagesAround.test.ts
# feat(messaging): add getMessagesAround for reply-jump window re-anchor
```

---

### Task 3.5: Reply-jump → fetch-around + "Return to latest" (both screens)

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx` — `handleReplyPreviewPress` (2685–2727), add a "Return to latest" pill
- Modify: `src/screens/DirectGroupChat.tsx` — `handleReplyPreviewPress` (~2620–2655) + pill

- [ ] **Step 1: Replace the page-until-found loop (DirectMessageScreen)**

Replace `handleReplyPreviewPress` (lines 2685–2727) with:
```ts
  const handleReplyPreviewPress = useCallback(async (parentMessageId: string) => {
    if (resolvingReplyJumpId || !currentConversationId) return;

    const findInvertedIndex = (id: string): number => {
      const arr = messagesRef.current;
      const chronoIdx = arr.findIndex((m) => m.id === id);
      return chronoIdx === -1 ? -1 : arr.length - 1 - chronoIdx;
    };

    let invertedIndex = findInvertedIndex(parentMessageId);

    if (invertedIndex === -1) {
      // Not in the current window: re-anchor instead of paging through history.
      setResolvingReplyJumpId(parentMessageId);
      try {
        const result = await messagingService.getMessagesAround(currentConversationId, parentMessageId, 20);
        if (result.messages.length === 0) {
          Alert.alert('Mensaje no disponible', 'No pudimos encontrar el mensaje original.');
          return;
        }
        setMessages(result.messages);
        setHasMoreMessages(result.hasMoreOlder);
        oldestMessageIdRef.current = result.messages[0]?.id ?? null;
        hasNewerTrimmedRef.current = true; // window no longer ends at latest
        // wait for the new window to lay out before scrolling
        await new Promise<void>((r) => setTimeout(r, 0));
        invertedIndex = findInvertedIndex(parentMessageId);
      } catch {
        Alert.alert('Mensaje no disponible', 'No pudimos encontrar el mensaje original.');
        return;
      } finally {
        setResolvingReplyJumpId(null);
      }
    }

    if (invertedIndex === -1) return;
    setHighlightedMessageId(parentMessageId);
    flatListRef.current?.scrollToIndex({ index: invertedIndex, viewPosition: 0.5, animated: true });
  }, [resolvingReplyJumpId, currentConversationId]);
```
(The existing `onScrollToIndexFailed` retry at lines 3938–3946 covers the case where the target isn't laid out yet.)

- [ ] **Step 2: Add a "Return to latest" pill**

When `hasNewerTrimmedRef.current` is true the view is not at the latest. Drive it with state so it renders: add `const [showReturnToLatest, setShowReturnToLatest] = useState(false);`, set it `true` right after `hasNewerTrimmedRef.current = true` in Step 1, and set it `false` inside `scrollToBottom`'s reload guard (Task 3.3 Step 6). Render a small pill above the composer:
```tsx
{showReturnToLatest && (
  <TouchableOpacity style={styles.returnToLatestPill} onPress={() => { scrollToBottom(); }}>
    <Text style={styles.returnToLatestText}>Return to latest ↓</Text>
  </TouchableOpacity>
)}
```
Add styles:
```ts
  returnToLatestPill: { position: 'absolute', alignSelf: 'center', bottom: 90, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#111' },
  returnToLatestText: { ...ff('Poppins', '600'), color: '#fff', fontSize: 13 },
```
> Match the existing font family (per Task 1.3 note) and place the pill inside the screen's main container (sibling of the FlatList), not inside the inverted list.

- [ ] **Step 3: Mirror Steps 1–2 in `DirectGroupChat.tsx`.**

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: On-device verification**

- Tap a quoted reply pointing to a very old message → it jumps without loading all intermediate history; memory stays bounded.
- The "Return to latest" pill appears after a jump; tapping it reloads the latest and hides the pill.
- Reply-jump to a message already on screen still works (no refetch).

- [ ] **Step 6: Commit (STAGE + hand off)**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
# feat(messaging): reply-jump re-anchors via getMessagesAround + return-to-latest
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `npx jest`
Expected: all suites pass (new: withTimeout, messageSanitizer, readWatermark, readWatermarkQueue, messageWindow, getMessagesAround; plus existing suites unchanged).

- [ ] **Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **On-device smoke across all three phases** (per the per-phase steps above), on both a 1:1 DM and a group chat.

- [ ] **Hand the branch to Ohad for review** — he commits/merges manually.

---

## Self-review notes (coverage map)

- Cross-review (`messaging-reviews-compared.html`) send-timeout freeze → Phase 0 (Tasks 0.1–0.3). Verified real: `messagingService.sendMessage` had no timeout → stuck `isLoading` → permanently disabled send button + forever-spinning media bubbles. ✓
- Cross-review items deliberately NOT added (per Ohad): ConversationsScreen virtualization (real, perf, deferred), CommitmentReviewBar.doApprove missing catch (minor). "Lost-connection fix not shipped" was NOT real — DM reconnect/catch-up is in-tree and active.
- Spec §Phase 1 (edge validation / screen boundary / per-item boundary) → Tasks 1.1–1.6. ✓
- Spec §Phase 2 (instant broadcast, drop SELECT + getUnreadCount, debounced persist, flush on blur/unmount/background) → Tasks 2.1–2.4. ✓
- Read receipts gated to 1:1 only (`readReceiptsEnabled(isDirect)`); groups skip the broadcast (zero fan-out) but keep local-unread + watermark persist. Forward-compatible: enabling group "seen by" later is a one-line flip, new-messages-only, no schema change (uses `conversation_members.last_read_at`). → Task 2.3 gate + Task 2.4 pass `false` for groups. ✓
- Spec §Phase 3 (FlatList 20/15/7, cap 250 + viewport-safe prune + maintainVisibleContentPosition, reply-jump fetch-around) → Tasks 3.1–3.5. ✓
- New deps (`react-error-boundary`, `@stream-io/flat-list-mvcp`) installed in 1.1 and 3.3. ✓
- No DB schema changes, no Edge Functions, broadcast transport unchanged. ✓
- Known residual risk: Android `maintainVisibleContentPosition` depends on the MVCP package's exact API (verified at install in 3.3 Step 5) — flagged, with an iOS-only fallback path.
