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

const IDLE: PlaybackState = {
  isPlaying: false,
  isLoading: false,
  positionMs: 0,
  durationMs: 0,
};

class AudioPlaybackService {
  private sound: Audio.Sound | null = null;
  private activeMessageId: string | null = null;
  // Race guards. createAsync is async and starts playing on resolve, so
  // rapid taps before the first Sound finishes constructing can each fire
  // their own createAsync — both then play the same URL and one ends up
  // orphaned outside the singleton. pendingLoadId de-dups taps for the
  // SAME message during the load window; loadGeneration lets a newer
  // play() call discard the older in-flight Sound when it eventually
  // resolves (cross-message switching during load).
  private pendingLoadId: string | null = null;
  private loadGeneration = 0;
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

  private handleStatus = (status: AVPlaybackStatus) => {
    if (!this.activeMessageId) return;
    if (!status.isLoaded) {
      // Errored or unloaded.
      this.notifyIdle(this.activeMessageId);
      return;
    }
    const state: PlaybackState = {
      isPlaying: status.isPlaying === true,
      isLoading: false, // Got a loaded status — we're past the load window.
      positionMs: status.positionMillis ?? 0,
      durationMs: status.durationMillis ?? 0,
    };
    this.notify(this.activeMessageId, state);

    if (status.didJustFinish) {
      // Reset so a second play starts from the beginning.
      this.sound?.setPositionAsync(0).catch(() => undefined);
      this.notify(this.activeMessageId, { ...state, isPlaying: false, positionMs: 0 });
    }
  };

  /** Start (or resume) playback of a specific message. Pauses any other. */
  async play(messageId: string, url: string): Promise<void> {
    // Already playing this message → just resume.
    if (this.activeMessageId === messageId && this.sound) {
      await this.sound.playAsync().catch(() => undefined);
      return;
    }

    // A load for this exact message is already in flight (rapid double-tap
    // before the Sound finishes constructing) — drop the duplicate.
    if (this.pendingLoadId === messageId) {
      return;
    }

    const gen = ++this.loadGeneration;
    this.pendingLoadId = messageId;

    // Tear down any current sound. If a previous load is still in flight,
    // the generation bump above causes it to discard its Sound when it
    // resolves rather than overwriting this.sound.
    if (this.sound) {
      const previousId = this.activeMessageId;
      const oldSound = this.sound;
      this.sound = null;
      oldSound.unloadAsync().catch(() => undefined);
      if (previousId) this.notifyIdle(previousId);
    }

    this.activeMessageId = messageId;
    // Immediately tell the bubble "you tapped, we're loading" so it can swap
    // its play icon for a spinner. The first real status update from expo-av
    // (firing once the Sound is loaded and starts playing) will flip
    // isLoading back to false.
    this.notify(messageId, {
      isPlaying: false,
      isLoading: true,
      positionMs: 0,
      durationMs: 0,
    });

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, progressUpdateIntervalMillis: 50 },
        this.handleStatus
      );
      if (gen !== this.loadGeneration) {
        // Superseded by a newer play() — orphan, unload immediately.
        sound.unloadAsync().catch(() => undefined);
        return;
      }
      this.sound = sound;
    } catch (err) {
      console.error('[audioPlaybackService] createAsync failed:', err);
      if (gen === this.loadGeneration) {
        this.activeMessageId = null;
        this.notifyIdle(messageId);
      }
    } finally {
      if (gen === this.loadGeneration) {
        this.pendingLoadId = null;
      }
    }
  }

  /** Pause the active sound. Pass a messageId to no-op if it's not active. */
  async pause(messageId?: string): Promise<void> {
    if (!this.sound) return;
    if (messageId && this.activeMessageId !== messageId) return;
    try {
      await this.sound.pauseAsync();
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
