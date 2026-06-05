# Spec — Realtime Socket Stays Alive / Reconnects

**Date:** 2026-06-05
**Author:** Ohad (via realtime audit + socket investigation)
**Status:** Draft — design approved, ready for implementation plan
**Related:** `docs/superpowers/specs/2026-06-05-presence-rescope-design.md`, `docs/superpowers/plans/2026-06-04-messaging-broadcast-migration.md`

---

## 1. Problem

On clients running the Broadcast migration, all Realtime channels (presence, `user-inbox`, `notifications`, conversation channels) fail in a continuous loop:

```
[UserPresenceService] Realtime socket state: {"channelCount": 4, "connectionState": "closed", "isConnected": false}
[MessagingService] user-inbox channel CHANNEL_ERROR ...
[notificationsService] notifications:... status: CHANNEL_ERROR
```

### Root cause (confirmed by reading `@supabase/realtime-js@2.x` internals)
- `RealtimeClient.removeChannel()` calls `this.disconnect()` whenever `channels.length === 0` (`RealtimeClient.js:193-198`).
- `disconnect()` sets `_wasManualDisconnect = true`, which makes the built-in reconnect timer a no-op (`RealtimeClient.js:529-539`). The socket is now dead with **no auto-reconnect**.
- Pre-migration, long-lived `postgres_changes` batch channels were always present, so channel count never hit 0. The migration added a **standalone private `user-inbox` channel** (`messagingService.ts:1811`, created/torn down independently on logout, broadcast-mode toggle, or `MessagingProvider` re-mount). When it is the *last* channel removed, the whole socket dies.
- Once the socket is dead, every other channel's built-in per-channel rejoin timer keeps firing against a closed socket → the endless CHANNEL_ERROR loop. The app never recovers until it is killed and relaunched.

### Secondary findings (in scope)
- **#2 — token-refresh mid-join race:** if a private channel is mid-join when the auth token refreshes (~hourly), `_performAuth` updates the join payload for the *next* join but doesn't cancel the in-flight one, so the server may reject it → an isolated CHANNEL_ERROR. It self-heals via the per-channel rejoin timer *as long as the socket is alive*.
- **#3 — no consumer revives a dead socket:** `userPresenceService`'s AppState-`active` handler rebuilds a channel but never calls `realtime.connect()`, so against a manually-disconnected socket it can't recover.

### Verified non-issues
- `@supabase/supabase-js@2.80.0` **auto-syncs the realtime JWT** on `TOKEN_REFRESHED`/`SIGNED_IN` (`SupabaseClient.js:201-218` → `realtime.setAuth`). No missing `setAuth`.
- Consumers (`user-inbox`, `notifications`) do **not** re-subscribe on CHANNEL_ERROR — and they don't need to: realtime-js auto-rejoins all existing channel objects when the socket reconnects (`onConnOpen` → `rejoinChannels()`), and an errored channel auto-retries its own join via its rejoin timer once the socket is up.

**Therefore all three collapse to one root: keep the socket alive, and revive it if it ever dies.**

## 2. Goal

Guarantee the Realtime socket stays connected for the whole authenticated session (and reconnects if it dies), so channel add/remove churn can never strand the socket, while still closing the socket cleanly on logout.

## 3. Non-goals

- No per-consumer recovery code added to inbox/notifications/etc. (realtime-js auto-rejoins once the socket lives).
- No changes to the ~15 existing `supabase.removeChannel(...)` call sites.
- No DB migration, no new env flag.
- No replacement of realtime-js reconnect behavior for genuine network drops — that already works (those are not manual disconnects).

## 4. Design — a small `realtimeConnection` module + thin wiring

### 4.1 Mechanism

Prevent the failure (keepalive) and cure it if it still happens (ensureConnected):

- **Keepalive (prevention, fixes #1):** while the session is authenticated, keep one pinned **public** channel `keepalive` subscribed. It has **no `.on()` bindings** and nothing ever broadcasts to it, so it carries zero traffic — it exists only to keep `channels.length ≥ 1`, so `removeChannel` never triggers the internal `disconnect()`. (A created-but-errored keepalive still counts; it only needs to *exist* in the channels map, not be healthy.)
- **ensureConnected (cure, fixes #3):** `if (!supabase.realtime.isConnected()) supabase.realtime.connect()`. On reconnect, realtime-js's `rejoinChannels()` revives every existing channel — no consumer changes needed.
- **Auth hook (hardens #2):** on `TOKEN_REFRESHED`/`SIGNED_IN`, call `supabase.realtime.setAuth(session.access_token)` (idempotent belt-and-suspenders alongside the supabase-js internal) then `ensureConnected()`. The per-channel rejoin timer then recovers any channel that errored during the refresh window, now with a fresh token and a live socket.

### 4.2 Module API — `src/lib/realtimeConnection.ts`

```
startSessionKeepalive(): void   // idempotent; subscribes the `keepalive` channel; on first
                                // call also registers the global auth listener (once)
ensureConnected(): void          // reconnect the socket if it isn't connected
stopSessionKeepalive(): void     // removes the `keepalive` channel (lets the socket close)
```

- The global `supabase.auth.onAuthStateChange` listener is registered **lazily on the first `startSessionKeepalive()`**, guarded so it registers exactly once for the app's lifetime (it must survive logout→login). No top-level import side effects, no extra app-init wiring point.
- All functions no-op when `!isSupabaseConfigured()`.

### 4.3 Wiring (small, surgical)

| Site | Change |
|---|---|
| `src/context/MessagingProvider.tsx` | On the same authenticated mount that calls `trackCurrentUser()`, also call `startSessionKeepalive()`. |
| `src/utils/logout.ts` (and/or `src/utils/registerLogoutHandlers.ts`) | Add `stopSessionKeepalive()` to the logout choreography so the socket closes on sign-out. Order: alongside/just after presence teardown. |
| `src/services/presence/userPresenceService.ts` | In the AppState-`active` handler, call `ensureConnected()` before attempting channel rebuild. (Dovetails with the per-user-topics presence rewrite.) |

### 4.4 Keepalive channel details

- Topic: static string `keepalive` (public — no RLS, no DB). One per client; multiple clients on the same empty public topic is fine (no broadcasts → no fan-out).
- Created via `supabase.channel('keepalive').subscribe()`. No `presence` config, no bindings.
- `stopSessionKeepalive()` calls `supabase.removeChannel(keepaliveChannel)`. If it is genuinely the last channel at logout, the resulting `disconnect()` is the desired behavior.

## 5. Files touched

| File | Change |
|---|---|
| `src/lib/realtimeConnection.ts` | **new** — keepalive + ensureConnected + auth listener (§4.2) |
| `src/context/MessagingProvider.tsx` | call `startSessionKeepalive()` on authenticated mount |
| `src/utils/logout.ts` and/or `src/utils/registerLogoutHandlers.ts` | call `stopSessionKeepalive()` in logout choreography |
| `src/services/presence/userPresenceService.ts` | call `ensureConnected()` in AppState-`active` handler |

No migration, no env flag, no edits to existing `removeChannel` sites.

## 6. Acceptance criteria

1. **Loop reproduction fixed:** drive the original trigger (broadcast mode; churn that makes the `user-inbox` channel the last one removed — e.g. background/foreground + logout→relogin cycles). The socket stays connected (or revives within seconds) and presence/inbox/notifications channels rejoin automatically — no sustained CHANNEL_ERROR loop.
2. **Logout still closes the socket:** after sign-out, `supabase.realtime.isConnected()` is false and no keepalive channel lingers; no presence/inbox subscriptions leak.
3. **Foreground revival (#3):** with the socket forced closed while backgrounded, returning to foreground reconnects it and channels rejoin.
4. **Token refresh (#2):** across a token refresh, private channels recover within seconds (no lingering CHANNEL_ERROR); DMs continue to deliver.
5. **No regression:** two-account DM delivery, reactions, and presence dot all still work live.

## 7. Verification & rollout

- No flag, no DB change → rollout = ship the client. Worst case if the module misbehaves: it either keeps an extra idle channel (benign) or fails to reconnect (same as today). Low blast radius.
- Manual verification of criteria 1-5 in Expo Go (two accounts; use the dev-only socket logger already in `src/config/supabase.ts` to watch OPEN/CLOSED).
- Confirm via logs that after a forced last-channel removal the socket does not stay `closed`.

## 8. Future / out of scope

- A general `safeRemoveChannel` helper or onClose watchdog (approaches B/C considered and rejected — keepalive prevents the failure with a far smaller footprint).
- Tightening #2 further with per-channel re-subscribe nudging on refresh (unnecessary — rejoin timer handles it once the socket is alive).
