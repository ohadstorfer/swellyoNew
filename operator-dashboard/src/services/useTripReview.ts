import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTripReview, type TripReview } from './review';
import { useTripAccess } from './access';
import { withoutMedical } from '../domain/visibleReview';

/**
 * The trip's document review, as THIS viewer may see it.
 *
 * Four pages ran the same `useQuery` for this (trip, traveler, requirement,
 * waiting) and each would have needed the same medical rule bolted on. One hook
 * means one place that decides it — see `withoutMedical` for why a Manager's
 * copy has no medical requirement at all.
 *
 * `select`, not a different query: the cache holds the one real answer, and the
 * view each viewer gets is derived from it. Fail-closed while capabilities are
 * still loading — an operator sees the medical line a beat late, which is the
 * safe direction to be wrong in.
 */
export function useTripReview(tripId: string, userIds: string[], enabled: boolean) {
  const access = useTripAccess(tripId);
  const canViewMedical = access.ready && access.can('medical.view');

  const select = useCallback(
    (data: TripReview) => (canViewMedical ? data : withoutMedical(data)),
    [canViewMedical],
  );

  return useQuery({
    queryKey: ['review', tripId, userIds],
    queryFn: () => fetchTripReview(tripId, userIds),
    enabled,
    select,
  });
}
