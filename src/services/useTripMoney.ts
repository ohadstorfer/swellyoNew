import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buildTripMoney, type TripMoney } from '../domain/money';
import { fetchMembers, fetchTrip } from './trips';
import { fetchPaySteps, fetchPaymentEvents, STRIPE_LIVEMODE } from './payments';

/**
 * Every money number for one trip.
 *
 * The Money card, the money page and the traveler page all read from here, so
 * they cannot drift apart — a card saying "1 of 2 paid" above a page that
 * lists something else is worse than either being wrong alone.
 *
 * The trip and member query keys match the ones the other pages already use,
 * so React Query serves them from cache instead of asking twice.
 */
export function useTripMoney(tripId: string) {
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => fetchTrip(tripId) });
  const members = useQuery({ queryKey: ['members', tripId], queryFn: () => fetchMembers(tripId) });
  const steps = useQuery({ queryKey: ['paySteps', tripId], queryFn: () => fetchPaySteps(tripId) });
  const events = useQuery({
    queryKey: ['payEvents', tripId],
    queryFn: () => fetchPaymentEvents(tripId),
  });

  const money = useMemo<TripMoney | null>(() => {
    if (!trip.data || !members.data || !steps.data || !events.data) return null;
    return buildTripMoney({
      members: members.data,
      steps: steps.data,
      trip: {
        costPerPerson: trip.data.costPerPerson,
        depositAmount: trip.data.depositAmount,
      },
      events: events.data,
      liveMode: STRIPE_LIVEMODE,
    });
  }, [trip.data, members.data, steps.data, events.data]);

  /** 'offline' means the trip has prices but Stripe never collects them. */
  const isOffline = trip.data ? trip.data.paymentMode !== 'managed' : false;

  /** Does the trip have a deposit step at all? Drives the price dialog. */
  const hasDepositStep = (steps.data ?? []).some(s => s.kind === 'deposit');

  /** Nothing to show a money section for: no steps and no prices anywhere. */
  const hasMoney =
    (steps.data ?? []).length > 0 ||
    trip.data?.costPerPerson !== null ||
    (members.data ?? []).some(m => m.priceTotalUsd !== null);

  const failed = [trip, members, steps, events].find(q => q.isError);

  return {
    money,
    trip: trip.data ?? null,
    steps: steps.data ?? [],
    isOffline,
    hasDepositStep,
    hasMoney,
    isPending: trip.isPending || members.isPending || steps.isPending || events.isPending,
    isError: !!failed,
    error: failed?.error,
    refetch: () => {
      void trip.refetch();
      void members.refetch();
      void steps.refetch();
      void events.refetch();
    },
  };
}
