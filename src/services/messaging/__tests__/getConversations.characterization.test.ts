/**
 * Characterization tests for messagingService.getConversations.
 *
 * These pin the CURRENT observable behavior (shape, ordering, unread math,
 * enrichment fallbacks, early returns) so the fetch-parallelization refactor
 * can be verified to change nothing. The supabase mock dispatches fixtures
 * per-table in FIFO order — the refactor keeps the relative creation order
 * of query builders (see plan), so the queues stay valid.
 */
type Result = { data: any; error: any };

const mockTableQueues: Record<string, Result[]> = {};
const mockRpcQueue: Result[] = [];
// Module scope on purpose: the jest.mock factory's getSession/getUser closures
// read these at call time. Moving them into beforeEach would break the mock.
let mockAuthSession: any = null;
let mockAuthUser: any = null;

const mockMakeBuilder = (result: Result) => {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'neq', 'gt', 'limit', 'maybeSingle', 'single']) {
    b[m] = jest.fn(() => b);
  }
  b.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
};

const mockFrom = jest.fn((table: string) => {
  const queue = mockTableQueues[table];
  if (!queue || queue.length === 0) {
    throw new Error(`Unexpected query on table "${table}" — queue empty`);
  }
  return mockMakeBuilder(queue.shift()!);
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../../config/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: mockAuthSession }, error: null })),
      getUser: jest.fn(async () => ({ data: { user: mockAuthUser } })),
    },
    from: (table: string) => mockFrom(table),
    rpc: jest.fn(() => {
      if (mockRpcQueue.length === 0) throw new Error('Unexpected rpc call — queue empty');
      return mockMakeBuilder(mockRpcQueue.shift()!);
    }),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import { messagingService } from '../messagingService';

const seedHappyPathFixtures = () => {
  mockAuthSession = { access_token: 't' };
  mockAuthUser = { id: 'me' };
  mockTableQueues['conversation_members'] = [
    // q3: my memberships
    { data: [{ conversation_id: 'c1' }, { conversation_id: 'c2' }], error: null },
    // q6: all members of the page
    {
      data: [
        { conversation_id: 'c1', user_id: 'me', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: '2026-06-09T09:00:00Z', preferences: null },
        { conversation_id: 'c1', user_id: 'u2', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
        { conversation_id: 'c2', user_id: 'me', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
        { conversation_id: 'c2', user_id: 'u2', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
        { conversation_id: 'c2', user_id: 'u3', role: 'member', joined_at: '2026-06-01T00:00:00Z', last_read_message_id: null, last_read_at: null, preferences: null },
      ],
      error: null,
    },
    // q7: my read state per conversation
    {
      data: [
        { conversation_id: 'c1', last_read_at: '2026-06-09T09:00:00Z' },
        { conversation_id: 'c2', last_read_at: null },
      ],
      error: null,
    },
  ];
  mockTableQueues['conversations'] = [
    // q4: the page (already server-ordered by updated_at desc)
    {
      data: [
        { id: 'c1', title: null, is_direct: true, metadata: null, created_by: 'me', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-09T10:00:00Z' },
        { id: 'c2', title: 'Bali crew', is_direct: false, metadata: null, created_by: 'u2', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-08T10:00:00Z' },
      ],
      error: null,
    },
  ];
  mockRpcQueue.push({
    // q5: last message per conversation
    data: [
      { id: 'm1', conversation_id: 'c1', sender_id: 'u2', body: 'hey', created_at: '2026-06-09T10:00:00Z' },
      { id: 'm2', conversation_id: 'c2', sender_id: 'u3', body: 'yo', created_at: '2026-06-08T10:00:00Z' },
    ],
    error: null,
  });
  mockTableQueues['users'] = [
    { data: [{ id: 'me', email: 'me@x.com' }, { id: 'u2', email: 'u2@x.com' }, { id: 'u3', email: 'u3@x.com' }], error: null },
  ];
  mockTableQueues['surfers'] = [
    // u3 has empty name -> email-prefix fallback; 'me' absent -> email-prefix fallback
    { data: [{ user_id: 'u2', name: 'Maya', profile_image_url: 'http://img/u2.jpg' }, { user_id: 'u3', name: '', profile_image_url: null }], error: null },
  ];
  mockTableQueues['messages'] = [
    // q9: potential unreads since cutoff (cutoff = 2026-06-09T09:00:00Z, the only non-null last_read_at)
    {
      data: [
        // newer than c1's last_read -> counts for c1
        { id: 'm1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-09T10:00:00Z' },
        // older than c1's last_read -> must be filtered OUT by the JS per-conv check
        { id: 'mOld', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-09T08:00:00Z' },
        // c2 has null last_read -> everything fetched counts
        { id: 'm2', conversation_id: 'c2', sender_id: 'u3', created_at: '2026-06-08T10:00:00Z' },
      ],
      error: null,
    },
  ];
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockTableQueues)) delete mockTableQueues[k];
  mockRpcQueue.length = 0;
  mockAuthSession = null;
  mockAuthUser = null;
});

describe('getConversations characterization', () => {
  it('assembles the page exactly as today (order, unread, enrichment, hasMore)', async () => {
    seedHappyPathFixtures();
    const { conversations, hasMore } = await messagingService.getConversations(50, 0);

    expect(hasMore).toBe(false);
    expect(conversations.map((c: any) => c.id)).toEqual(['c1', 'c2']);

    const c1: any = conversations[0];
    expect(c1.unread_count).toBe(1);            // m1 counted, mOld filtered by per-conv last_read
    expect(c1.unread_truncated).toBe(false);
    expect(c1.last_message.id).toBe('m1');
    expect(c1.other_user.user_id).toBe('u2');   // direct conv -> other member
    expect(c1.other_user.name).toBe('Maya');    // surfer name wins
    expect(c1.members).toHaveLength(2);
    expect(c1.members.find((m: any) => m.user_id === 'me').name).toBe('me'); // email-prefix fallback

    const c2: any = conversations[1];
    expect(c2.unread_count).toBe(1);            // null last_read -> fetched message counts
    expect(c2.last_message.id).toBe('m2');
    expect(c2.other_user).toBeUndefined();      // group conv
    expect(c2.members).toHaveLength(3);
    expect(c2.members.find((m: any) => m.user_id === 'u3').name).toBe('u3'); // empty surfer name -> email prefix
  });

  it('returns hasMore=true when the range returns limit+1 rows', async () => {
    seedHappyPathFixtures();
    // limit=1: q4 returns 2 rows -> hasMore, page sliced to 1.
    // Downstream fixtures still dispatch fine: enrichment only reads what it looks up.
    const { conversations, hasMore } = await messagingService.getConversations(1, 0);
    expect(hasMore).toBe(true);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('c1');
  });

  it('returns empty without issuing table queries when there is no session', async () => {
    mockAuthSession = null;
    mockAuthUser = null;
    const result = await messagingService.getConversations(50, 0);
    expect(result).toEqual({ conversations: [], hasMore: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('survives a failed last-messages RPC exactly as today (no last_message, no throw)', async () => {
    seedHappyPathFixtures();
    mockRpcQueue.length = 0;
    mockRpcQueue.push({ data: null, error: { message: 'boom' } });
    const { conversations } = await messagingService.getConversations(50, 0);
    expect(conversations).toHaveLength(2);
    expect(conversations[0].last_message).toBeUndefined();
    expect(conversations[0].unread_count).toBe(1); // unrelated pipeline unaffected
  });

  it('returns empty when the user has no conversation memberships', async () => {
    mockAuthSession = { access_token: 't' };
    mockAuthUser = { id: 'me' };
    mockTableQueues['conversation_members'] = [{ data: [], error: null }];
    const result = await messagingService.getConversations(50, 0);
    expect(result).toEqual({ conversations: [], hasMore: false });
  });
});
