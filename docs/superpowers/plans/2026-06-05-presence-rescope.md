# User Presence Re-scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global `presence:users` Realtime channel (O(N²) fan-out) with per-user presence topics (`presence:user:{id}`), keeping presence live and "online = app open" semantics, with no caller or DB changes.

**Architecture:** Each user tracks presence on their own topic while foregrounded (publish side); to render a peer's online dot, the client subscribes read-only to that peer's topic (subscribe side). On a per-user topic, any presence entry means that user is online. `last_seen_at` (`user_activity`, < 5 min) stays as the realtime-down fallback and the initial-paint seed. Total fan-out becomes O(N).

**Tech Stack:** React Native 0.81 / Expo 54, `@supabase/supabase-js` Realtime Presence, TypeScript.

**Project testing note:** This repo has **no test harness** (no jest, no `test` script, no test files). Verification is therefore (a) `npx tsc --noEmit` for type safety and (b) a manual two-account test in Expo Go covering the spec's acceptance criteria. Standing up jest + mocking Supabase Realtime is intentionally out of scope — it would be a large separate effort and would not meaningfully de-risk realtime-channel wiring, which only integration testing exercises.

**Commit note:** Ohad commits manually. Commit commands below are the suggested grouping; if running inline, review the diff and commit yourself rather than auto-committing.

**Spec:** `docs/superpowers/specs/2026-06-05-presence-rescope-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/presence/userPresenceService.ts` | Singleton managing own-presence publish + per-peer watch subscriptions + DB fallback | **Full internal rewrite.** Public API (`trackCurrentUser`, `subscribeToUserStatus`, `stopTrackingCurrentUser`, `cleanup`) unchanged. |

No other files change. Callers (`MessagingProvider.tsx`, `logout.ts`, `DirectMessageScreen.tsx`, `DirectGroupChat.tsx`) consume the unchanged public API and are not modified.

---

## Task 1: Rewrite `userPresenceService` to per-user topics

**Files:**
- Modify (replace contents): `src/services/presence/userPresenceService.ts`

This is an all-or-nothing internal rewrite — the file must be replaced wholesale because the global-channel methods (`ensurePresenceChannel`, `notifyAllSubscribers`, `notifySubscribersForUser`, `getBatchUserStatus`) are deleted and replaced by own-channel + watch-channel methods. A partial edit would not type-check.

- [ ] **Step 1: Replace the entire file with the implementation below**

```typescript
import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { AppState, AppStateStatus } from 'react-native';

/**
 * User Presence Service — per-user topics
 *
 * Topology (see docs/superpowers/specs/2026-06-05-presence-rescope-design.md):
 * - Own presence (publish): while foregrounded, track on presence:user:{currentUserId}
 *   (1 channel). This is what makes "online" mean "app is open on any screen".
 * - Watching a peer (subscribe): read-only subscribe to presence:user:{X} while that
 *   user's chat is open. On a per-user topic, a non-empty presenceState => X is online.
 * - Fallback: last_seen_at in user_activity (< 5 min = online) seeds initial paint and
 *   covers realtime-down.
 *
 * Replaces the former single global `presence:users` channel, whose every-sync-to-everyone
 * fan-out cost ~O(N^2). Per-user topics make total fan-out O(N).
 *
 * Public API is unchanged: trackCurrentUser / subscribeToUserStatus /
 * stopTrackingCurrentUser / cleanup.
 */

const PRESENCE_UPDATE_INTERVAL = 60000; // 60s presence heartbeat (re-track self)
const ONLINE_THRESHOLD_MINUTES = 5; // last_seen_at within 5 min => online (fallback)
const MAX_SUBSCRIPTIONS = 50; // guard on number of simultaneously watched users
const METRICS_LOG_INTERVAL = 5 * 60 * 1000;

// Backoff for re-subscribing the OWN channel after CHANNEL_ERROR / TIMED_OUT / CLOSED.
const PRESENCE_RECOVERY_BACKOFF_MS = [2000, 5000, 10000, 30000] as const;
const MAX_RECOVERY_ATTEMPTS = 10;
// Watch channels are cheap and usually singular; retry on a fixed delay with a cap.
const WATCH_RETRY_DELAY_MS = 5000;
const MAX_WATCH_RETRY_ATTEMPTS = 5;

const presenceTopic = (userId: string) => `presence:user:${userId}`;

class UserPresenceService {
  private static instance: UserPresenceService;

  // --- current user (publish side) ---
  private currentUserId: string | null = null;
  private isTrackingCurrentUser = false;
  private ownChannel: any | null = null;
  private ownChannelHealthy = false;
  private recoveryAttempts = 0;
  private recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
  private presenceUpdateInterval: NodeJS.Timeout | null = null;
  private appStateSubscription: any = null;
  private lastDbWrite = 0;
  private readonly DB_WRITE_COOLDOWN = 60000;

  // --- watched users (subscribe side) ---
  private userStatusSubscriptions = new Map<string, Set<(isOnline: boolean) => void>>();
  private lastNotifiedStatus = new Map<string, boolean>();
  private watchChannels = new Map<string, any>();
  private watchHealthy = new Map<string, boolean>();
  private watchRetryAttempts = new Map<string, number>();
  private watchRetryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  // --- metrics ---
  private metrics = { presenceUpdates: 0, dbWrites: 0, statusQueries: 0, lastReset: Date.now() };
  private metricsLogInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): UserPresenceService {
    if (!UserPresenceService.instance) {
      UserPresenceService.instance = new UserPresenceService();
    }
    return UserPresenceService.instance;
  }

  // ===========================================================================
  // Publish side — current user's own presence (presence:user:{me})
  // ===========================================================================

  async trackCurrentUser(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.warn('[UserPresenceService] Supabase not configured');
      return;
    }
    if (this.isTrackingCurrentUser) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      this.currentUserId = user.id;
      this.isTrackingCurrentUser = true;

      await this.ensureOwnChannel();
      await this.updateOwnPresence();
      await this.writeLastSeenToDatabase();
      this.startPresenceUpdateInterval();
      this.setupAppStateListener();
      this.startMetricsLogging();

      console.log('[UserPresenceService] Started tracking presence');
    } catch (error) {
      console.error('[UserPresenceService] Error tracking current user:', error);
    }
  }

  private async ensureOwnChannel(): Promise<void> {
    if (this.ownChannel || !this.currentUserId) return;
    const userId = this.currentUserId;

    try {
      this.ownChannel = supabase.channel(presenceTopic(userId), {
        config: { presence: { key: userId } },
      });

      this.ownChannel.subscribe((status: string) => {
        this.ownChannelHealthy = status === 'SUBSCRIBED';
        console.log(`[UserPresenceService] Own presence channel status: ${status}`);
        if (status === 'SUBSCRIBED') {
          this.recoveryAttempts = 0;
          if (this.recoveryTimeout) {
            clearTimeout(this.recoveryTimeout);
            this.recoveryTimeout = null;
          }
          // Re-track self so watchers see us online again after a reconnect.
          this.updateOwnPresence().catch(() => {});
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.scheduleOwnChannelRecovery(status);
        }
      });
    } catch (error) {
      console.error('[UserPresenceService] Error creating own presence channel:', error);
    }
  }

  private async updateOwnPresence(): Promise<void> {
    if (!this.ownChannel || !this.currentUserId) return;
    try {
      await this.ownChannel.track({
        user_id: this.currentUserId,
        online_at: new Date().toISOString(),
      });
      this.metrics.presenceUpdates++;
    } catch (error) {
      console.error('[UserPresenceService] Error updating own presence:', error);
    }
  }

  private scheduleOwnChannelRecovery(reason: string): void {
    if (this.recoveryTimeout) return;

    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.warn(
        `[UserPresenceService] Own presence channel ${reason} — giving up after ${this.recoveryAttempts} attempts. ` +
        `Likely a WebSocket-level issue (stale JWT / network / realtime socket dead). Will retry on foreground.`
      );
      this.logRealtimeConnectionState();
      this.ownChannelHealthy = false;
      return;
    }

    const deadChannel = this.ownChannel;
    this.ownChannel = null;
    this.ownChannelHealthy = false;

    const idx = Math.min(this.recoveryAttempts, PRESENCE_RECOVERY_BACKOFF_MS.length - 1);
    const delay = PRESENCE_RECOVERY_BACKOFF_MS[idx];
    this.recoveryAttempts += 1;

    console.warn(
      `[UserPresenceService] Own presence channel ${reason}; retry #${this.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} in ${delay}ms`
    );
    this.logRealtimeConnectionState();

    this.recoveryTimeout = setTimeout(async () => {
      this.recoveryTimeout = null;
      if (!this.isTrackingCurrentUser) {
        this.recoveryAttempts = 0;
        return;
      }
      if (deadChannel) {
        try { await supabase.removeChannel(deadChannel); } catch (_) { /* already torn down */ }
      }
      try {
        await this.ensureOwnChannel();
        await this.updateOwnPresence();
      } catch (err) {
        console.error('[UserPresenceService] Own recovery failed:', err);
        this.scheduleOwnChannelRecovery('retry failed');
      }
    }, delay);
  }

  private logRealtimeConnectionState(): void {
    try {
      const rt: any = (supabase as any).realtime;
      if (!rt) return;
      const info: Record<string, unknown> = {};
      if (typeof rt.isConnected === 'function') info.isConnected = rt.isConnected();
      if (typeof rt.connectionState === 'function') info.connectionState = rt.connectionState();
      if (Array.isArray(rt.channels)) info.channelCount = rt.channels.length;
      console.warn('[UserPresenceService] Realtime socket state:', info);
    } catch (_) { /* diagnostic only */ }
  }

  // ===========================================================================
  // Subscribe side — watching peers (read-only on presence:user:{X})
  // ===========================================================================

  subscribeToUserStatus(
    userId: string,
    callback: (isOnline: boolean) => void
  ): () => void {
    if (!isSupabaseConfigured()) return () => {};

    if (
      !this.userStatusSubscriptions.has(userId) &&
      this.userStatusSubscriptions.size >= MAX_SUBSCRIPTIONS
    ) {
      console.warn('[UserPresenceService] Max watched users reached');
      return () => {};
    }

    if (!this.userStatusSubscriptions.has(userId)) {
      this.userStatusSubscriptions.set(userId, new Set());
    }
    this.userStatusSubscriptions.get(userId)!.add(callback);

    // Open the per-user watch channel (read-only — we never track on a peer topic).
    this.ensureWatchChannel(userId);

    // Seed initial status. The watch channel is not SUBSCRIBED yet (subscribe is
    // async), so this resolves via the DB fallback for an instant first paint;
    // live presence takes over once the channel reaches SUBSCRIBED.
    this.computeWatchedStatus(userId).then(isOnline => {
      this.lastNotifiedStatus.set(userId, isOnline);
      callback(isOnline);
    }).catch(() => {
      this.lastNotifiedStatus.set(userId, false);
      callback(false);
    });

    return () => this.unsubscribeFromUserStatus(userId, callback);
  }

  private unsubscribeFromUserStatus(userId: string, callback: (isOnline: boolean) => void): void {
    const callbacks = this.userStatusSubscriptions.get(userId);
    if (!callbacks) return;
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      this.userStatusSubscriptions.delete(userId);
      this.lastNotifiedStatus.delete(userId);
      this.teardownWatchChannel(userId);
    }
  }

  private ensureWatchChannel(userId: string): void {
    if (this.watchChannels.has(userId) || userId === this.currentUserId) return;

    try {
      const channel = supabase.channel(presenceTopic(userId), {
        config: { presence: { key: userId } },
      });
      this.watchChannels.set(userId, channel);

      channel
        .on('presence', { event: 'sync' }, () => this.notifyForWatchedUser(userId))
        .on('presence', { event: 'join' }, () => this.notifyForWatchedUser(userId))
        .on('presence', { event: 'leave' }, () => this.notifyForWatchedUser(userId))
        .subscribe((status: string) => {
          const healthy = status === 'SUBSCRIBED';
          this.watchHealthy.set(userId, healthy);
          if (healthy) {
            this.watchRetryAttempts.set(userId, 0);
            const t = this.watchRetryTimeouts.get(userId);
            if (t) { clearTimeout(t); this.watchRetryTimeouts.delete(userId); }
            this.notifyForWatchedUser(userId);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            this.scheduleWatchRecovery(userId);
          }
        });
    } catch (error) {
      console.error(`[UserPresenceService] Error creating watch channel for ${userId}:`, error);
    }
  }

  private scheduleWatchRecovery(userId: string): void {
    // Nobody watching anymore — don't resurrect.
    if (!this.userStatusSubscriptions.has(userId)) return;
    if (this.watchRetryTimeouts.has(userId)) return;

    // Push DB-fallback status so the dot isn't stuck on a stale value while down.
    this.notifyForWatchedUser(userId);

    const attempts = this.watchRetryAttempts.get(userId) ?? 0;
    if (attempts >= MAX_WATCH_RETRY_ATTEMPTS) {
      console.warn(`[UserPresenceService] Watch channel for ${userId} giving up after ${attempts} retries`);
      return;
    }
    this.watchRetryAttempts.set(userId, attempts + 1);

    const timeout = setTimeout(async () => {
      this.watchRetryTimeouts.delete(userId);
      if (!this.userStatusSubscriptions.has(userId)) return;
      const dead = this.watchChannels.get(userId);
      this.watchChannels.delete(userId);
      this.watchHealthy.delete(userId);
      if (dead) { try { await supabase.removeChannel(dead); } catch (_) { /* torn down */ } }
      this.ensureWatchChannel(userId);
    }, WATCH_RETRY_DELAY_MS);
    this.watchRetryTimeouts.set(userId, timeout);
  }

  private teardownWatchChannel(userId: string): void {
    const t = this.watchRetryTimeouts.get(userId);
    if (t) { clearTimeout(t); this.watchRetryTimeouts.delete(userId); }
    this.watchRetryAttempts.delete(userId);
    this.watchHealthy.delete(userId);
    const channel = this.watchChannels.get(userId);
    if (channel) {
      this.watchChannels.delete(userId);
      try { supabase.removeChannel(channel); } catch (_) { /* torn down */ }
    }
  }

  private notifyForWatchedUser(userId: string): void {
    this.computeWatchedStatus(userId).then(isOnline => {
      const prev = this.lastNotifiedStatus.get(userId);
      if (prev === isOnline) return; // dedupe — avoids flicker from repeated syncs
      this.lastNotifiedStatus.set(userId, isOnline);
      const callbacks = this.userStatusSubscriptions.get(userId);
      if (!callbacks) return;
      callbacks.forEach(cb => {
        try { cb(isOnline); } catch (e) {
          console.error(`[UserPresenceService] Error in callback for ${userId}:`, e);
        }
      });
    }).catch(() => {});
  }

  /**
   * Status for a watched user. When the watch channel is live, trust presence
   * directly (present => online, absent => offline) for an instant flip. Only when
   * the channel is absent/unhealthy do we fall back to last_seen_at.
   */
  private async computeWatchedStatus(userId: string): Promise<boolean> {
    const channel = this.watchChannels.get(userId);
    if (channel && this.watchHealthy.get(userId)) {
      try {
        const state = channel.presenceState();
        return Object.keys(state).length > 0;
      } catch (_) {
        return this.getUserStatusFromDatabase(userId);
      }
    }
    return this.getUserStatusFromDatabase(userId);
  }

  private async getUserStatusFromDatabase(userId: string): Promise<boolean> {
    this.metrics.statusQueries++;
    try {
      const { data: activity, error } = await supabase
        .from('user_activity')
        .select('last_seen_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !activity?.last_seen_at) return false;
      const diffMinutes = (Date.now() - new Date(activity.last_seen_at).getTime()) / 60000;
      return diffMinutes < ONLINE_THRESHOLD_MINUTES;
    } catch (_) {
      return false;
    }
  }

  // ===========================================================================
  // Heartbeat, DB writes, app state, metrics, teardown
  // ===========================================================================

  private startPresenceUpdateInterval(): void {
    if (this.presenceUpdateInterval) return;
    this.presenceUpdateInterval = setInterval(() => {
      if (this.currentUserId && this.isTrackingCurrentUser) {
        this.updateOwnPresence().catch(() => {});
      }
    }, PRESENCE_UPDATE_INTERVAL);
  }

  private async writeLastSeenToDatabase(): Promise<void> {
    if (!this.currentUserId) return;
    const now = Date.now();
    if (now - this.lastDbWrite < this.DB_WRITE_COOLDOWN) return;

    try {
      const timestamp = new Date().toISOString();
      const { data: existing } = await supabase
        .from('user_activity')
        .select('user_id')
        .eq('user_id', this.currentUserId)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from('user_activity')
          .update({ last_seen_at: timestamp })
          .eq('user_id', this.currentUserId);
        if (updateError) {
          const { error: oldSchemaError } = await supabase
            .from('user_activity')
            .update({ last_seen_at: timestamp, is_online: true, updated_at: timestamp })
            .eq('user_id', this.currentUserId);
          if (oldSchemaError) console.error('[UserPresenceService] Error updating user_activity:', oldSchemaError);
        }
      } else {
        const { error: insertError } = await supabase
          .from('user_activity')
          .insert({ user_id: this.currentUserId, last_seen_at: timestamp });
        if (insertError) {
          const { error: oldSchemaError } = await supabase
            .from('user_activity')
            .insert({ user_id: this.currentUserId, last_seen_at: timestamp, is_online: true, updated_at: timestamp });
          if (oldSchemaError) console.error('[UserPresenceService] Error inserting user_activity:', oldSchemaError);
        }
      }

      this.lastDbWrite = now;
      this.metrics.dbWrites++;
    } catch (error) {
      console.error('[UserPresenceService] Error writing to database:', error);
    }
  }

  private startMetricsLogging(): void {
    if (this.metricsLogInterval) return;
    this.metricsLogInterval = setInterval(() => this.logMetrics(), METRICS_LOG_INTERVAL);
  }

  private logMetrics(): void {
    const elapsed = (Date.now() - this.metrics.lastReset) / 60000;
    if (elapsed > 0) {
      console.log('[PresenceMetrics]', {
        presenceUpdatesPerHour: (this.metrics.presenceUpdates / elapsed) * 60,
        dbWritesPerHour: (this.metrics.dbWrites / elapsed) * 60,
        statusQueriesPerHour: (this.metrics.statusQueries / elapsed) * 60,
        ownChannelHealthy: this.ownChannelHealthy,
        watchedUsers: this.watchChannels.size,
      });
    }
    this.metrics = { presenceUpdates: 0, dbWrites: 0, statusQueries: 0, lastReset: Date.now() };
  }

  private setupAppStateListener(): void {
    if (this.appStateSubscription) return;
    this.appStateSubscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (!this.currentUserId) return;
      if (nextAppState === 'active') {
        // Foregrounding is the natural "try again" signal on mobile.
        if (!this.ownChannelHealthy && this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          console.log('[UserPresenceService] App active — rebuilding own presence channel');
          this.recoveryAttempts = 0;
          this.ensureOwnChannel().catch(err =>
            console.error('[UserPresenceService] App-active rebuild failed:', err));
        }
        await this.updateOwnPresence();
        await this.writeLastSeenToDatabase();
      }
      // We don't mark offline on background; presence drops automatically and
      // last_seen_at expires after the threshold.
    });
  }

  async stopTrackingCurrentUser(): Promise<void> {
    if (!this.isTrackingCurrentUser) return;
    try {
      if (this.ownChannel && this.currentUserId) {
        try { await this.ownChannel.untrack(); } catch (_) { /* best effort */ }
      }

      this.isTrackingCurrentUser = false;
      this.currentUserId = null;

      if (this.presenceUpdateInterval) { clearInterval(this.presenceUpdateInterval); this.presenceUpdateInterval = null; }
      if (this.metricsLogInterval) { clearInterval(this.metricsLogInterval); this.metricsLogInterval = null; }
      if (this.recoveryTimeout) { clearTimeout(this.recoveryTimeout); this.recoveryTimeout = null; }
      this.recoveryAttempts = 0;

      if (this.appStateSubscription) { this.appStateSubscription.remove(); this.appStateSubscription = null; }

      if (this.ownChannel) {
        try { supabase.removeChannel(this.ownChannel); } catch (_) { /* torn down */ }
        this.ownChannel = null;
        this.ownChannelHealthy = false;
      }

      // Tear down all watch channels and their retry timers.
      for (const userId of Array.from(this.watchChannels.keys())) {
        this.teardownWatchChannel(userId);
      }
      this.userStatusSubscriptions.clear();
      this.lastNotifiedStatus.clear();

      console.log('[UserPresenceService] Stopped tracking and cleaned up');
    } catch (error) {
      console.error('[UserPresenceService] Error stopping tracking:', error);
    }
  }

  cleanup(): void {
    this.stopTrackingCurrentUser().catch(() => {});
  }
}

// Export singleton instance
export const userPresenceService = UserPresenceService.getInstance();
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | rg "userPresenceService" || echo "✓ no errors in userPresenceService"`
Expected: `✓ no errors in userPresenceService` (the repo has ~174 pre-existing errors elsewhere; only this file matters here).

- [ ] **Step 3: Self-review checklist (read the diff against the old file)**

Confirm each is true:
- `presence:users` no longer appears anywhere in the file.
- Public methods present with identical signatures: `trackCurrentUser()`, `subscribeToUserStatus(userId, callback)`, `stopTrackingCurrentUser()`, `cleanup()`.
- Deleted methods are gone: `ensurePresenceChannel`, `updateCurrentUserPresence`, `notifyAllSubscribers`, `notifySubscribersForUser`, `getBatchUserStatus`, `getUserStatus`.
- Own channel and watch channels both use `presenceTopic(id)` = `presence:user:{id}`.
- Watcher path never calls `.track()` (only the own channel tracks).

- [ ] **Step 4: Commit**

```bash
git add src/services/presence/userPresenceService.ts
git commit -m "refactor(presence): global presence:users channel -> per-user topics (O(N^2)->O(N))"
```

---

## Task 2: Sanity-check callers and global-channel removal

No code changes — verify the rewrite didn't break the contract.

**Files:** none (verification only)

- [ ] **Step 1: Confirm the global channel is fully gone**

Run: `rg -n "presence:users|notifyAllSubscribers|getBatchUserStatus" src/`
Expected: no matches.

- [ ] **Step 2: Confirm callers still resolve the unchanged API**

Run: `rg -n "userPresenceService\.(trackCurrentUser|subscribeToUserStatus|stopTrackingCurrentUser|cleanup)\b" src/`
Expected: matches in `MessagingProvider.tsx` (track + stop), `logout.ts` (stop), `DirectMessageScreen.tsx` (subscribe), `DirectGroupChat.tsx` (subscribe) — i.e. the same call sites as before, unedited.

- [ ] **Step 3: Full type-check passes for the touched file**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | rg "presence|DirectMessageScreen|DirectGroupChat|MessagingProvider" || echo "✓ no new errors in presence path"`
Expected: `✓ no new errors in presence path`.

---

## Task 3: Manual two-account verification (acceptance criteria)

The only meaningful test of realtime wiring. Run in Expo Go on two accounts (A and B); a third (C) for the isolation check. Presence works in Expo Go (pure JS websocket, no native module).

**Files:** none

- [ ] **Step 1: Live online (criterion 1) — "online = app open anywhere"**

A and B open the A↔B DM on two devices. Foreground A's app but navigate A to a **non-chat** screen (e.g. Trips). Expected: B's header dot for A shows **online** within ~1–2s. Background/close A. Expected: B's dot flips **offline** within a couple seconds (instant-flip, not 5-min lag).

- [ ] **Step 2: No global fan-out (criterion 2)**

With A online and B watching, have a third user C open a DM with **someone other than A**. Watch C's realtime frames (Expo dev tools / network). Expected: C receives **no** presence traffic about A. (Pre-rewrite, every client got every user's presence.)

- [ ] **Step 3: Realtime-down fallback (criterion 3)**

On B, kill connectivity briefly (airplane mode ~10s) while viewing A's chat, then restore. Expected: the dot falls back to `last_seen_at` behavior (A shows online if active in last 5 min) and does **not** get stuck; once reconnected, live presence resumes.

- [ ] **Step 4: Logout teardown (criterion 4)**

Log B out while viewing A's chat. Expected: no console errors from `UserPresenceService`; on re-login presence re-initializes cleanly (A's dot still resolves).

- [ ] **Step 5: Record result**

If all pass, update the spec status line and commit:

```bash
# In docs/superpowers/specs/2026-06-05-presence-rescope-design.md change Status to:
# **Status:** Done — implemented and verified (two-account test passed).
git add docs/superpowers/specs/2026-06-05-presence-rescope-design.md
git commit -m "docs(presence): mark per-user-topics design verified"
```

---

## Self-Review (plan vs spec)

- **Spec §4.1 topology** → Task 1 (`ensureOwnChannel`, `ensureWatchChannel`, `presenceTopic`). ✓
- **Spec §4.3 API preserved / no caller changes** → Task 1 keeps signatures; Task 2 Step 2 verifies call sites unchanged. ✓
- **Spec §4.4 public channels / no migration** → Task 1 creates channels without `{ private: true }`; no migration task exists. ✓
- **Spec §4.5 internals + deletions** → Task 1 deletes `ensurePresenceChannel`/`notifyAllSubscribers`/`notifySubscribersForUser`/`getBatchUserStatus`; Task 2 Step 1 verifies. ✓
- **Spec §4.6 edge cases** → self-watch guard (`userId === this.currentUserId`) in `ensureWatchChannel`; reconnect via `scheduleOwnChannelRecovery`/`scheduleWatchRecovery`; logout teardown in `stopTrackingCurrentUser`. ✓
- **Spec §6 acceptance criteria 1–5** → Task 3 Steps 1–4 (criterion 5 "no UX regression" is covered by Step 1 exercising the real header dot). ✓
- **Placeholder scan:** none. **Type consistency:** `presenceTopic`, `ownChannel`/`ownChannelHealthy`, `watchChannels`/`watchHealthy`/`watchRetryAttempts`/`watchRetryTimeouts`, `computeWatchedStatus` used consistently across Task 1. ✓

> Note: the rewrite also fixes a latent bug in the old code — the global channel set `config.presence.key` to the literal string `'user_id'` (not the actual id), so `presenceState()[userId]` never matched and presence-based lookups silently always fell through to the DB. Per-user topics use "any presence entry = online", which sidesteps the key entirely.
