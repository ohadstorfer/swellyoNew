# Spec — User Presence: global channel → per-user topics

**Date:** 2026-06-05
**Author:** Ohad (via realtime audit)
**Status:** Draft — design approved, ready for implementation plan
**Related:** realtime audit (target #3), `docs/superpowers/specs/2026-06-04-reactions-broadcast-migration.md`

---

## 1. Problem

`src/services/presence/userPresenceService.ts` maintains a **single global Realtime Presence channel** `presence:users` (line ~175). Every connected user joins it and `.track()`s themselves; every join/leave/sync fans out to **all N** subscribers, and each `sync` re-runs `notifyAllSubscribers()` across the entire presence state. Cost grows ≈ **N²**. With a few thousand concurrent users this is the single most expensive realtime primitive in the app — worse than messages ever was (messages at least fanned out per-conversation).

This is disproportionate to what presence is actually used for: the **online dot is rendered in exactly one place for one user at a time** — the chat header of `DirectMessageScreen` / `DirectGroupChat`, for the peer you're chatting with (`subscribeToUserStatus`). It is **not** used in the conversation list. So an all-users O(N²) channel exists to render a dot for one person.

## 2. Goal

Eliminate the O(N²) fan-out while keeping presence **truly live** (instant flip when the peer opens/closes the app) and **preserving today's semantics** ("online" = the peer has the app foregrounded, on any screen). Do it as a contained change with no caller changes and no DB migration.

## 3. Non-goals

- No change to the public API of `userPresenceService` — `subscribeToUserStatus`, `trackCurrentUser`, `stopTrackingCurrentUser` keep their signatures, so callers don't change.
- No change to the `last_seen_at` / `user_activity` DB fallback or its write cadence.
- No tightening of presence privacy (kept identical to today — see §4.4). Restricting visibility to conversation-sharers is a noted future option, out of scope here.
- Conversation-list online dots (not currently a feature) are not added.

## 4. Design — per-user presence topics (B2)

### 4.1 Topology

Replace the one global `presence:users` channel with **per-user topics** `presence:user:{userId}`:

- **Own presence (publish):** while the app is foregrounded, the current user tracks presence on their *own* topic `presence:user:{currentUserId}` — **1 channel**. This is what makes "online" mean "app is open on any screen," exactly as today.
- **Watching a peer (subscribe):** to render the dot for peer `X`, subscribe to `presence:user:{X}` and read `presenceState()` + `join`/`leave`/`sync` — **1 channel per watched user**, held only while that user's chat is open. The watcher does **not** `.track()` on the peer's topic; it only reads. So `presence:user:{X}` has exactly one tracker (X) and a handful of readers (whoever currently has X's chat open — usually 0–2).

Per-user channel count: ~1 (own) + ~1 (current peer) = **~2**. Total fan-out is **O(N)**, never O(N²): each topic's readership is bounded by "people viewing that one user's chat right now," not by total online users.

### 4.2 Why B2 over per-conversation (B1)

B1 (`presence:conversation:{id}`, track only inside the open conversation) also fixes the fan-out and saves ~1 channel. Rejected because:

- Channels multiplex over a single websocket — saving one is negligible. The fan-out (the real cost) is fixed equally by both.
- B1 silently **redefines "online" to "is staring at this exact chat right now."** A peer actively using the app on another screen would show **offline**, then reply instantly — a broken-feeling indicator. That UX regression is not worth one free channel.

### 4.3 Public API preserved → no caller changes

The external surface stays identical, so these are untouched:

- `src/context/MessagingProvider.tsx` — `trackCurrentUser()` on mount, `stopTrackingCurrentUser()` on unmount.
- `src/utils/logout.ts` — `stopTrackingCurrentUser()`.
- `src/screens/DirectMessageScreen.tsx`, `src/screens/DirectGroupChat.tsx` — `subscribeToUserStatus(userId, cb)`.

Only `userPresenceService.ts` internals change.

### 4.4 Authorization — channels stay public (no migration)

The current global channel is a **public** presence channel (`supabase.channel('presence:users', ...)` with no `{ private: true }`), meaning any authenticated client already sees everyone's presence. The per-user topics stay **public** too → **no RLS, no DB migration**, and the privacy posture is unchanged (no regression). A client could subscribe to `presence:user:{anyId}` to learn online status — same exposure as today's global channel.

Future option (not now): make topics private + add an RLS policy on `realtime.messages` that allows subscribing to `presence:user:{X}` only if the subscriber shares a conversation with X.

### 4.5 Internals (rewrite of `userPresenceService`)

- **Own-presence channel:** created in `trackCurrentUser()` on `presence:user:{currentUserId}`; `.track()` self; tied to AppState (track on foreground, untrack on background — reuse existing AppState handling). The existing recovery/backoff machinery is **re-pointed at this channel** (so peers see us online again after a reconnect) instead of the global one.
- **Watch channels:** a `Map<userId, channel>`. `subscribeToUserStatus(X, cb)` lazily creates/opens `presence:user:{X}` if absent, registers `cb`, and drives callbacks from that channel's `sync`/`join`/`leave`. `unsubscribeFromUserStatus` removes the callback and, when the last callback for `X` is gone, tears down and `removeChannel`s `presence:user:{X}`. `MAX_SUBSCRIPTIONS` stays as a guard on the number of simultaneously watched users.
- **Initial status + fallback:** on subscribe, seed via `getUserStatus(X)` (presence-state if the watch channel is already healthy, else `getUserStatusFromDatabase` → `last_seen_at < 5min`). When a watch channel is unhealthy (CHANNEL_ERROR/TIMED_OUT), report DB-fallback status and attempt re-subscribe.
- **DB writes unchanged:** heartbeat + app-state continue writing `last_seen_at` so the fallback stays meaningful when realtime is down.
- **Deleted:** the global `presence:users` channel, `notifyAllSubscribers()` over the full presence state, `notifySubscribersForUser` global plumbing as it relates to the global channel, and global-channel-specific recovery state. (Per-user handlers replace the global sync sweep.)

### 4.6 Edge cases

- `subscribeToUserStatus(self)`: guard — reflect own tracking state (or no-op); we don't render our own dot.
- Group chats: presence is per-user and "meaningless" for a group (existing comment). Behavior is unchanged — the screen subscribes to a specific peer only where it does today; no group-wide presence is introduced.
- Reconnect: own-presence channel recovery re-tracks self; watch channels re-subscribe and re-seed from `presenceState`/DB.
- Logout: `stopTrackingCurrentUser` untracks + removes the own-presence channel **and** all watch channels, cancels pending recovery (preserve current logout choreography ordering).

## 5. Files touched

| File | Change |
|---|---|
| `src/services/presence/userPresenceService.ts` | Internal rewrite: global channel → per-user own + watch channels (§4.5). Public API unchanged. |

No other source files. No DB migration. No env flag (this isn't a transport A/B like messaging/reactions — it's a self-contained internal swap; the risk is mitigated by the preserved API + DB fallback, and it's verifiable with a two-account test).

## 6. Acceptance criteria

1. Open A↔B chat on two devices: B's dot for A flips **online within realtime latency** when A foregrounds the app (on *any* screen, not just the chat), and **offline** shortly after A backgrounds/closes. ("Online = app open" preserved.)
2. With A online and B watching, a **third user C** watching a *different* peer sees **zero** presence traffic related to A↔B (no global fan-out).
3. Realtime down (kill socket): the dot falls back to `last_seen_at < 5min` and does not get stuck.
4. Logout fully tears down own + watch channels (no lingering presence, no leaked subscriptions).
5. No regression in the chat-header dot UX in `DirectMessageScreen` / `DirectGroupChat`.

## 7. Verification & rollout

- No flag and no DB change, so rollout = ship the client. Because the API and DB fallback are preserved, worst case (a presence bug) degrades the dot to DB-`last_seen_at` behavior, not a crash or data loss.
- Manual two-account test for criteria 1–4 (sim or real devices). Watch the realtime network frames to confirm criterion 2 (no cross-user fan-out).
- Sanity: confirm `presence:users` no longer appears in any subscribe call after the change.

## 8. Future options (not in this spec)

- Private per-user topics + RLS restricting presence visibility to conversation-sharers (§4.4).
- Conversation-list online dots, if ever wanted — would reuse the same watch-channel mechanism per visible row (bounded by list page size).
