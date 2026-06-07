# Realtime Socket Stays Alive / Reconnects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Supabase Realtime socket connected for the whole authenticated session (and revive it if it dies), so channel add/remove churn can never strand it in a CHANNEL_ERROR loop — while still closing it cleanly on logout.

**Architecture:** A small `realtimeConnection` module pins one idle "keepalive" channel for the session (so `removeChannel` never drops the count to 0 and triggers realtime-js's no-reconnect manual disconnect), exposes `ensureConnected()` to revive a dead socket (realtime-js then auto-rejoins existing channels), and re-syncs the realtime JWT on token refresh. Three thin wiring points start/stop it and call `ensureConnected()` on foreground.

**Tech Stack:** React Native 0.81 / Expo 54, `@supabase/supabase-js@2.80.0` Realtime, TypeScript.

**Project testing note:** This repo has **no test harness** (no jest, no `test` script, no test files). Verification is `npx tsc --noEmit` plus a manual test in Expo Go (acceptance criteria in the spec). Do not scaffold jest — realtime socket behavior is only meaningfully validated by integration testing.

**Commit note:** Ohad commits manually. Commit commands are the suggested grouping; if running inline, review the diff and commit yourself.

**Dependency note:** Task 4 edits `src/services/presence/userPresenceService.ts`, which already has uncommitted changes from the per-user-topics presence rewrite (`docs/superpowers/plans/2026-06-05-presence-rescope.md`). Work against the current working-tree version of that file.

**Spec:** `docs/superpowers/specs/2026-06-05-realtime-socket-reconnect-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/realtimeConnection.ts` | Owns Realtime socket health: keepalive channel, `ensureConnected()`, token-refresh re-sync | **Create** |
| `src/context/MessagingProvider.tsx` | Authenticated session entry | Call `startSessionKeepalive()` on mount |
| `src/utils/logout.ts` | Logout choreography | Call `stopSessionKeepalive()` in `destroySession` |
| `src/services/presence/userPresenceService.ts` | Presence (per-user topics) | Call `ensureConnected()` in AppState-`active` |

Tasks 2-4 import the module from Task 1, so Task 1 must land first.

---

## Task 1: Create the `realtimeConnection` module

**Files:**
- Create: `src/lib/realtimeConnection.ts`

- [ ] **Step 1: Create the file with this exact content**

```typescript
import { supabase, isSupabaseConfigured } from '../config/supabase';

/**
 * Realtime socket health.
 *
 * Problem: @supabase/realtime-js calls socket.disconnect() — a MANUAL disconnect
 * that disables auto-reconnect — whenever removeChannel() drops the channel count
 * to zero. After the Broadcast migration added standalone channels that churn
 * (user-inbox, presence), an unlucky teardown order can make a feature channel the
 * last one removed → the whole socket dies and never reconnects, stranding every
 * channel in a CHANNEL_ERROR loop.
 *
 * Fix:
 *  - Keepalive: pin one idle public channel for the authenticated session so the
 *    channel count never hits zero (prevention).
 *  - ensureConnected(): reconnect the socket if it's down; realtime-js then
 *    auto-rejoins all existing channels (cure).
 *  - Auth listener: on token refresh / sign-in, re-sync the realtime JWT and
 *    ensure the socket is connected (covers the mid-join token-refresh race for
 *    private channels).
 *
 * See docs/superpowers/specs/2026-06-05-realtime-socket-reconnect-design.md
 */

const KEEPALIVE_TOPIC = 'keepalive';

let keepaliveChannel: ReturnType<typeof supabase.channel> | null = null;
let authListenerRegistered = false;

/**
 * Reconnect the realtime socket if it isn't connected. On reconnect, realtime-js
 * rejoins all existing channels automatically, so no per-consumer recovery is needed.
 */
export function ensureConnected(): void {
  if (!isSupabaseConfigured()) return;
  try {
    const rt: any = (supabase as any).realtime;
    if (rt && typeof rt.isConnected === 'function' && !rt.isConnected()) {
      rt.connect();
    }
  } catch (e) {
    console.warn('[realtimeConnection] ensureConnected failed:', e);
  }
}

/**
 * Registered exactly once for the app's lifetime (must survive logout → login).
 * On token refresh / sign-in, re-sync the realtime JWT (idempotent belt-and-suspenders
 * alongside supabase-js's internal sync) so in-flight private-channel joins use the
 * fresh token, then make sure the socket is up.
 */
function registerAuthListenerOnce(): void {
  if (authListenerRegistered) return;
  authListenerRegistered = true;
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        try {
          (supabase as any).realtime?.setAuth?.(session?.access_token ?? null);
        } catch (e) {
          console.warn('[realtimeConnection] setAuth on token refresh failed:', e);
        }
        ensureConnected();
      }
    });
  } catch (e) {
    console.warn('[realtimeConnection] registerAuthListener failed:', e);
  }
}

/**
 * Pin an idle public channel for the authenticated session so removeChannel() can
 * never drop the channel count to zero (which would manually disconnect the socket
 * with no auto-reconnect). Idempotent. Registers the global auth listener on first call.
 */
export function startSessionKeepalive(): void {
  if (!isSupabaseConfigured()) return;
  registerAuthListenerOnce();
  if (keepaliveChannel) return;
  try {
    // No .on() bindings and nothing broadcasts here — zero traffic. It exists only
    // to keep channels.length >= 1 so the socket is never manually disconnected.
    keepaliveChannel = supabase.channel(KEEPALIVE_TOPIC);
    keepaliveChannel.subscribe();
  } catch (e) {
    console.warn('[realtimeConnection] startSessionKeepalive failed:', e);
    keepaliveChannel = null;
  }
}

/**
 * Remove the keepalive channel on logout so the socket can close normally.
 */
export function stopSessionKeepalive(): void {
  if (!keepaliveChannel) return;
  try {
    supabase.removeChannel(keepaliveChannel);
  } catch (e) {
    console.warn('[realtimeConnection] stopSessionKeepalive failed:', e);
  } finally {
    keepaliveChannel = null;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | rg "realtimeConnection" || echo "OK: no errors in realtimeConnection"`
Expected: `OK: no errors in realtimeConnection`. (If `ReturnType<typeof supabase.channel>` causes friction, fall back to `any` for `keepaliveChannel`'s type — channels are typed `any` elsewhere in this codebase.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtimeConnection.ts
git commit -m "feat(realtime): socket-health module (keepalive + ensureConnected + token re-sync)"
```

---

## Task 2: Start keepalive on authenticated mount

**Files:**
- Modify: `src/context/MessagingProvider.tsx` (import near the other imports; call inside the auth effect at ~line 1322)

- [ ] **Step 1: Add the import**

Add near the top with the other relative imports (the exact existing import list varies; place it alongside the `messagingService` / `userPresenceService` imports):

```typescript
import { startSessionKeepalive } from '../lib/realtimeConnection';
```

- [ ] **Step 2: Call it right after presence tracking starts**

Find this block (inside `supabase.auth.getUser().then(({ data: { user } }) => { if (user) {`):

```typescript
        userPresenceService.trackCurrentUser().catch(error => {
          console.error('[MessagingProvider] Error initializing presence tracking:', error);
        });
```

Insert immediately after it:

```typescript

        // Keep the realtime socket alive for the whole session so channel churn
        // (e.g. user-inbox teardown) can't strand it. See lib/realtimeConnection.
        startSessionKeepalive();
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | rg "MessagingProvider" || echo "OK: no errors in MessagingProvider"`
Expected: `OK: no errors in MessagingProvider`.

- [ ] **Step 4: Commit**

```bash
git add src/context/MessagingProvider.tsx
git commit -m "feat(realtime): start session keepalive on authenticated mount"
```

---

## Task 3: Stop keepalive on logout

**Files:**
- Modify: `src/utils/logout.ts` (import + call in `destroySession`, after `stopTrackingCurrentUser`)

- [ ] **Step 1: Add the import**

Add near the top with the other imports:

```typescript
import { stopSessionKeepalive } from './realtimeConnection';
```

(Note: `realtimeConnection.ts` lives in `src/lib/`. From `src/utils/logout.ts` the correct path is `../lib/realtimeConnection` — use that if the file ends up not resolving with `./`. Confirm against the actual location; the file is `src/lib/realtimeConnection.ts`, so the import is `'../lib/realtimeConnection'`.)

Correct import line:

```typescript
import { stopSessionKeepalive } from '../lib/realtimeConnection';
```

- [ ] **Step 2: Call it in `destroySession` after presence teardown**

Find this block:

```typescript
  try {
    await userPresenceService.stopTrackingCurrentUser();
    console.log('[Logout] Presence tracking stopped');
  } catch (presenceError) {
    console.error('[Logout] Error stopping presence tracking:', presenceError);
  }
```

Insert immediately after it (before the `authService.signOut()` block):

```typescript

  // Remove the realtime keepalive channel so the socket can close on sign-out
  // (we WANT it down when logged out).
  try {
    stopSessionKeepalive();
    console.log('[Logout] Realtime keepalive stopped');
  } catch (keepaliveError) {
    console.error('[Logout] Error stopping realtime keepalive:', keepaliveError);
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | rg "utils/logout" || echo "OK: no errors in logout"`
Expected: `OK: no errors in logout`.

- [ ] **Step 4: Commit**

```bash
git add src/utils/logout.ts
git commit -m "feat(realtime): stop session keepalive on logout"
```

---

## Task 4: Revive a dead socket on foreground (presence AppState handler)

**Files:**
- Modify: `src/services/presence/userPresenceService.ts` (import + one call in `setupAppStateListener`)

This file already carries uncommitted per-user-topics changes — edit the current working-tree version.

- [ ] **Step 1: Add the import**

Add at the top of the file, after the existing imports:

```typescript
import { ensureConnected } from '../../lib/realtimeConnection';
```

- [ ] **Step 2: Call `ensureConnected()` first in the AppState `active` branch**

In `setupAppStateListener`, find:

```typescript
      if (nextAppState === 'active') {
        // Foregrounding is the natural "try again" signal on mobile.
```

Replace those two lines with:

```typescript
      if (nextAppState === 'active') {
        // The socket may have been manually disconnected (channel count hit 0)
        // while backgrounded; revive it before rebuilding channels.
        ensureConnected();
        // Foregrounding is the natural "try again" signal on mobile.
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | rg "userPresenceService" || echo "OK: no errors in userPresenceService"`
Expected: `OK: no errors in userPresenceService`.

- [ ] **Step 4: Commit**

```bash
git add src/services/presence/userPresenceService.ts
git commit -m "feat(realtime): revive dead socket on foreground in presence AppState handler"
```

---

## Task 5: Manual verification (acceptance criteria)

Run in Expo Go (two accounts; third for nothing here). Use the dev-only socket logger already in `src/config/supabase.ts` (`[Realtime] socket OPEN/CLOSED`) to watch the socket.

**Files:** none

- [ ] **Step 1: Loop reproduction is fixed (criterion 1)**

In broadcast mode, churn the session: foreground/background several times and do a logout → re-login cycle while DMs/presence are active. Expected: no sustained CHANNEL_ERROR loop; after any momentary close the socket reconnects (`[Realtime] socket OPEN` returns) and presence/inbox/notifications resume. Confirm `[Realtime] socket CLOSED` is not the steady state while logged in.

- [ ] **Step 2: Logout still closes the socket (criterion 2)**

Log out. Expected: `[Realtime] socket CLOSED`, and `supabase.realtime.isConnected()` is false; no keepalive channel lingers (no immediate reconnect while logged out).

- [ ] **Step 3: Foreground revival (criterion 3)**

Background the app long enough for the socket to drop, then foreground. Expected: socket reconnects and the presence dot + DM delivery resume without an app restart.

- [ ] **Step 4: Two-account live behavior (criterion 5)**

A and B in a DM: messages, reactions, and the presence dot all update live. Confirms keepalive/reconnect didn't regress normal realtime.

- [ ] **Step 5: Record result**

If all pass, mark the spec done and commit:

```bash
# In docs/superpowers/specs/2026-06-05-realtime-socket-reconnect-design.md set Status to:
# **Status:** Done — implemented and verified.
git add docs/superpowers/specs/2026-06-05-realtime-socket-reconnect-design.md
git commit -m "docs(realtime): mark socket-reconnect design verified"
```

---

## Self-Review (plan vs spec)

- **Spec §4.1 keepalive (fix #1)** → Task 1 `startSessionKeepalive` + Task 2 wiring. ✓
- **Spec §4.1 ensureConnected (fix #3)** → Task 1 `ensureConnected` + Task 4 AppState wiring. ✓
- **Spec §4.1 auth hook (harden #2)** → Task 1 `registerAuthListenerOnce` (setAuth + ensureConnected on TOKEN_REFRESHED/SIGNED_IN). ✓
- **Spec §4.2 API (`startSessionKeepalive`/`ensureConnected`/`stopSessionKeepalive`, lazy once-only auth listener, no-op when unconfigured)** → Task 1 matches exactly. ✓
- **Spec §4.3 wiring (MessagingProvider mount, logout, presence AppState)** → Tasks 2, 3, 4. ✓
- **Spec §4.4 keepalive details (static public `keepalive`, no bindings, removeChannel on stop)** → Task 1 `KEEPALIVE_TOPIC`, `supabase.channel(...).subscribe()`, `stopSessionKeepalive` → `removeChannel`. ✓
- **Spec §3 non-goals (no consumer recovery, no removeChannel-site edits, no migration/flag)** → no such tasks exist. ✓
- **Spec §6 acceptance criteria 1-5** → Task 5 Steps 1-4 (criterion 4 token-refresh is long-running; noted as covered by the auth hook + observed over a session rather than a discrete step). ✓
- **Placeholder scan:** none. **Type consistency:** `startSessionKeepalive` / `stopSessionKeepalive` / `ensureConnected` / `keepaliveChannel` / `KEEPALIVE_TOPIC` / `authListenerRegistered` used consistently across Tasks 1-4. ✓

> Note: criterion 4 (token-refresh recovery) takes ~1 hour to observe naturally; the auth-listener hook addresses it structurally. If you want to force it, you can shorten the session JWT expiry in Supabase Auth settings for a test, but that's optional.
