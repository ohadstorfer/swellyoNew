# Supabase Request Timeout ("Unjam the Line") Implementation Plan

> **⚠️ DIAGNOSIS CORRECTION (2026-07-24):** This plan repeatedly says auth calls
> hold "an internal lock" that every other request waits on. That lock mechanism
> was verified in auth-js **2.80.0** (builds ≤44) but is **disabled by default in
> 2.110.7**, which ships in builds 45/46 (`this.lock = null`). Wherever this doc
> says "the lock is released", read: "the request aborts". The fix is still
> correct and still needed — RN's fetch has no default timeout, and 2.110.7 still
> funnels every call through a shared init promise + single-flight token refresh,
> so one stuck request can still stall the app. Only the *named mechanism* was
> wrong. Full analysis: memory `freeze-theories-status-2026-07-23`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No Supabase request can ever wait forever. A stuck request dies after a time limit, the app recovers on its own, and Sentry quietly tells us it happened.

## Spec (plain English)

**The problem (2026-07-23 incident, verified):** supabase-js requests have no time limit. On bad cell signal a request can wait forever. Worse: auth calls (`getUser`, sometimes `getSession`) hold an internal lock while they wait — and every other Supabase request in the app waits for that lock. One stuck request = the whole app stops getting data. A real user got a blank profile and a frozen Trips tab this way.

**The fix (3 parts):**
1. **Time limit on every request.** Give the Supabase client a custom `fetch` that aborts after 25 seconds (5 minutes for storage uploads/downloads so big files aren't killed). When a request is aborted, it throws a normal error → the auth lock is released → existing `catch`/`finally` code runs → the app recovers.
2. **Watchdog.** When a request times out, send one quiet Sentry warning (at most one per minute) so we hear about it without user screenshots. Never include query strings in the report (they can carry tokens).
3. **Fail-open boot guards.** Two places gate the whole app on one await. Give each a 10-second race that gives up and lets the user in. The auth guard still catches genuinely dead sessions later.

**Explicitly out of scope (and why):**
- WelcomeScreen Apple button: its `catch` already resets the button; part 1 makes the hang become an error, so it self-heals. No change needed.
- ProfileScreen `refreshMyProfile` residual: bounded by part 1 automatically.
- The ~40 medium action-level `getUser()` call sites: all bounded by part 1 automatically.

**Acceptance criteria:**
- A never-answering request rejects within 25s (300s for `/storage/v1/` URLs). Proven by unit test.
- A timed-out request produces a Sentry warning with the URL path only (no query string). Proven by unit test.
- App boot proceeds within ~10s even if `getSession()` or the onboarding DB check hangs. Proven by reading the code (no device test available; Ohad tests on device).
- `npx tsc --noEmit` introduces no new errors (baseline: 173 pre-existing).

**Architecture:** One new pure utility file (`supabaseFetchWithTimeout`) with unit tests; one-line wiring into the existing `createClient`; two small `Promise.race` guards in existing boot code; one comment correction.

**Tech Stack:** React Native / Expo 54, supabase-js v2, `@sentry/react-native` (already initialized in App.tsx), jest (`jest-expo`).

## Global Constraints

- **Do NOT commit.** Ohad reviews and commits manually. Every "commit" step in the normal template is replaced by "leave uncommitted".
- JS-only changes (OTA-able). No native modules, no new dependencies.
- No simulator/Maestro testing — verify with `tsc` + jest only; Ohad tests on device.
- Plain short English in all comments and docs.
- Sentry calls must be wrapped in try/catch (Sentry is dead in Expo Go; a throwing reporter must never break a request).

---

### Task 1: The timeout fetch wrapper (with watchdog)

**Files:**
- Create: `src/utils/supabaseFetchWithTimeout.ts`
- Test: `src/utils/__tests__/supabaseFetchWithTimeout.test.ts`

**Interfaces:**
- Consumes: global `fetch`, `@sentry/react-native` (`captureMessage`).
- Produces: `supabaseFetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response>` — drop-in `fetch` replacement. Also exports `timeoutForUrl(url: string): number` and `DEFAULT_TIMEOUT_MS` / `STORAGE_TIMEOUT_MS` for the tests.

- [x] **Step 1: Write the failing tests**

```ts
// src/utils/__tests__/supabaseFetchWithTimeout.test.ts
import {
  supabaseFetchWithTimeout,
  timeoutForUrl,
  DEFAULT_TIMEOUT_MS,
  STORAGE_TIMEOUT_MS,
  __resetReportThrottleForTests,
} from '../supabaseFetchWithTimeout';

jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import * as Sentry from '@sentry/react-native';

// A fetch that never answers, but rejects if aborted (like RN's real fetch).
const hangingFetch = jest.fn((_input: any, init?: any) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new Error('Aborted')),
    );
  }),
);

describe('supabaseFetchWithTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).fetch = hangingFetch;
    hangingFetch.mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
    __resetReportThrottleForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('picks 25s for normal urls and 300s for storage urls', () => {
    expect(timeoutForUrl('https://x.supabase.co/rest/v1/surfers')).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutForUrl('https://x.supabase.co/auth/v1/user')).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutForUrl('https://x.supabase.co/storage/v1/object/videos/a.mp4')).toBe(STORAGE_TIMEOUT_MS);
  });

  it('rejects a hung request after the default timeout', async () => {
    const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers?select=*');
    const check = expect(p).rejects.toThrow(/timed out/i);
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
    await check;
  });

  it('does NOT kill a storage request at 25s', async () => {
    let settled = false;
    const p = supabaseFetchWithTimeout('https://x.supabase.co/storage/v1/object/videos/a.mp4');
    p.then(() => { settled = true; }, () => { settled = true; });
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
    await Promise.resolve(); // flush microtasks
    expect(settled).toBe(false);
    jest.advanceTimersByTime(STORAGE_TIMEOUT_MS); // let it finish so jest is clean
    await expect(p).rejects.toThrow(/timed out/i);
  });

  it('passes through a normal response untouched', async () => {
    const okResponse = { ok: true } as Response;
    (global as any).fetch = jest.fn(async () => okResponse);
    await expect(
      supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers'),
    ).resolves.toBe(okResponse);
  });

  it('reports a timeout to Sentry without the query string', async () => {
    const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers?apikey=SECRET');
    const check = expect(p).rejects.toThrow();
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
    await check;
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const msg = (Sentry.captureMessage as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('/rest/v1/surfers');
    expect(msg).not.toContain('SECRET');
  });

  it('throttles Sentry reports to one per minute', async () => {
    for (let i = 0; i < 3; i++) {
      const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers');
      const check = expect(p).rejects.toThrow();
      jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS + 1000);
      await check;
    }
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('respects an abort signal the caller passed in', async () => {
    const controller = new AbortController();
    const p = supabaseFetchWithTimeout('https://x.supabase.co/rest/v1/surfers', {
      signal: controller.signal,
    });
    const check = expect(p).rejects.toThrow(/aborted/i);
    controller.abort();
    await check;
    // Caller aborts are normal (user navigated away) — never reported.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest src/utils/__tests__/supabaseFetchWithTimeout.test.ts`
Expected: FAIL — "Cannot find module '../supabaseFetchWithTimeout'"

- [x] **Step 3: Write the implementation**

```ts
// src/utils/supabaseFetchWithTimeout.ts
/**
 * A drop-in `fetch` for the Supabase client that adds a time limit.
 *
 * WHY (2026-07-23 incident): supabase-js fetches have no timeout. On bad
 * signal a request can wait forever. Auth calls hold the auth-js lock WHILE
 * waiting, and every DB/storage request waits on that same lock — so one
 * stuck request froze the whole app (blank profile, inert Trips tab).
 * A time limit turns "stuck forever" into a normal error: the lock is
 * released, catch/finally paths run, the app recovers.
 */
import * as Sentry from '@sentry/react-native';

export const DEFAULT_TIMEOUT_MS = 25_000;
// Big file transfers get 5 minutes so slow uploads aren't killed mid-flight.
export const STORAGE_TIMEOUT_MS = 300_000;

const REPORT_THROTTLE_MS = 60_000;
let lastReportAt = 0;

export function __resetReportThrottleForTests() {
  lastReportAt = 0;
}

export function timeoutForUrl(url: string): number {
  return url.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? String(input);
}

function reportTimeout(url: string, ms: number) {
  const now = Date.now();
  if (now - lastReportAt < REPORT_THROTTLE_MS) return;
  lastReportAt = now;
  try {
    // Query strings can carry tokens — report the path only.
    Sentry.captureMessage(
      `[supabase-timeout] ${url.split('?')[0]} did not answer within ${ms}ms`,
      'warning',
    );
  } catch {
    // Sentry is dead in Expo Go / may throw — never break the request for it.
  }
}

export const supabaseFetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = urlOf(input);
  const ms = timeoutForUrl(url);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  // If the caller passed its own signal, mirror its abort into ours.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      reportTimeout(url, ms);
      throw new Error(`Request timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx jest src/utils/__tests__/supabaseFetchWithTimeout.test.ts`
Expected: PASS (7 tests)

- [x] **Step 5: Leave uncommitted** (Ohad commits manually)

---

### Task 2: Wire the wrapper into the Supabase client

**Files:**
- Modify: `src/config/supabase.ts` (the `createClient` options, `global` block, ~line 49-60)

**Interfaces:**
- Consumes: `supabaseFetchWithTimeout` from Task 1.
- Produces: nothing new — every existing `supabase.*` call is now time-limited.

- [x] **Step 1: Add the import and wire `global.fetch`**

Add to the imports at the top of `src/config/supabase.ts`:

```ts
import { supabaseFetchWithTimeout } from '../utils/supabaseFetchWithTimeout';
```

In the `createClient(...)` options, find the `global` block:

```ts
      global: {
        headers: {
          'x-client-info': `swellyo@1.0.0`,
          ...
        },
      },
```

and add the fetch line:

```ts
      global: {
        // Time-limited fetch — see supabaseFetchWithTimeout for why.
        fetch: supabaseFetchWithTimeout,
        headers: {
          'x-client-info': `swellyo@1.0.0`,
          ...
        },
      },
```

(Keep the existing headers exactly as they are; only add the `fetch` key and the comment.)

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `173` (no new errors). Also: `npx tsc --noEmit 2>&1 | grep supabase` → no output for `src/config/supabase.ts` or `src/utils/supabaseFetchWithTimeout.ts`.

- [x] **Step 3: Leave uncommitted** (Ohad commits manually)

---

### Task 3: Fail-open guard on the app-boot session check

**Files:**
- Modify: `src/components/AppContent.tsx:433-450` (inside `validateSession`)

**Interfaces:**
- Consumes: nothing from other tasks (independent belt-and-suspenders; Task 2 already bounds this call at 25s — this guard just fails open sooner, at 10s, and also covers non-fetch stalls inside auth-js).
- Produces: nothing used elsewhere.

- [x] **Step 1: Replace the unbounded `getSession()` await**

Current code (`AppContent.tsx`, inside `validateSession`):

```ts
          const { supabase } = await import('../config/supabase');
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();

          if (sessionError || !session) {
```

New code:

```ts
          const { supabase } = await import('../config/supabase');
          // getSession() can hit the network (token refresh) and stall.
          // Never let it strand the user on the boot spinner: after 10s,
          // fail open and let them in. The auth guard still logs out a
          // genuinely dead session later.
          const raced = await Promise.race([
            supabase.auth.getSession(),
            new Promise<'timeout'>((resolve) =>
              setTimeout(() => resolve('timeout'), 10_000),
            ),
          ]);
          if (raced === 'timeout') {
            console.warn('[AppContent] getSession timed out — failing open');
            setHasValidatedSession(true);
            return;
          }
          const { data: { session }, error: sessionError } = raced;

          if (sessionError || !session) {
```

(The `finally { sessionValidationRef.current = false; }` already in place now always runs, because the race always settles.)

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "AppContent"`
Expected: only the 1 pre-existing AppContent error (line ~1225, unrelated `Type '{ id: any; ...' is missing` error). No new ones.

- [x] **Step 3: Leave uncommitted** (Ohad commits manually)

---

### Task 4: Fail-open guard on the onboarding DB check

**Files:**
- Modify: `src/context/OnboardingContext.tsx:267-271` (inside `loadOnboardingData`)

**Interfaces:**
- Consumes: nothing from other tasks (same belt-and-suspenders reasoning as Task 3).
- Produces: nothing used elsewhere.

- [x] **Step 1: Replace the unbounded `getCurrentUserData()` await**

Current code (`OnboardingContext.tsx`, inside `loadOnboardingData`):

```ts
        try {
          const { surfer } = await supabaseDatabaseService.getCurrentUserData();
```

New code:

```ts
        try {
          // This makes network calls with the auth lock involved — never let
          // it strand boot. After 10s, continue with local data (fail open).
          const { surfer } = await Promise.race([
            supabaseDatabaseService.getCurrentUserData(),
            new Promise<{ user: null; surfer: null }>((resolve) =>
              setTimeout(() => resolve({ user: null, surfer: null }), 10_000),
            ),
          ]);
```

(When `surfer` is `null` the existing code already falls through to the local AsyncStorage check — that is the fail-open path, no further change needed.)

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "OnboardingContext"`
Expected: no output (no errors in this file before or after).

- [x] **Step 3: Leave uncommitted** (Ohad commits manually)

---

### Task 5: Correct the over-confident comment in ProfileScreen

**Files:**
- Modify: `src/screens/ProfileScreen.tsx:1458-1461` (comment only, no behavior change)

**Interfaces:** none.

- [x] **Step 1: Fix the comment**

Current comment (added earlier today):

```ts
        // getSession() reads local storage — unlike getUser() it never makes a
        // network round-trip, so it can't hang on flaky connections and leave
        // authChecking stuck (blank-profile bug, 2026-07-23). Auth validity is
        // the auth guard's job, not this screen's.
```

New comment (accurate: getSession CAN hit the network near token expiry; the real safety nets are the global fetch timeout and the profileData fall-through gate):

```ts
        // getSession() is usually a local read (no network), unlike getUser().
        // It CAN still hit the network when the token is near expiry, but the
        // global fetch timeout bounds that, and the render gate below falls
        // through when profileData is already cached — so a slow call can't
        // blank the screen (blank-profile bug, 2026-07-23). Auth validity is
        // the auth guard's job, not this screen's.
```

- [x] **Step 2: Leave uncommitted** (Ohad commits manually)

---

### Task 6: Final verification

**Files:** none (checks only).

- [x] **Step 1: Full test run for the new test file**

Run: `npx jest src/utils/__tests__/supabaseFetchWithTimeout.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 2: Full type-check**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `173` (unchanged — all pre-existing, none in touched files).

- [x] **Step 3: Review summary for Ohad**

List every modified/created file with one line each, confirm all changes are JS-only (OTA-able), and remind: device test = open app in airplane-mode-flaky conditions if possible; watch Sentry for `[supabase-timeout]` warnings after release.

## Self-Review (done at planning time)

- **Spec coverage:** part 1 → Tasks 1-2; part 2 (watchdog) → inside Task 1; part 3 → Tasks 3-4; comment correction → Task 5; acceptance criteria → Tasks 1, 6.
- **Placeholder scan:** none — all steps carry full code.
- **Type consistency:** `supabaseFetchWithTimeout`, `timeoutForUrl`, `DEFAULT_TIMEOUT_MS`, `STORAGE_TIMEOUT_MS`, `__resetReportThrottleForTests` used identically in Tasks 1-2 and tests.
- **Known risk accepted:** `AbortSignal.any` is avoided on purpose (not in Hermes); manual signal mirroring used instead. `Sentry.captureMessage` import is top-level like the rest of the app (App.tsx does the same) and guarded by try/catch at the call site.
