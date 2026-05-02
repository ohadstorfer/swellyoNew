import { useSyncExternalStore } from 'react';

export type ProfileVideoUploadStatus =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'success'
  | 'failed';

export interface ProfileVideoUploadEntry {
  status: ProfileVideoUploadStatus;
  error?: string;
  /** Local URI / data URL of a thumbnail captured client-side at Save time.
   *  Persists across status transitions so the surf-skill card can flip to
   *  the user's clip the instant they pick + Save, without waiting for
   *  MediaConvert to finish. */
  localThumbnail?: string;
}

const IDLE: ProfileVideoUploadEntry = { status: 'idle' };

const state = new Map<string, ProfileVideoUploadEntry>();
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((l) => l());
};

const update = (
  userId: string,
  patch: Partial<ProfileVideoUploadEntry> & Pick<ProfileVideoUploadEntry, 'status'>,
) => {
  const prev = state.get(userId) ?? IDLE;
  state.set(userId, { ...prev, ...patch });
  notify();
};

export const profileVideoUploadTracker = {
  get(userId: string | null | undefined): ProfileVideoUploadEntry {
    if (!userId) return IDLE;
    return state.get(userId) ?? IDLE;
  },
  start(userId: string) {
    // Preserve any thumbnail already set by setLocalThumbnail before start().
    update(userId, { status: 'uploading', error: undefined });
  },
  setLocalThumbnail(userId: string, uri: string) {
    const prev = state.get(userId) ?? IDLE;
    state.set(userId, { ...prev, localThumbnail: uri });
    notify();
  },
  markProcessing(userId: string) {
    update(userId, { status: 'processing' });
  },
  succeed(userId: string) {
    // Keep localThumbnail — the user's clip is now live, the card should keep showing it.
    update(userId, { status: 'success' });
  },
  fail(userId: string, error: string) {
    // Drop the local thumbnail too: the clip never made it, so showing it is misleading.
    state.set(userId, { status: 'failed', error });
    notify();
  },
  reset(userId: string) {
    // Reset to idle but keep localThumbnail so the card stays on the user's clip
    // for the rest of the session.
    const prev = state.get(userId) ?? IDLE;
    state.set(userId, { status: 'idle', localThumbnail: prev.localThumbnail });
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useProfileVideoUploadStatus(
  userId: string | null | undefined,
): ProfileVideoUploadEntry {
  return useSyncExternalStore(
    profileVideoUploadTracker.subscribe,
    () => profileVideoUploadTracker.get(userId),
    () => profileVideoUploadTracker.get(userId),
  );
}
