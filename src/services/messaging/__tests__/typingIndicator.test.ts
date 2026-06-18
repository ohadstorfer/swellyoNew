// Characterization tests for startTyping/stopTyping after the WhatsApp-style
// typing changes:
//  - a caller-supplied userId must AVOID the auth.getUser() network round-trip
//  - the server-side safety valve discards keepalives arriving < 2s apart
//  - stopTyping broadcasts isTyping:false (and also skips getUser when given a userId)
const mockGetUser = jest.fn(async () => ({ data: { user: { id: 'auth-user' } } }));

jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { messagingService } from '../messagingService';

const CONV = 'c1';
const mockSend = jest.fn(async () => 'ok');

// startTyping/stopTyping only SEND on an already-open channel (getChannel reads
// the private activeChannels map). Inject a fake channel so the send path runs.
function primeChannel() {
  (messagingService as any).activeChannels.set(CONV, { send: mockSend });
}

beforeEach(() => {
  jest.clearAllMocks();
  (messagingService as any).activeChannels.clear();
  (messagingService as any).lastTypingEvent.clear();
  primeChannel();
});

describe('startTyping', () => {
  it('uses the supplied userId and does NOT call auth.getUser()', async () => {
    await messagingService.startTyping(CONV, 'u1');
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: 'u1', isTyping: true },
    });
  });

  it('falls back to auth.getUser() when no userId is supplied', async () => {
    await messagingService.startTyping(CONV);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: 'auth-user', isTyping: true },
    });
  });

  it('discards a second keepalive fired < 2s after the first (server safety valve)', async () => {
    await messagingService.startTyping(CONV, 'u1');
    await messagingService.startTyping(CONV, 'u1'); // immediate → within 2s window
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('sends again once the 2s window has elapsed', async () => {
    await messagingService.startTyping(CONV, 'u1');
    // Simulate >2s since the last event without real waiting.
    (messagingService as any).lastTypingEvent.set(CONV, Date.now() - 3000);
    await messagingService.startTyping(CONV, 'u1');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the conversation has no open channel', async () => {
    (messagingService as any).activeChannels.clear();
    await messagingService.startTyping(CONV, 'u1');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('stopTyping', () => {
  it('broadcasts isTyping:false with the supplied userId and no auth.getUser()', async () => {
    await messagingService.stopTyping(CONV, 'u1');
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: 'u1', isTyping: false },
    });
  });

  it('is not rate-limited (always sends)', async () => {
    await messagingService.stopTyping(CONV, 'u1');
    await messagingService.stopTyping(CONV, 'u1');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
