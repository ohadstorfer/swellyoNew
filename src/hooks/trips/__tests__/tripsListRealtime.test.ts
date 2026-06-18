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
    };
    return chan;
  };
  return {
    supabase: {
      channel: jest.fn((topic: string) => makeChannel(topic)),
      removeChannel: jest.fn(),
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
import { tripsKeys } from '../useTripQueries';
import { useTripsListRealtime } from '../useTripsListRealtime';

const USER_ID = 'user-123';

const handlerFor = (topic: string, event: string): MockHandler => {
  const entry = mockChannels.find((c) => c.topic === topic);
  if (!entry) throw new Error(`no channel for topic ${topic}`);
  const h = entry.handlers[event];
  if (!h) throw new Error(`no handler for ${event} on ${topic}`);
  return h;
};

describe('useTripsListRealtime — scoped invalidation', () => {
  beforeEach(() => {
    jest.useFakeTimers();

    // Prime the module-level focus-catchup throttle so the REAL test mount in
    // each case skips the on-focus "invalidate both feeds" catch-up (which
    // would otherwise pollute the single-topic isInvalidated assertions). A
    // throwaway mount in the same fake-clock tick sets lastListInvalidateAt to
    // "now", so the test mount falls inside the 5-min throttle window.
    mockChannels.length = 0;
    mockQc.client = new QueryClient();
    useTripsListRealtime(USER_ID);
    jest.advanceTimersByTime(300); // let the catch-up timers fire on the prime
    mockFocus.cleanup?.();

    // Now a clean slate for the actual assertion mount.
    mockChannels.length = 0;
    mockFocus.cleanup = undefined;
    mockQc.client = new QueryClient();
    // Seed both caches so isInvalidated is observable.
    mockQc.client.setQueryData(tripsKeys.explore, { pages: [[]], pageParams: [null] });
    mockQc.client.setQueryData(tripsKeys.my(USER_ID), { buckets: {}, meta: new Map() });
  });

  afterEach(() => {
    mockFocus.cleanup?.();
    jest.useRealTimers();
  });

  it("'trips_list_changed' invalidates ONLY explore, NOT my", () => {
    useTripsListRealtime(USER_ID);

    handlerFor('trips-list', 'trips_list_changed')({});
    jest.advanceTimersByTime(300);

    expect(mockQc.client!.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
    expect(mockQc.client!.getQueryState(tripsKeys.my(USER_ID))?.isInvalidated).toBe(false);
  });

  it("'trips_mine_changed' invalidates ONLY ['trips','my',userId], NOT explore", () => {
    useTripsListRealtime(USER_ID);

    handlerFor(`trips-mine:${USER_ID}`, 'trips_mine_changed')({});
    jest.advanceTimersByTime(300);

    expect(mockQc.client!.getQueryState(tripsKeys.my(USER_ID))?.isInvalidated).toBe(true);
    expect(mockQc.client!.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(false);
  });

  it('opens an explore channel and (with a userId) a mine channel', () => {
    useTripsListRealtime(USER_ID);
    const topics = mockChannels.map((c) => c.topic);
    expect(topics).toContain('trips-list');
    expect(topics).toContain(`trips-mine:${USER_ID}`);
  });

  it('opens no mine channel when userId is undefined', () => {
    useTripsListRealtime(undefined);
    const topics = mockChannels.map((c) => c.topic);
    expect(topics).toContain('trips-list');
    expect(topics.some((t) => t.startsWith('trips-mine:'))).toBe(false);
  });
});
