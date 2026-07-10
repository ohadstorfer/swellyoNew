const queues: Record<string, { data: any; error: any }[]> = {};
const makeBuilder = (result: { data: any; error: any }) => {
  const b: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'lte', 'lt', 'gt', 'in', 'single', 'maybeSingle']) b[m] = jest.fn(() => b);
  b.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
  return b;
};
jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: (t: string) => {
      const q = queues[t];
      if (!q || !q.length) throw new Error(`unexpected query on ${t}`);
      return makeBuilder(q.shift()!);
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
    },
  },
}));
import { messagingService } from '../messagingService';

const surfers = [{ user_id: 'u2', name: 'Ana', profile_image_url: null }];

describe('reactions embedded in message fetches', () => {
  beforeEach(() => { for (const k of Object.keys(queues)) delete queues[k]; });

  it('getMessages aggregates embedded message_reactions into reactions', async () => {
    // Descending order (newest first) as the server returns for initial load
    const rows = [
      {
        id: 'm2', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-07-10T12:01:00Z', type: 'text',
        message_reactions: [
          { user_id: 'u1', reaction: '❤️', reacted_at: '2026-07-10T12:02:00Z' },
          { user_id: 'u2', reaction: '❤️', reacted_at: '2026-07-10T12:03:00Z' },
          { user_id: 'u3', reaction: '😂', reacted_at: '2026-07-10T12:04:00Z' },
        ],
      },
      { id: 'm1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-07-10T12:00:00Z', type: 'text', message_reactions: [] },
    ];
    queues['messages'] = [{ data: rows, error: null }];
    queues['surfers'] = [{ data: surfers, error: null }];

    const out = await messagingService.getMessages('c1', 30);
    const m2 = out.messages.find(m => m.id === 'm2')!;
    expect(m2.reactions).toEqual([
      { emoji: '❤️', count: 2, userIds: ['u1', 'u2'], hasMine: true },
      { emoji: '😂', count: 1, userIds: ['u3'], hasMine: false },
    ]);
    // Server fetches are authoritative: no rows → empty array, NOT undefined,
    // so merges can distinguish "server says none" from "source doesn't know".
    const m1 = out.messages.find(m => m.id === 'm1')!;
    expect(m1.reactions).toEqual([]);
    // Raw embed is folded away
    expect((m2 as any).message_reactions).toBeUndefined();
  });

  it('getMessagesUpdatedSince aggregates embedded message_reactions', async () => {
    const rows = [
      {
        id: 'm9', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-07-10T12:00:00Z',
        updated_at: '2026-07-10T12:05:00Z', type: 'text',
        message_reactions: [{ user_id: 'u2', reaction: '👍', reacted_at: '2026-07-10T12:04:00Z' }],
      },
    ];
    queues['messages'] = [{ data: rows, error: null }];
    queues['surfers'] = [{ data: surfers, error: null }];

    const out = await messagingService.getMessagesUpdatedSince('c1', Date.parse('2026-07-10T12:01:00Z'), 50);
    expect(out[0].reactions).toEqual([
      { emoji: '👍', count: 1, userIds: ['u2'], hasMine: false },
    ]);
    expect((out[0] as any).message_reactions).toBeUndefined();
  });

  it('getMessagesAround aggregates embedded message_reactions', async () => {
    const target = {
      id: 't', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T12:00:00Z', type: 'text',
      message_reactions: [{ user_id: 'u1', reaction: '🔥', reacted_at: '2026-06-17T12:01:00Z' }],
    };
    queues['messages'] = [
      { data: { created_at: target.created_at }, error: null }, // target lookup
      { data: [target], error: null },                          // older (incl. target)
      { data: [], error: null },                                // newer
    ];
    queues['surfers'] = [{ data: surfers, error: null }];

    const out = await messagingService.getMessagesAround('c1', 't', 10);
    expect(out.messages[0].reactions).toEqual([
      { emoji: '🔥', count: 1, userIds: ['u1'], hasMine: true },
    ]);
  });
});
