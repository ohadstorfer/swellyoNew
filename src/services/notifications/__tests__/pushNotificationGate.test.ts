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

describe('shouldShowForegroundNotification', () => {
  describe('message notifications', () => {
    it('shows when foreground and a DIFFERENT conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
          isForeground: true,
        })
      ).toBe(true);
    });

    it('suppresses when foreground and the SAME conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-A',
          isForeground: true,
        })
      ).toBe(false);
    });

    it('shows when foreground and NO conversation is open', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: null,
          isForeground: true,
        })
      ).toBe(true);
    });

    it('shows when backgrounded (different conversation)', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'message',
          conversationId: 'conv-A',
          currentConversationId: 'conv-B',
          isForeground: false,
        })
      ).toBe(true);
    });
  });

  describe('non-message notifications (unchanged behavior)', () => {
    it('suppresses in the foreground', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'trip_reminder',
          conversationId: null,
          currentConversationId: null,
          isForeground: true,
        })
      ).toBe(false);
    });

    it('shows when backgrounded', () => {
      expect(
        shouldShowForegroundNotification({
          notificationType: 'trip_reminder',
          conversationId: null,
          currentConversationId: null,
          isForeground: false,
        })
      ).toBe(true);
    });
  });
});
