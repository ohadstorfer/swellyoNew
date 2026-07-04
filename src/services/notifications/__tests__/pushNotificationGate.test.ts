/**
 * The custom in-app banner (InAppBannerHost, realtime-driven) now owns ALL
 * foreground notifications, so the native gate is back to the legacy rule:
 * suppress everything while foregrounded, show when backgrounded.
 */
jest.mock('../../../config/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: () => false,
}));

import { shouldShowForegroundNotification } from '../pushNotificationService';

const base = {
  notificationType: undefined as string | undefined,
  conversationId: null as string | null | undefined,
  currentConversationId: null as string | null,
  isNotificationsScreenOpen: false,
  isForeground: true,
};

describe('shouldShowForegroundNotification (custom-banner era)', () => {
  it.each(['message', 'join_request_received', 'commitment_decided', 'unknown_type', undefined])(
    'suppresses %s while foregrounded',
    (type) => {
      expect(shouldShowForegroundNotification({ ...base, notificationType: type as any }))
        .toEqual({ show: false, sound: false });
    }
  );

  it.each(['message', 'join_request_received', 'trip_reminder', 'unknown_type'])(
    'shows %s with sound when backgrounded',
    (type) => {
      expect(
        shouldShowForegroundNotification({ ...base, notificationType: type as any, isForeground: false })
      ).toEqual({ show: true, sound: true });
    }
  );

  it('suppresses a background message for the conversation that is somehow still marked open', () => {
    expect(
      shouldShowForegroundNotification({
        ...base,
        notificationType: 'message',
        conversationId: 'c1',
        currentConversationId: 'c1',
        isForeground: false,
      })
    ).toEqual({ show: false, sound: false });
  });

  it('flags (screen open / same conversation) never force-show in foreground', () => {
    expect(
      shouldShowForegroundNotification({
        ...base,
        notificationType: 'message',
        conversationId: 'c1',
        currentConversationId: 'c2',
        isNotificationsScreenOpen: true,
      })
    ).toEqual({ show: false, sound: false });
  });
});
