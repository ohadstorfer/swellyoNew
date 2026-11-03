/**
 * useTripsListRealtime — scoped realtime invalidation.
 *
 * Verifies the firehose fix (Workstream 2 Task 2.1–2.3):
 *   - a 'trips_list_changed' ping on the shared 'trips-list' topic invalidates
 *     ONLY the Explore feed (NOT My Trips).
 *   - a 'trips_mine_changed' ping on this user's 'trips-mine:{uid}' topic
 *     invalidates ONLY ['trips','my',userId] (NOT Explore).
 *
 * No React renderer: useFocusEffect is mocked to run the effect factory
 * synchronously and capture its cleanup, and useCallback is identity. The
 * supabase channel mock captures the broadcast handlers by event name so the
 * test can fire each ping directly.
 *
 * Since the JS-thread-freeze fix (e3f8405) the hook subscribes inside
 * InteractionManager.runAfterInteractions, through acquireTopic
 * (tripsRealtime.ts). So:
 *   - runAfterInteractions is stubbed to run its task immediately;
 *   - acquireTopic creates the channel on a resolved promise, so each test
 *     awaits flushMicrotasks() before looking for it;
 *   - acquireTopic keeps lingering channels in module state, and the hook keeps
 *     its focus-catch-up throttle in module state too — so every test loads
 *     fresh copies of both (jest.resetModules + require).
 *
 * Variables referenced inside jest.mock factories are `mock`-prefixed (jest
 * hoists the factories above the imports and only allows mock-prefixed names).
 */

// useTripQueries imports groupTripsService (native-module deps) just for its
// query-key factory — stub it so this unit test stays network/native-free.
jest.mock('../../../services/trips/groupTripsService', () => ({
  exploreFeed: jest.fn(),
  fetchMyTripsFeed: jest.fn(),
}));

// --- mock the supabase client: capture per-channel broadcast handlers ---------
type MockHandler = (payload: unknown) => void;
const mockChannels: Array<{ topic: string; handlers: Record<string, MockHandler> }> = [];

jest.mock('../../../config/supabase', () => {
  const makeChannel = (topic: string) => {
    const entry = { topic, handlers: {} as Record<string, MockHandler> };
    mockChannels.push(entry);
    const chan: any = {
      on: (_type: string, opts: { event: string }, cb: MockHandler) => {
        entry.handlers[opts.event] = cb;
        return chan;
      },
      subscribe: () => chan,
      // acquireTopic waits out 'joining' before removing; anything else is final.
      state: 'joined',
    };
    return chan;
  };
  return {
    supabase: {
      channel: jest.fn((topic: string) => makeChannel(topic)),
      removeChannel: jest.fn(() => Promise.resolve('ok')),
    },
  };
});

// --- mock navigation: run the focus-effect factory immediately ----------------
const mockFocus: { cleanup?: () => void } = {};
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => undefined | (() => void)) => {
    mockFocus.cleanup = cb() ?? undefined;
  },
}));

// useCallback is identity so the factory passed to useFocusEffect is the real one.
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, useCallback: (fn: unknown) => fn };
});

// useQueryClient returns our injected client (set per test).
const mockQc: { client?: import('@tanstack/react-query').QueryClient } = {};
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return { ...actual, useQueryClient: () => mockQc.client };
});

import { QueryClient } from '@tanstack/react-query';

const USER_ID = 'user-123';
const FIVE_MIN_MS = 5 * 60 * 1000;

let tripsKeys: typeof import('../useTripQueries').tripsKeys;
let useTripsListRealtime: typeof import('../useTripsListRealtime').useTripsListRealtime;

/** acquireTopic creates the channel on a resolved promise — let it run. */
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const handlerFor = (topic: string, event: string): MockHandler => {
  const entry = mockChannels.find((c) => c.topic === topic);
  if (!entry) throw new Error(`no channel for topic ${topic}`);
  const h = entry.handlers[event];
  if (!h) throw new Error(`no handler for ${event} on ${topic}`);
  return h;
};

/** Mount the hook (its focus effect) and let the deferred subscribe finish. */
const mount = async (userId: string | undefined) => {
  useTripsListRealtime(userId);
  await flushMicrotasks();
};

describe('useTripsListRealtime — scoped invalidation', () => {
  beforeEach(() => {
    // Clock at 0 = the module's lastListInvalidateAt starting value, so the
    // on-focus "invalidate both feeds" catch-up stays inside its 5-min throttle
    // and does not pollute the single-topic isInvalidated assertions.
    jest.useFakeTimers({ now: 0 });

    jest.resetModules();
    // Run the deferred setup now instead of after a navigation animation.
    jest
      .spyOn(require('react-native').InteractionManager, 'runAfterInteractions')
      .mockImplementation((task: any) => {
        task();
        return { cancel: jest.fn() } as any;
      });
    ({ tripsKeys } = require('../useTripQueries'));
    ({ useTripsListRealtime } = require('../useTripsListRealtime'));

    mockChannels.length = 0;
    mockFocus.cleanup = undefined;
    mockQc.client = new QueryClient();
    // Seed both caches so isInvalidated is observable.
    mockQc.client.setQueryData(tripsKeys.explore, { pages: [[]], pageParams: [null] });
    mockQc.client.setQueryData(tripsKeys.my(USER_ID), { buckets: {}, meta: new Map() });
  });

  afterEach(() => {
    mockFocus.cleanup?.();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("'trips_list_changed' invalidates ONLY explore, NOT my", async () => {
    await mount(USER_ID);

    handlerFor('trips-list', 'trips_list_changed')({});
    jest.advanceTimersByTime(300);

    expect(mockQc.client!.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
    expect(mockQc.client!.getQueryState(tripsKeys.my(USER_ID))?.isInvalidated).toBe(false);
  });

  it("'trips_mine_changed' invalidates ONLY ['trips','my',userId], NOT explore", async () => {
    await mount(USER_ID);

    handlerFor(`trips-mine:${USER_ID}`, 'trips_mine_changed')({});
    jest.advanceTimersByTime(300);

    expect(mockQc.client!.getQueryState(tripsKeys.my(USER_ID))?.isInvalidated).toBe(true);
    expect(mockQc.client!.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(false);
  });

  it('opens an explore channel and (with a userId) a mine channel', async () => {
    await mount(USER_ID);
    const topics = mockChannels.map((c) => c.topic);
    expect(topics).toContain('trips-list');
    expect(topics).toContain(`trips-mine:${USER_ID}`);
  });

  it('opens no mine channel when userId is undefined', async () => {
    await mount(undefined);
    const topics = mockChannels.map((c) => c.topic);
    expect(topics).toContain('trips-list');
    expect(topics.some((t) => t.startsWith('trips-mine:'))).toBe(false);
  });

  it('opens the channels only once interactions settle', async () => {
    const { InteractionManager } = require('react-native');
    let runDeferred: (() => void) | null = null;
    (InteractionManager.runAfterInteractions as jest.Mock).mockImplementation((task: any) => {
      runDeferred = task;
      return { cancel: jest.fn() };
    });

    await mount(USER_ID);
    expect(mockChannels).toHaveLength(0);

    runDeferred!();
    await flushMicrotasks();
    expect(mockChannels.map((c) => c.topic)).toContain('trips-list');
  });

  it('refreshes both feeds on focus once the 5-min throttle has passed', async () => {
    jest.setSystemTime(FIVE_MIN_MS + 1);
    await mount(USER_ID);
    jest.advanceTimersByTime(300);

    expect(mockQc.client!.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
    expect(mockQc.client!.getQueryState(tripsKeys.my(USER_ID))?.isInvalidated).toBe(true);
  });
});
