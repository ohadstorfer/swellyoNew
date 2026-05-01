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
}

const IDLE: ProfileVideoUploadEntry = { status: 'idle' };

const state = new Map<string, ProfileVideoUploadEntry>();
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((l) => l());
};

const set = (userId: string, entry: ProfileVideoUploadEntry) => {
  state.set(userId, entry);
  notify();
};

export const profileVideoUploadTracker = {
  get(userId: string | null | undefined): ProfileVideoUploadEntry {
    if (!userId) return IDLE;
    return state.get(userId) ?? IDLE;
  },
  start(userId: string) {
    set(userId, { status: 'uploading' });
  },
  markProcessing(userId: string) {
    set(userId, { status: 'processing' });
  },
  succeed(userId: string) {
    set(userId, { status: 'success' });
  },
  fail(userId: string, error: string) {
    set(userId, { status: 'failed', error });
  },
  reset(userId: string) {
    set(userId, IDLE);
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
