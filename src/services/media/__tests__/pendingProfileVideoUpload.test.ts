import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// The record CRUD under test never calls these, but the module imports them at
// load time — stub so the suite doesn't pull in the real upload/analytics stack.
jest.mock('../../storage/storageService', () => ({ uploadProfileVideoS3: jest.fn() }));
jest.mock('../../analytics/analyticsService', () => ({ analyticsService: { track: jest.fn() } }));

import {
  savePendingUpload,
  getPendingUpload,
  clearPendingUpload,
  MAX_UPLOAD_ATTEMPTS,
  type PendingProfileVideoUpload,
} from '../pendingProfileVideoUpload';

const rec = (over: Partial<PendingProfileVideoUpload> = {}): PendingProfileVideoUpload => ({
  localUri: 'file:///documents/pending-profile-video.mp4',
  userId: 'user-1',
  mimeType: 'video/mp4',
  createdAt: 1_700_000_000_000,
  attempts: 1,
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('pending profile-video record CRUD', () => {
  it('round-trips a saved record', async () => {
    await savePendingUpload(rec());
    expect(await getPendingUpload()).toEqual(rec());
  });

  it('returns null when nothing is pending', async () => {
    expect(await getPendingUpload()).toBeNull();
  });

  it('clears a record', async () => {
    await savePendingUpload(rec());
    await clearPendingUpload();
    expect(await getPendingUpload()).toBeNull();
  });

  it('overwrites the single slot (only one pending video ever)', async () => {
    await savePendingUpload(rec({ userId: 'first' }));
    await savePendingUpload(rec({ userId: 'second' }));
    expect((await getPendingUpload())?.userId).toBe('second');
  });

  it('ignores a corrupt / partial blob rather than throwing', async () => {
    await AsyncStorage.setItem('swellyo_pending_profile_video_upload', '{not valid json');
    expect(await getPendingUpload()).toBeNull();
  });

  it('rejects a record missing required fields', async () => {
    await AsyncStorage.setItem(
      'swellyo_pending_profile_video_upload',
      JSON.stringify({ mimeType: 'video/mp4' }),
    );
    expect(await getPendingUpload()).toBeNull();
  });

  it('defaults a missing attempts count to 1', async () => {
    await AsyncStorage.setItem(
      'swellyo_pending_profile_video_upload',
      JSON.stringify({ localUri: 'file:///x.mp4', userId: 'u' }),
    );
    expect((await getPendingUpload())?.attempts).toBe(1);
  });

  it('persists a bumped attempt count (the resume path re-saves attempts+1)', async () => {
    await savePendingUpload(rec({ attempts: 1 }));
    const first = await getPendingUpload();
    await savePendingUpload({ ...first!, attempts: first!.attempts + 1 });
    expect((await getPendingUpload())?.attempts).toBe(2);
  });

  it('MAX_UPLOAD_ATTEMPTS is the give-up threshold (3)', () => {
    // Guards the resume cap: attempts >= MAX means stop retrying.
    expect(MAX_UPLOAD_ATTEMPTS).toBe(3);
    expect(2 < MAX_UPLOAD_ATTEMPTS).toBe(true); // attempt 2 still retries
    expect(3 < MAX_UPLOAD_ATTEMPTS).toBe(false); // attempt 3 gives up
  });
});
