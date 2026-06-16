// Mock the entire groupTripsService (and its native-module deps) so this unit
// test only validates key shapes — no network or native bindings needed.
jest.mock('../../../services/trips/groupTripsService', () => ({
  exploreFeed: jest.fn(),
  getTripCardMeta: jest.fn(),
  listMyTripsByBucket: jest.fn(),
}));

import { QueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../useTripQueries';

describe('explore keys', () => {
  it('exploreMeta is removed', () => {
    expect((tripsKeys as any).exploreMeta).toBeUndefined();
  });

  it('invalidating explore (prefix) covers the infinite query cache entry', () => {
    const qc = new QueryClient();
    qc.setQueryData(tripsKeys.explore, { pages: [[]], pageParams: [null] });
    qc.invalidateQueries({ queryKey: tripsKeys.explore });
    expect(qc.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
  });
});
