/**
 * Audio Playback Service
 *
 * Singleton that plays one voice message at a time across the entire app.
 * Tapping play on bubble B while bubble A is playing pauses A automatically
 * (matches WhatsApp / Telegram behavior — never two voices overlapping).
 *
 * Bubbles subscribe by messageId; the service fans out status updates from
 * the active expo-av Sound to whichever bubble currently owns playback.
 * Bubbles for inactive messages just see `isPlaying: false`.
 *
 * Preloading: bubbles call `preload(id, url)` on mount. This warms an LRU
 * cache of loaded Sounds so the first tap on play is effectively instant
 * (no network fetch + AAC decode in the tap path). Cap is small (6) so we
 * don't pile up native decoders for long chats.
 */

import { AppState, AppStateStatus } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';

export interface PlaybackState {
  isPlaying: boolean;
  /** True between the first tap and the moment expo-av reports a loaded
   * status — i.e. while the m4a is being fetched/decoded over the network.
   * Lets bubbles render a spinner so the tap doesn't feel ignored. */
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
}

type Subscriber = (state: PlaybackState) => void;

interface CacheEntry {
  sound: Audio.Sound;
  url: string;
}

const IDLE: PlaybackState = {
  isPlaying: false,
  isLoading: false,
  positionMs: 0,
  durationMs: 0,
};

const CACHE_CAP = 6;

class AudioPlaybackService {
  private cache = new Map<string, CacheEntry>();
  private loadingPromises = new Map<string, Promise<Audio.Sound>>();
  private cacheOrder: string[] = []; // LRU, newest at end
  private activeMessageId: string | null = null;
  private subscribers = new Map<string, Set<Subscriber>>();
  private appStateSubscription: { remove: () => void } | null = null;

  constructor() {
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = (next: AppStateStatus) => {
    if (next === 'background' || next === 'inactive') {
      // Pause on background — don't unload, so resume is instant.
      this.pause(this.activeMessageId ?? undefined);
    }
  };

  private notify(messageId: string, state: PlaybackState) {
    const subs = this.subscribers.get(messageId);
    if (!subs) return;
    subs.forEach((cb) => cb(state));
  }

  private notifyIdle(messageId: string) {
    this.notify(messageId, IDLE);
  }

  private handleStatusFor = (messageId: string, status: AVPlaybackStatus) => {
    // Background sounds (paused, in cache) still tick occasionally — ignore.
    if (this.activeMessageId !== messageId) return;
    if (!status.isLoaded) {
      this.notifyIdle(messageId);
      return;
    }
    const state: PlaybackState = {
      isPlaying: status.isPlaying === true,
      isLoading: false,
      positionMs: status.positionMillis ?? 0,
      durationMs: status.durationMillis ?? 0,
    };
    this.notify(messageId, state);

    if (status.didJustFinish) {
      const entry = this.cache.get(messageId);
      entry?.sound.setPositionAsync(0).catch(() => undefined);
      this.notify(messageId, { ...state, isPlaying: false, positionMs: 0 });
    }
  };

  private touchLRU(id: string) {
    const idx = this.cacheOrder.indexOf(id);
    if (idx >= 0) this.cacheOrder.splice(idx, 1);
    this.cacheOrder.push(id);
    // Evict oldest beyond cap, but never the active message.
    while (this.cacheOrder.length > CACHE_CAP) {
      const oldestIdx = this.cacheOrder.findIndex((id) => id !== this.activeMessageId);
      if (oldestIdx === -1) break;
      const evicted = this.cacheOrder.splice(oldestIdx, 1)[0];
      const entry = this.cache.get(evicted);
      if (entry) {
        entry.sound.unloadAsync().catch(() => undefined);
        this.cache.delete(evicted);
      }
    }
  }

  private async loadInto(messageId: string, url: string): Promise<Audio.Sound> {
    const { sound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: false, progressUpdateIntervalMillis: 50 },
      (status) => this.handleStatusFor(messageId, status)
    );
    this.cache.set(messageId, { sound, url });
    this.touchLRU(messageId);
    return sound;
  }

  /** Warm the cache for a message. Idempotent and fire-and-forget. */
  preload(messageId: string, url: string): void {
    if (!url) return;
    const existing = this.cache.get(messageId);
    if (existing && existing.url === url) return;
    if (this.loadingPromises.has(messageId)) return;

    // URL changed (optimistic local URI → public URL after upload). Drop stale.
    if (existing && existing.url !== url) {
      existing.sound.unloadAsync().catch(() => undefined);
      this.cache.delete(messageId);
      const idx = this.cacheOrder.indexOf(messageId);
      if (idx >= 0) this.cacheOrder.splice(idx, 1);
    }

    const promise = this.loadInto(messageId, url)
      .catch((err) => {
        console.warn('[audioPlaybackService] preload failed:', err);
        throw err;
      })
      .finally(() => {
        this.loadingPromises.delete(messageId);
      });
    this.loadingPromises.set(messageId, promise);
  }

  /** Start (or resume) playback of a specific message. Pauses any other. */
  async play(messageId: string, url: string): Promise<void> {
    // Already active for this message — just resume in place.
    if (this.activeMessageId === messageId) {
      const entry = this.cache.get(messageId);
      if (entry) {
        await entry.sound.playAsync().catch(() => undefined);
        return;
      }
    }

    // Switching messages: pause the previous one but keep it cached so a
    // later tap on it is instant.
    if (this.activeMessageId && this.activeMessageId !== messageId) {
      const prev = this.cache.get(this.activeMessageId);
      if (prev) {
        prev.sound.pauseAsync().catch(() => undefined);
        this.notifyIdle(this.activeMessageId);
      }
    }

    this.activeMessageId = messageId;

    // Resolve a Sound: cached → in-flight preload → load now.
    let sound: Audio.Sound | undefined = this.cache.get(messageId)?.sound;

    if (!sound) {
      // Show spinner only when we actually have to wait for I/O.
      this.notify(messageId, {
        isPlaying: false,
        isLoading: true,
        positionMs: 0,
        durationMs: 0,
      });
      try {
        if (this.loadingPromises.has(messageId)) {
          sound = await this.loadingPromises.get(messageId)!;
        } else {
          this.preload(messageId, url);
          sound = await this.loadingPromises.get(messageId)!;
        }
      } catch {
        // Load failed; clear active state and reset bubble.
        if (this.activeMessageId === messageId) {
          this.activeMessageId = null;
          this.notifyIdle(messageId);
        }
        return;
      }
    }

    // A newer play() may have raced and switched activeMessageId already.
    if (this.activeMessageId !== messageId) return;

    this.touchLRU(messageId);

    try {
      // Ensure status callback is bound to this message (createAsync wired it,
      // but rebinding is cheap and survives any prior detach).
      sound.setOnPlaybackStatusUpdate((status) => this.handleStatusFor(messageId, status));
      await sound.playAsync();
    } catch (err) {
      console.error('[audioPlaybackService] playAsync failed:', err);
      if (this.activeMessageId === messageId) {
        this.activeMessageId = null;
        this.notifyIdle(messageId);
      }
    }
  }

  /** Pause the active sound. Pass a messageId to no-op if it's not active. */
  async pause(messageId?: string): Promise<void> {
    if (!this.activeMessageId) return;
    if (messageId && this.activeMessageId !== messageId) return;
    const entry = this.cache.get(this.activeMessageId);
    if (!entry) return;
    try {
      await entry.sound.pauseAsync();
    } catch {
      // ignore
    }
  }

  /** Subscribe to status for a given messageId. Returns unsubscribe. */
  subscribe(messageId: string, cb: Subscriber): () => void {
    let set = this.subscribers.get(messageId);
    if (!set) {
      set = new Set();
      this.subscribers.set(messageId, set);
    }
    set.add(cb);
    return () => {
      const s = this.subscribers.get(messageId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.subscribers.delete(messageId);
    };
  }

  /** True if the given message is the one currently playing. */
  isActive(messageId: string): boolean {
    return this.activeMessageId === messageId;
  }
}

export const audioPlaybackService = new AudioPlaybackService();
