jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => false,
  supabase: {},
}));
import { chatHistoryCache } from '../chatHistoryCache';
import type { Message } from '../messagingService';

const base = (over: Partial<Message>): Message => ({
  id: 'm1',
  conversation_id: 'c1',
  sender_id: 'u2',
  created_at: '2026-07-10T12:00:00Z',
  type: 'text',
  ...over,
} as Message);

const heart = [{ emoji: '❤️', count: 1, userIds: ['u2'], hasMine: false }];

describe('mergeMessages reaction preservation', () => {
  it('keeps cached reactions when the incoming row does not carry the field (realtime payload)', () => {
    const cached = [base({ reactions: heart })];
    const incoming = [base({ edited: true })]; // no `reactions` key — source doesn't know
    const merged = chatHistoryCache.mergeMessages(cached, incoming);
    expect(merged[0].edited).toBe(true);
    expect(merged[0].reactions).toEqual(heart);
  });

  it('takes the incoming reactions when the source provides them (server fetch)', () => {
    const cached = [base({ reactions: heart })];
    const incoming = [base({ reactions: [] })]; // server says: none left
    const merged = chatHistoryCache.mergeMessages(cached, incoming);
    expect(merged[0].reactions).toEqual([]);
  });

  it('adds brand-new messages untouched', () => {
    const cached = [base({ reactions: heart })];
    const incoming = [base({ id: 'm2', created_at: '2026-07-10T12:01:00Z' })];
    const merged = chatHistoryCache.mergeMessages(cached, incoming);
    expect(merged.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(merged[0].reactions).toEqual(heart);
    expect(merged[1].reactions).toBeUndefined();
  });
});
