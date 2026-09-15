/**
 * The OS notification prompt is one-shot per install on iOS, and it belongs to
 * the "Stay in the loop" popup on Explore. These tests pin that ownership: the
 * background registration paths (session restore, onboarding step 1, reaching
 * the main app) must never spend the prompt on their own.
 */
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetExpoPushToken = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: any[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: any[]) => mockRequestPermissions(...args),
  getExpoPushTokenAsync: (...args: any[]) => mockGetExpoPushToken(...args),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));

jest.mock('../../../config/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() } },
  isSupabaseConfigured: () => true,
}));

import { pushNotificationService } from '../pushNotificationService';

beforeEach(() => {
  jest.clearAllMocks();
  // The service is a singleton — reset the registration memo between tests.
  (pushNotificationService as any).isRegistered = false;
  (pushNotificationService as any).currentToken = null;
  (pushNotificationService as any).tokenSubscription = null;
});

describe('registerForPushNotifications', () => {
  it('never asks the OS — it only registers what permission already allows', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined', canAskAgain: true });

    const token = await pushNotificationService.registerForPushNotifications();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(token).toBeNull();
  });

  it('leaves isRegistered false when permission is missing, so a later call retries', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });

    await pushNotificationService.registerForPushNotifications();

    expect((pushNotificationService as any).isRegistered).toBe(false);
  });

  it('fetches a token once permission is already granted', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted', canAskAgain: false });
    mockGetExpoPushToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    await pushNotificationService.registerForPushNotifications();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetExpoPushToken).toHaveBeenCalled();
  });
});

describe('getPermissionState', () => {
  it.each([
    [{ status: 'granted', canAskAgain: false }, 'granted'],
    [{ status: 'undetermined', canAskAgain: true }, 'undetermined'],
    // Refused once: iOS will not show the prompt again, so Settings is the only route.
    [{ status: 'denied', canAskAgain: false }, 'blocked'],
  ])('maps %j to %s', async (permissions, expected) => {
    mockGetPermissions.mockResolvedValue(permissions);
    await expect(pushNotificationService.getPermissionState()).resolves.toBe(expected);
  });
});

describe('requestPermission', () => {
  it('shows the OS prompt and registers when the user allows', async () => {
    mockGetPermissions
      .mockResolvedValueOnce({ status: 'undetermined', canAskAgain: true }) // getPermissionState
      .mockResolvedValue({ status: 'granted', canAskAgain: false }); // register's own check
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockGetExpoPushToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    await expect(pushNotificationService.requestPermission()).resolves.toBe('granted');
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockGetExpoPushToken).toHaveBeenCalled();
  });

  it('reports blocked when the user refuses at the prompt', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    await expect(pushNotificationService.requestPermission()).resolves.toBe('blocked');
  });

  it('does not re-prompt someone who already refused', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });

    await expect(pushNotificationService.requestPermission()).resolves.toBe('blocked');
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});
