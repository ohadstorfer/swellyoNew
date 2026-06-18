// Pure characterization test for persistReadWatermark: it must do exactly ONE
// conversation_members UPDATE and NOT count unread.
const mockFromCalls: string[] = [];
const mockBuilder = (() => {
  const b: any = {};
  for (const m of ['update', 'eq', 'select', 'maybeSingle']) b[m] = jest.fn(() => b);
  b.then = (ok: any, err: any) => Promise.resolve({ data: null, error: null }).then(ok, err);
  return b;
})();

jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: (t: string) => { mockFromCalls.push(t); return mockBuilder; },
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { messagingService } from '../messagingService';

describe('persistReadWatermark', () => {
  beforeEach(() => { mockFromCalls.length = 0; jest.clearAllMocks(); });

  it('issues exactly one conversation_members UPDATE and no messages query', async () => {
    await messagingService.persistReadWatermark('c1', 'u1', 'm9', '2026-06-17T00:00:00.000Z');
    expect(mockFromCalls).toEqual(['conversation_members']);
    expect(mockBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_read_message_id: 'm9', last_read_at: '2026-06-17T00:00:00.000Z' })
    );
  });
});
