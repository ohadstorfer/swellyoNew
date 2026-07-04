jest.mock('../../../config/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => false }));
jest.mock('../inAppBannerBus', () => ({ showInAppBanner: jest.fn() }));
jest.mock('../notificationsService', () => {
  const actual = jest.requireActual('../notificationsService');
  return { ...actual, isNotificationsScreenOpen: jest.fn(() => false) };
});

import { handleBellInsert } from '../bellBannerSource';
import { showInAppBanner } from '../inAppBannerBus';
import { isNotificationsScreenOpen } from '../notificationsService';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1', recipient_id: 'me', trip_id: 't1', type: 'member_joined',
  audience: 'user', actor_id: 'actor', entity_type: null, entity_id: null,
  data: { actor_name: 'Ana', trip_title: 'El Salvador 26' },
  read_at: null, handled_at: null, created_at: 'now',
  ...over,
} as any);
const ctx = { userId: 'me', openTrip: jest.fn() };

describe('handleBellInsert', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a banner with rendered title/body and trip tap', () => {
    handleBellInsert(row(), ctx);
    expect(showInAppBanner).toHaveBeenCalledTimes(1);
    const p = (showInAppBanner as jest.Mock).mock.calls[0][0];
    expect(p.id).toBe('n1');
    expect(typeof p.title).toBe('string');
    expect(p.title.length).toBeGreaterThan(0);
    p.onPress();
    expect(ctx.openTrip).toHaveBeenCalledWith('t1', expect.anything());
  });

  it('skips own-actor rows', () => {
    handleBellInsert(row({ actor_id: 'me' }), ctx);
    expect(showInAppBanner).not.toHaveBeenCalled();
  });

  it('skips while the notifications screen is open', () => {
    (isNotificationsScreenOpen as jest.Mock).mockReturnValueOnce(true);
    handleBellInsert(row(), ctx);
    expect(showInAppBanner).not.toHaveBeenCalled();
  });

  it('still shows rows without trip_id (no-op press)', () => {
    handleBellInsert(row({ trip_id: null }), ctx);
    expect(showInAppBanner).toHaveBeenCalledTimes(1);
    expect(() => (showInAppBanner as jest.Mock).mock.calls[0][0].onPress?.()).not.toThrow();
    expect(ctx.openTrip).not.toHaveBeenCalled();
  });

  it('swallows malformed rows without throwing', () => {
    expect(() => handleBellInsert({ id: 'x' } as any, ctx)).not.toThrow();
  });
});
