/**
 * Unit tests for the pure foreground-notification gate.
 *
 * SAFETY: zero network, zero DB. We import only the pure helper; the supabase
 * client is mocked so importing the service never opens a connection.
 */
jest.mock('../../../config/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: () => false,
}));

import { shouldShowForegroundNotification } from '../pushNotificationService';

/** Baseline args; individual tests override what they exercise. */
const base = {
  notificationType: undefined as string | undefined,
  conversationId: null as string | null | undefined,
  currentConversationId: null as string | null,
  isNotificationsScreenOpen: false,
  isForeground: true,
};

describe('shouldShowForegroundNotification', () => {
  describe('message notifications (behavior unchanged, sound follows show)', () => {
    it('shows with sound when foreground and a DIFFERENT conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
        })
      ).toEqual({ show: true, sound: true });
    });

    it('suppresses when foreground and the SAME conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-A',
        })
      ).toEqual({ show: false, sound: false });
    });

    it('shows when foreground and NO conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
        })
      ).toEqual({ show: true, sound: true });
    });

    it('shows when backgrounded (different conversation)', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });

    it('ignores the notifications-screen flag for messages', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'message',
          conversationId: 'conv-A',
          isNotificationsScreenOpen: true,
        })
      ).toEqual({ show: true, sound: true });
    });
  });

  describe('bell notifications (new: in-app banners, silent in foreground)', () => {
    const BELL_SAMPLE = [
      'join_request_received',
      'commitment_decided',
      'gear_request_received',
      'member_joined',
      'trip_reminder',
    ];

    it.each(BELL_SAMPLE)(
      '%s shows SILENTLY in foreground when notifications screen is closed',
      (type) => {
        expect(
          shouldShowForegroundNotification({ ...base, notificationType: type })
        ).toEqual({ show: true, sound: false });
      }
    );

    it.each(BELL_SAMPLE)(
      '%s is suppressed in foreground when notifications screen is OPEN',
      (type) => {
        expect(
          shouldShowForegroundNotification({
            ...base,
            notificationType: type,
            isNotificationsScreenOpen: true,
          })
        ).toEqual({ show: false, sound: false });
      }
    );

    it('shows with sound when backgrounded', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'join_request_received',
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });

    it('shows when backgrounded even if the screen flag is stale-open', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'join_request_received',
          isNotificationsScreenOpen: true,
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });
  });

  describe('unknown / missing types (legacy: suppressed in foreground)', () => {
    it('suppresses an unknown type in the foreground', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'some_future_type',
        })
      ).toEqual({ show: false, sound: false });
    });

    it('suppresses a missing type in the foreground', () => {
      expect(shouldShowForegroundNotification({ ...base })).toEqual({
        show: false,
        sound: false,
      });
    });

    it('shows an unknown type when backgrounded', () => {
      expect(
        shouldShowForegroundNotification({
          ...base,
          notificationType: 'some_future_type',
          isForeground: false,
        })
      ).toEqual({ show: true, sound: true });
    });
  });
});
