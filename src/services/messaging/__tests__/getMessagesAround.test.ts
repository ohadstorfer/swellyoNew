const queues: Record<string, { data: any; error: any }[]> = {};
const makeBuilder = (result: { data: any; error: any }) => {
  const b: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'lte', 'gt', 'in', 'single', 'maybeSingle']) b[m] = jest.fn(() => b);
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
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}));
import { messagingService } from '../messagingService';

describe('getMessagesAround', () => {
  beforeEach(() => { for (const k of Object.keys(queues)) delete queues[k]; });

  it('merges older + target + newer chronologically and enriches senders', async () => {
    const target = { id: 't', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T12:00:00Z', type: 'text' };
    const older = [{ id: 'o1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T11:00:00Z', type: 'text' }];
    const newer = [{ id: 'n1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-17T13:00:00Z', type: 'text' }];
    queues['messages'] = [
      { data: { created_at: target.created_at }, error: null }, // target lookup (select created_at)
      { data: [target, ...older], error: null },                // older (desc, lte target) -> includes target
      { data: newer, error: null },                             // newer (asc, gt target)
    ];
    queues['surfers'] = [{ data: [{ user_id: 'u2', name: 'Ana', profile_image_url: null }], error: null }];

    const out = await messagingService.getMessagesAround('c1', 't', 10);
    expect(out.messages.map((m: any) => m.id)).toEqual(['o1', 't', 'n1']);
    expect(out.messages.find((m: any) => m.id === 't')?.sender_name).toBe('Ana');
  });
});
