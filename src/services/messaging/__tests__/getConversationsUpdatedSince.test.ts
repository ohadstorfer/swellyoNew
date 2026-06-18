/**
 * Tests for messagingService.getConversationsUpdatedSince.
 *
 * These pin the BATCHED behavior after Workstream 3: getConversationsUpdatedSince
 * must reuse the same batched enrichment as getConversations — exactly ONE
 * `rpc('get_last_messages_per_conversation', { conv_ids })` call and exactly ONE
 * `from('messages')` unread query for N conversations, returning the FULL
 * Conversation shape (other_user, members, name, unread_count, unread_truncated).
 *
 * The mock mirrors getConversations.characterization.test.ts: a FIFO per-table
 * queue (mockTableQueues), a FIFO rpc queue (mockRpcQueue), a chainable builder,
 * and module-scope auth user/session that the jest.mock factory closures read.
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

const mockRpc = jest.fn((..._args: any[]) => {
  if (mockRpcQueue.length === 0) throw new Error('Unexpected rpc call — queue empty');
  return mockMakeBuilder(mockRpcQueue.shift()!);
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
    rpc: (...args: any[]) => mockRpc(...args),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import { messagingService } from '../messagingService';

/**
 * Seeds fixtures for two conversations (c1 direct, c2 group), restricted by id.
 * The RPC result intentionally includes video_metadata/audio_metadata so we can
 * prove enrichConversations carries those columns through.
 */
const seedTwoConversations = () => {
  mockAuthSession = { access_token: 't' };
  mockAuthUser = { id: 'me' };

  mockTableQueues['conversation_members'] = [
    // memberships: my conversation ids
    { data: [{ conversation_id: 'c1' }, { conversation_id: 'c2' }], error: null },
    // all members of the page
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
    // my read state per conversation
    {
      data: [
        { conversation_id: 'c1', last_read_at: '2026-06-09T09:00:00Z' },
        { conversation_id: 'c2', last_read_at: null },
      ],
      error: null,
    },
  ];

  mockTableQueues['conversations'] = [
    {
      data: [
        { id: 'c1', title: null, is_direct: true, metadata: null, created_by: 'me', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-09T10:00:00Z' },
        { id: 'c2', title: 'Bali crew', is_direct: false, metadata: null, created_by: 'u2', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-08T10:00:00Z' },
      ],
      error: null,
    },
  ];

  mockRpcQueue.push({
    // last message per conversation — includes video/audio metadata to prove pass-through
    data: [
      { id: 'm1', conversation_id: 'c1', sender_id: 'u2', body: 'hey', created_at: '2026-06-09T10:00:00Z', type: 'video', image_metadata: null, video_metadata: { url: 'http://v/u2.mp4' }, audio_metadata: null, commitment_metadata: null },
      { id: 'm2', conversation_id: 'c2', sender_id: 'u3', body: 'yo', created_at: '2026-06-08T10:00:00Z', type: 'audio', image_metadata: null, video_metadata: null, audio_metadata: { url: 'http://a/u3.m4a' }, commitment_metadata: null },
    ],
    error: null,
  });

  mockTableQueues['users'] = [
    { data: [{ id: 'me', email: 'me@x.com' }, { id: 'u2', email: 'u2@x.com' }, { id: 'u3', email: 'u3@x.com' }], error: null },
  ];

  mockTableQueues['surfers'] = [
    { data: [{ user_id: 'u2', name: 'Maya', profile_image_url: 'http://img/u2.jpg' }, { user_id: 'u3', name: '', profile_image_url: null }], error: null },
  ];

  mockTableQueues['messages'] = [
    // single capped unread query (NOT one-per-conversation)
    {
      data: [
        { id: 'm1', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-09T10:00:00Z' },
        { id: 'mOld', conversation_id: 'c1', sender_id: 'u2', created_at: '2026-06-09T08:00:00Z' },
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

describe('getConversationsUpdatedSince (batched enrichment)', () => {
  it('calls the last-messages RPC EXACTLY ONCE with the conversation id list', async () => {
    seedTwoConversations();
    await messagingService.getConversationsUpdatedSince(0, ['c1', 'c2']);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_last_messages_per_conversation', {
      conv_ids: ['c1', 'c2'],
    });
  });

  it('issues exactly ONE messages unread query for N=2 conversations (not N+)', async () => {
    seedTwoConversations();
    // The OLD per-conversation code drained N+ entries from the messages queue and
    // would throw "queue empty"; seeding a single messages entry proves the
    // batched single-query behavior. If the old N-query path ran, this throws.
    await expect(
      messagingService.getConversationsUpdatedSince(0, ['c1', 'c2']),
    ).resolves.toBeDefined();

    const messagesCalls = mockFrom.mock.calls.filter(([t]) => t === 'messages');
    expect(messagesCalls).toHaveLength(1);
  });

  it('returns the FULL conversation shape (other_user, members, unread)', async () => {
    seedTwoConversations();
    const result = await messagingService.getConversationsUpdatedSince(0, ['c1', 'c2']);

    expect(result.map((c: any) => c.id)).toEqual(['c1', 'c2']);

    const c1: any = result[0];
    expect(c1.other_user).toBeDefined();          // direct conv -> other member present
    expect(c1.other_user.user_id).toBe('u2');
    expect(c1.other_user.name).toBe('Maya');
    expect(c1.members).toHaveLength(2);
    expect(c1.unread_count).toBe(1);              // m1 counted, mOld filtered by last_read
    expect(c1.unread_truncated).toBe(false);

    const c2: any = result[1];
    expect(c2.other_user).toBeUndefined();        // group conv
    expect(c2.members).toHaveLength(3);
    expect(c2.unread_count).toBe(1);              // null last_read -> fetched message counts
  });

  it('returns [] without any RPC or messages query when there are no member conversations', async () => {
    mockAuthSession = { access_token: 't' };
    mockAuthUser = { id: 'me' };
    // Membership query returns no conversations → early return before enrichment.
    mockTableQueues['conversation_members'] = [{ data: [], error: null }];

    const result = await messagingService.getConversationsUpdatedSince(0, []);

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom.mock.calls.filter(([t]) => t === 'messages')).toHaveLength(0);
  });

  it('carries video/audio metadata from the RPC through to last_message', async () => {
    seedTwoConversations();
    const result = await messagingService.getConversationsUpdatedSince(0, ['c1', 'c2']);

    const c1: any = result[0];
    expect(c1.last_message.id).toBe('m1');
    expect(c1.last_message.type).toBe('video');
    expect(c1.last_message.video_metadata).toEqual({ url: 'http://v/u2.mp4' });

    const c2: any = result[1];
    expect(c2.last_message.type).toBe('audio');
    expect(c2.last_message.audio_metadata).toEqual({ url: 'http://a/u3.m4a' });
  });
});
