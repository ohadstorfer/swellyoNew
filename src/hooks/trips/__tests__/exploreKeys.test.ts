// Mock the entire groupTripsService (and its native-module deps) so this unit
// test only validates key shapes — no network or native bindings needed.
jest.mock('../../../services/trips/groupTripsService', () => ({
  listExploreTrips: jest.fn(),
  getTripCardMeta: jest.fn(),
  listMyTripsByBucket: jest.fn(),
}));

import { QueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../useTripQueries';

describe('exploreMeta key nesting', () => {
  it('builds a key nested under explore', () => {
    expect(tripsKeys.exploreMeta(['x', 'y'])).toEqual(['trips', 'explore', 'meta', 'x,y']);
  });

  it('invalidating explore also invalidates the nested meta query', () => {
    const qc = new QueryClient();
    qc.setQueryData(tripsKeys.explore, []);
    qc.setQueryData(tripsKeys.exploreMeta(['x']), new Map());

    qc.invalidateQueries({ queryKey: tripsKeys.explore });

    expect(qc.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(tripsKeys.exploreMeta(['x']))?.isInvalidated).toBe(true);
  });
});
