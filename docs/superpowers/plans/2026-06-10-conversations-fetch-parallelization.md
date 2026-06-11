# Conversations Fetch Parallelization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the chat-list server fetch (`messagingService.getConversations`) from a 9-deep sequential request waterfall to a 5-deep one by running independent queries concurrently — with **zero behavior change**.

**Architecture:** `getConversations` issues ~9 Supabase queries strictly one-after-another, but only 5 dependency levels actually exist. We add a characterization test that pins today's exact output, then regroup the queries into `Promise.all` stages along the real dependency edges. Every query expression, every error-handling branch, and all assembly logic stay byte-identical.

**Tech Stack:** TypeScript, supabase-js v2, jest + jest-expo (config already in repo: `jest.config.js`).

---

## Background / Evidence

- Observed: `📥 Fetched 50 conversations from server in 19016ms` on iOS simulator (dev mode, congested cold boot).
- Verified via `pg_stat_statements`: **none** of this function's queries are slow in Postgres (all sub-50ms means). The time is client-side round-trip waterfall + boot congestion.
- The function: `src/services/messaging/messagingService.ts:309-571`.

### Current sequential queries and their REAL dependencies

| # | Query | Needs |
|---|-------|-------|
| 1 | `auth.getSession()` | — (local storage, no network) |
| 2 | `auth.getUser()` | session check |
| 3 | `conversation_members` (my memberships) | user.id |
| 4 | `conversations` page (order by updated_at, range) | ids from 3 |
| 5 | RPC `get_last_messages_per_conversation` | conversationIds from 4 |
| 6 | `conversation_members` (all members of page) | conversationIds from 4 |
| 7 | `conversation_members` (my last_read_at per conv) | conversationIds from 4 |
| 8 | `users` + `surfers` (already a parallel pair) | userIds from 6 |
| 9 | `messages` (potential unreads since cutoff) | conversationIds from 4 **and** cutoffDate derived from 7 |

Target stages: `1 → 2 → 3 → 4 → [5‖6‖7] → [8‖9]`. Network depth 8 → 5.

## Hard Success Criterion

**Success = nothing breaks.** Performance gain without regression. These invariants must hold exactly:

1. Returned object shape `{ conversations, hasMore }` is identical for identical server data — order, `unread_count`, `unread_truncated`, `other_user`, enriched `members` (name fallback chain: surfer name → email prefix → `'Unknown'`), `last_message`.
2. Early returns unchanged: not configured → throw; no session → `{[], false}` with **no further queries**; no user → same; zero memberships → same; empty page → same.
3. `hasMore` semantics unchanged (`range(offset, offset+limit)` fetches limit+1; `receivedCount > limit`).
4. Partial-failure behavior unchanged: errors on queries 5, 6, 7, 9 are logged via `console.error` and processing continues with empty data; errors on 3 or 4 throw. (Supabase builders resolve `{data, error}` — they never reject — so `Promise.all` over them cannot short-circuit. This preserves the non-fatal semantics for free.)
5. The unread algorithm unchanged: cutoff = oldest non-null `last_read_at` (epoch if none), `UNREAD_MESSAGES_LIMIT = 1000` truncation + `unread_truncated` flag, per-conversation JS filtering against each conv's own `last_read_at`, null `last_read_at` → all fetched count.
6. Query 7 is **kept** even though its rows are a subset of query 6's. Deriving it from 6 would change the partial-failure matrix (6 fails + 7 succeeds is currently survivable). Removing it is explicitly out of scope.

## Timing situations & edge cases the plan must survive

| Situation | Why it's safe after the change |
|---|---|
| Token expires mid-function; stage D fires 3 concurrent requests needing refresh | supabase-js single-flights token refresh internally; the app already issues concurrent queries elsewhere (query 8 is a `Promise.all` pair today) |
| User logs out between stages | Same as today: queries return RLS-empty/error data; non-fatal branches produce empty enrichment; no new throw paths introduced |
| Pagination (`loadMoreConversations`, offset > 0) | Same function, same params, ordering and hasMore logic untouched |
| Pull-to-refresh / foreground refetch racing a `handleInboxChange` sync | Output is consumed by the reducer's `REPLACE_ALL` smart merge — unchanged; internal parallelism is invisible to callers |
| Conversation with no messages | RPC returns no row → `last_message: undefined` — unchanged |
| Direct conv where other member left (only me) | `other_user: undefined` — unchanged (`find` on members ≠ me) |
| All `last_read_at` null | cutoff = epoch — unchanged code path |
| >1000 potential unread rows | truncation + `unread_truncated` — unchanged code path |
| Member with no surfer row / empty name | email-prefix / `'Unknown'` fallbacks — unchanged code path |
| Slow vs fast query resolution order within a stage | Results destructured positionally from `Promise.all`; no logic depends on arrival order |

## Out of scope (do NOT do in this plan)

- Removing redundant query 7 (behavior-change risk under partial failure).
- Parallelizing 1+2 (`getSession` is local; saving ≈ 0, and calling `getUser` while logged out is a new behavior).
- Deferring boot-time avatar prefetch / chat-history cache writes (separate follow-up).
- `getConversationsUpdatedSince` (already internally parallel).
- Server-side consolidation into one RPC (future scale work).

## File Structure

- **Test (create):** `src/services/messaging/__tests__/getConversations.characterization.test.ts` — pins current behavior; written and green BEFORE any refactor.
- **Modify:** `src/services/messaging/messagingService.ts:309-571` only (`getConversations`). No other function, no callers, no types change.

> **Workflow note:** Ohad reviews and commits manually. Wherever this plan says "checkpoint", stop and present the diff — do not run `git commit`.

---

### Task 1: Characterization test (pins today's behavior)

**Files:**
- Create: `src/services/messaging/__tests__/getConversations.characterization.test.ts`

- [ ] **Step 1: Write the test** (against CURRENT code — it must pass before any refactor)

```typescript
/**
 * Characterization tests for messagingService.getConversations.
 *
 * These pin the CURRENT observable behavior (shape, ordering, unread math,
 * enrichment fallbacks, early returns) so the fetch-parallelization refactor
 * can be verified to change nothing. The supabase mock dispatches fixtures
 * per-table in FIFO order — the refactor keeps the relative creation order
 * of query builders (see plan), so the queues stay valid.
 */
type Result = { data: any; error: any };

const tableQueues: Record<string, Result[]> = {};
const rpcQueue: Result[] = [];
let authSession: any = null;
let authUser: any = null;

const makeBuilder = (result: Result) => {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'neq', 'gt', 'limit', 'maybeSingle', 'single']) {
    b[m] = jest.fn(() => b);
  }
  b.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
};

const fromMock = jest.fn((table: string) => {
  const queue = tableQueues[table];
  if (!queue || queue.length === 0) {
    throw new Error(`Unexpected query on table "${table}" — queue empty`);
  }
  return makeBuilder(queue.shift()!);
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: authSession }, error: null })),
      getUser: jest.fn(async () => ({ data: { user: authUser } })),
    },
    from: (table: string) => fromMock(table),
    rpc: jest.fn(() => {
      if (rpcQueue.length === 0) throw new Error('Unexpected rpc call — queue empty');
      return makeBuilder(rpcQueue.shift()!);
    }),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import { messagingService } from '../messagingService';

const seedHappyPathFixtures = () => {
  authSession = { access_token: 't' };
  authUser = { id: 'me' };
  tableQueues['conversation_members'] = [
    // q3: my memberships
    { data: [{ conversation_id: 'c1' }, { conversation_id: 'c2' }], error: null },
    // q6: all members of the page
    {
      data: [
        { conversation_id: 'c1', user_id: 'me', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: '2026-06-09T09:00:00Z', preferences: null },
        { conversation_id: 'c1', user_id: 'u2', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
        { conversation_id: 'c2', user_id: 'me', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
        { conversation_id: 'c2', user_id: 'u2', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
        { conversation_id: 'c2', user_id: 'u3', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
      ],
      error: null,
    },
    // q7: my read state per conversation
    {
      data: [
        { conversation_id: 'c1', last_read_at: '2026-06-09T09:00:00Z' },
        { conversation_id: 'c2', last_read_at: null },
      ],
      error: null,
    },
  ];
  tableQueues['conversations'] = [
    // q4: the page (already server-ordered by updated_at desc)
    {
      data: [
        { id: 'c1', title: null, is_direct: true, metadata: null, created_by: 'me', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-09T10:00:00Z' },
        { id: 'c2', title: 'Bali crew', is_direct: false, metadata: null, created_by: 'u2', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-08T10:00:00Z' },
      ],
      error: null,
    },
  ];
  rpcQueue.push({
    // q5: last message per conversation
    data: [
      { id: 'm1', conversation_id: 'c1', sender_id: 'u2', body: 'hey', created_at: '2026-06-09T10:00:00Z' },
      { id: 'm2', conversation_id: 'c2', sender_id: 'u3', body: 'yo', created_at: '2026-06-08T10:00:00Z' },
    ],
    error: null,
  });
  tableQueues['users'] = [
    { data: [{ id: 'me', email: 'me@x.com' }, { id: 'u2', email: 'u2@x.com' }, { id: 'u3', email: 'u3@x.com' }], error: null },
  ];
  tableQueues['surfers'] = [
    // u3 has empty name -> email-prefix fallback; 'me' absent -> email-prefix fallback
    { data: [{ user_id: 'u2', name: 'Maya', profile_image_url: 'http://img/u2.jpg' }, { user_id: 'u3', name: '', profile_image_url: null }], error: null },
  ];
  tableQueues['messages'] = [
    // q9: potential unreads since cutoff (cutoff = 2026-06-09T09:00:00Z, the only non-null last_read_at)
    {
      data: [
        // newer than c1's last_read -> counts for c1
        { id: 'm1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-09T10:00:00Z' },
        // older than c1's last_read -> must be filtered OUT by the JS per-conv check
        { id: 'mOld', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-09T08:00:00Z' },
        // c2 has null last_read -> everything fetched counts
        { id: 'm2', conversation_id: 'c2', sender_id: 'u3', created_at: '2026-06-08T10:00:00Z' },
      ],
      error: null,
    },
  ];
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  rpcQueue.length = 0;
  authSession = null;
  authUser = null;
});

describe('getConversations characterization', () => {
  it('assembles the page exactly as today (order, unread, enrichment, hasMore)', async () => {
    seedHappyPathFixtures();
    const { conversations, hasMore } = await messagingService.getConversations(50, 0);

    expect(hasMore).toBe(false);
    expect(conversations.map((c: any) => c.id)).toEqual(['c1', 'c2']);

    const c1: any = conversations[0];
    expect(c1.unread_count).toBe(1);            // m1 counted, mOld filtered by per-conv last_read
    expect(c1.unread_truncated).toBe(false);
    expect(c1.last_message.id).toBe('m1');
    expect(c1.other_user.user_id).toBe('u2');   // direct conv -> other member
    expect(c1.other_user.name).toBe('Maya');    // surfer name wins
    expect(c1.members).toHaveLength(2);
    expect(c1.members.find((m: any) => m.user_id === 'me').name).toBe('me'); // email-prefix fallback

    const c2: any = conversations[1];
    expect(c2.unread_count).toBe(1);            // null last_read -> fetched message counts
    expect(c2.last_message.id).toBe('m2');
    expect(c2.other_user).toBeUndefined();      // group conv
    expect(c2.members).toHaveLength(3);
    expect(c2.members.find((m: any) => m.user_id === 'u3').name).toBe('u3'); // empty surfer name -> email prefix
  });

  it('returns hasMore=true when the range returns limit+1 rows', async () => {
    seedHappyPathFixtures();
    // limit=1: q4 returns 2 rows -> hasMore, page sliced to 1.
    // Downstream fixtures still dispatch fine: enrichment only reads what it looks up.
    const { conversations, hasMore } = await messagingService.getConversations(1, 0);
    expect(hasMore).toBe(true);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('c1');
  });

  it('returns empty without issuing table queries when there is no session', async () => {
    authSession = null;
    authUser = null;
    const result = await messagingService.getConversations(50, 0);
    expect(result).toEqual({ conversations: [], hasMore: false });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('survives a failed last-messages RPC exactly as today (no last_message, no throw)', async () => {
    seedHappyPathFixtures();
    rpcQueue.length = 0;
    rpcQueue.push({ data: null, error: { message: 'boom' } });
    const { conversations } = await messagingService.getConversations(50, 0);
    expect(conversations).toHaveLength(2);
    expect(conversations[0].last_message).toBeUndefined();
    expect(conversations[0].unread_count).toBe(1); // unrelated pipeline unaffected
  });
});
```

- [ ] **Step 2: Run it — must PASS against the current, untouched code**

Run: `npx jest src/services/messaging/__tests__/getConversations.characterization.test.ts -v`
Expected: 4 passing. If module-level imports of `messagingService.ts` crash under jest, mock the offending module at the top of the test file the same way AsyncStorage is mocked — do NOT modify production code to make the test pass.

- [ ] **Step 3: Checkpoint — show Ohad the new test file (no production code touched yet)**

---

### Task 2: Dev-only stage timing instrumentation

**Files:**
- Modify: `src/services/messaging/messagingService.ts:314` (top of `try` in `getConversations`) + one line per stage + one summary line before `return`

- [ ] **Step 1: Add the timer helpers at the top of the `try` block (immediately after line `try {`)**

```typescript
      const tStart = Date.now();
      let tPrev = tStart;
      const stageTimes: string[] = [];
      const markStage = (label: string) => {
        const now = Date.now();
        stageTimes.push(`${label}=${now - tPrev}ms`);
        tPrev = now;
      };
```

- [ ] **Step 2: Add `markStage(...)` calls after each await completes**

After the `getUser` block: `markStage('auth');`
After the memberships query: `markStage('memberships');`
After the paged conversations query: `markStage('page');`
After the last-messages RPC: `markStage('lastMessages');`
After the all-members query: `markStage('members');`
After the user-read query: `markStage('readState');`
After the users+surfers `Promise.all`: `markStage('profiles');`
After the unread-messages query: `markStage('unread');`

- [ ] **Step 3: Add the summary log immediately before `return { conversations: enrichedConversations, hasMore };`**

```typescript
      if (__DEV__) {
        console.log(`[messagingService] getConversations stages: total=${Date.now() - tStart}ms :: ${stageTimes.join(' ')}`);
      }
```

- [ ] **Step 4: Verify tests still pass**

Run: `npx jest src/services/messaging/__tests__/getConversations.characterization.test.ts -v`
Expected: 4 passing.

- [ ] **Step 5: Record the BASELINE on the iOS simulator**

Reload the app cold (kill + reopen), copy the stages line from Metro logs into this plan file under "Results". This is the before-number.

- [ ] **Step 6: Checkpoint — show Ohad the diff + baseline numbers**

---

### Task 3: Parallelize stage D — queries 5, 6, 7 together

**Files:**
- Modify: `src/services/messaging/messagingService.ts:366-419` (the three sequential awaits become one `Promise.all`)

- [ ] **Step 1: Replace the three sequential queries with one `Promise.all`**

Replace this block (current lines ~366-414, comments included — keep them):

```typescript
      const { data: lastMessages, error: messagesError } = await supabase
        .rpc('get_last_messages_per_conversation', {
          conv_ids: conversationIds
        });
      ...
      const { data: allMembersData, error: allMembersError } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id, role, joined_at, last_read_message_id, last_read_at, preferences')
        .in('conversation_id', conversationIds);
      ...
      const { data: userMemberData, error: userMemberError } = await supabase
        .from('conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id)
        .in('conversation_id', conversationIds);
```

with (NOTE: array order = original sequential order — the characterization mock dispatches per-table FIFO and `conversation_members` is queried twice here):

```typescript
      // Queries 5, 6, 7 each depend only on conversationIds — run them
      // concurrently. Supabase builders resolve {data, error} and never
      // reject, so Promise.all cannot short-circuit and each error keeps
      // its original non-fatal handling below. Array order intentionally
      // matches the old sequential order (conversation_members is queried
      // twice; relative order is observable).
      const [lastMessagesRes, allMembersRes, userMemberRes] = await Promise.all([
        supabase.rpc('get_last_messages_per_conversation', { conv_ids: conversationIds }),
        supabase
          .from('conversation_members')
          .select('conversation_id, user_id, role, joined_at, last_read_message_id, last_read_at, preferences')
          .in('conversation_id', conversationIds),
        supabase
          .from('conversation_members')
          .select('conversation_id, last_read_at')
          .eq('user_id', user.id)
          .in('conversation_id', conversationIds),
      ]);
      const { data: lastMessages, error: messagesError } = lastMessagesRes;
      const { data: allMembersData, error: allMembersError } = allMembersRes;
      const { data: userMemberData, error: userMemberError } = userMemberRes;
      markStage('lastMessages+members+readState');
```

Keep every `if (...Error) { console.error(...) }` branch and every map-building block (lastMessagesMap, allUserIds/userIdsArray, userReadMap) exactly where and as they are today — only the awaits move. Remove the three now-redundant individual `markStage('lastMessages'/'members'/'readState')` calls from Task 2.

- [ ] **Step 2: Run the characterization tests**

Run: `npx jest src/services/messaging/__tests__/getConversations.characterization.test.ts -v`
Expected: 4 passing — proving identical output and identical query parameters.

- [ ] **Step 3: Checkpoint — show Ohad the diff**

---

### Task 4: Parallelize stage E — queries 8 and 9 together

**Files:**
- Modify: `src/services/messaging/messagingService.ts` — the users/surfers `Promise.all` (~line 423) and the unread-messages query (~line 467) merge into one `Promise.all`

- [ ] **Step 1: Move the cutoff computation ABOVE the merged Promise.all, then merge**

The cutoff math (currently between queries 8 and 9) only needs `userReadMap` — available after stage D. Move this block, unchanged, to just before the new `Promise.all`:

```typescript
      const lastReadAtValues = Array.from(userReadMap.values()).filter(ts => ts !== null);
      const oldestLastReadAt = lastReadAtValues.length > 0
        ? Math.min(...lastReadAtValues.map(ts => new Date(ts!).getTime()))
        : 0;
      const cutoffDate = oldestLastReadAt > 0
        ? new Date(oldestLastReadAt).toISOString()
        : new Date(0).toISOString();
      const UNREAD_MESSAGES_LIMIT = 1000;
```

Then replace the two awaits with:

```typescript
      // Queries 8 (profiles, needs userIds from q6) and 9 (unreads, needs
      // cutoff from q7) are independent of each other — run concurrently.
      const [usersResult, surfersResult, unreadResult] = await Promise.all([
        supabase
          .from('users')
          .select('id, email')
          .in('id', userIdsArray),
        supabase
          .from('surfers')
          .select('user_id, name, profile_image_url')
          .in('user_id', userIdsArray),
        supabase
          .from('messages')
          .select('id, conversation_id, sender_id, created_at')
          .in('conversation_id', conversationIds)
          .eq('deleted', false)
          .neq('sender_id', user.id)
          .gt('created_at', cutoffDate)
          .limit(UNREAD_MESSAGES_LIMIT),
      ]);
      const { data: unreadMessages, error: unreadError } = unreadResult;
      markStage('profiles+unread');
```

Keep `usersData`/`surfersData`/`usersMap`/`surfersMap` construction, the `unreadCountMap` initialization loop, the truncation logic, and the per-message counting loop byte-identical and in their current relative order. Remove the now-redundant `markStage('profiles')` / `markStage('unread')` calls.

- [ ] **Step 2: Run the characterization tests**

Run: `npx jest src/services/messaging/__tests__/getConversations.characterization.test.ts -v`
Expected: 4 passing.

- [ ] **Step 3: Run the full test suite (regression sweep)**

Run: `npx jest`
Expected: everything that passed before this plan still passes.

- [ ] **Step 4: Checkpoint — show Ohad the diff**

---

### Task 5: On-device verification + results

**Files:** none (manual verification on iOS simulator, two dev accounts)

- [ ] **Step 1: Cold start with empty cache** — delete the app from the simulator, reinstall via Metro, log in. Chat list loads, ordered by recency, correct previews/names/avatars/badges. Copy the new `getConversations stages:` line — compare with Task 2 baseline.
- [ ] **Step 2: Warm start** — kill + reopen. Cache path (`Cache is fresh — skipping server fetch`) still works; list appears instantly.
- [ ] **Step 3: Unread flow** — account B sends a DM; A's list shows badge +1 and the conversation jumps to top; A opens it; back to list → badge cleared.
- [ ] **Step 4: Group chat** — B sends in a shared group; same checks as step 3.
- [ ] **Step 5: Pagination** — scroll to the bottom of the list; older conversations load (offset path uses the same function).
- [ ] **Step 6: Reconnect** — toggle network off ~30s, back on; list resyncs without duplicates or badge corruption.
- [ ] **Step 7: Record results** — paste before/after stage timings into the "Results" section below.
- [ ] **Step 8: Checkpoint — final review with Ohad, who commits manually**

---

### Task 6: Decide the fate of the timing log

- [ ] **Step 1:** If Ohad wants to keep monitoring: it's already `__DEV__`-gated, zero prod cost — keep. Otherwise delete the `tStart/tPrev/stageTimes/markStage` lines and the summary log, then rerun `npx jest src/services/messaging/__tests__/getConversations.characterization.test.ts -v` (expected: 4 passing).

---

## Results

- Baseline (before this plan, congested cold boot, iOS simulator): `Fetched 50 conversations from server in 19016ms`. (Note: partially inflated by the unread-badge render storm fixed the same day in MessagingProvider — the 85-dispatch loop was starving the JS thread during the fetch.)
- After (Tasks 3+4 applied, iOS simulator, 2026-06-10): `total=2420ms :: auth=723ms memberships=433ms page=268ms lastMessages+members+readState=628ms profiles+unread=368ms`
- ~8× faster end to end. Stage merges working as designed: 3 round-trips → 628ms combined, 2 round-trips → 368ms combined.
- Timing log KEPT (dev-only, zero prod cost) for ongoing monitoring.
- Next biggest target if ever needed: `auth=723ms` (getSession + getUser network validation) — a behavior-change optimization, out of scope here (see follow-up 2).

## Follow-up candidates (separate plans, NOT this one)

1. Defer boot-time avatar prefetching + per-conversation chat-history cache writes until after first paint (they compete with the fetch for the JS thread and network).
2. Server-side: single RPC returning the fully-joined page (cuts depth 5 → 1) — the real fix at scale, but a behavior-risk change that deserves its own characterization-tested plan.
3. Investigate why a cold dev boot is congested enough to stretch this to 19s (Metro/dev-mode overhead vs production build measurement).
