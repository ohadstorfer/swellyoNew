/**
 * TripTravelerScreen — one traveler on an operator trip: who they are, what
 * they have paid, their documents, and what the operator can do about them
 * (Figma 17776-48991).
 *
 * It is the traveler level of DocumentReviewScreen, drawn as a card on the
 * stack instead of inside the trip screen's Modal — so the Members list and
 * the guests-payments list can push it and come back to where they were.
 *
 * Every query here uses the SAME key the trip screen uses (`useTripCore`,
 * `useTripReview`, `['operatorDashboard', …]`), so arriving from the Dashboard
 * is a cache hit and the numbers cannot differ from the tiles the operator
 * just looked at.
 *
 * The gates mirror TripDetailScreen's own. They are UX only — RLS and the
 * RPCs decide — but keep them in step with that screen, or the same person
 * gets offered different buttons through two doors.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  useTripCore,
  useTripReview,
  useTripRequirements,
  type TripCoreData,
} from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { useTripCapabilities } from '../../hooks/trips/useTripCapabilities';
import { removeParticipant } from '../../services/trips/groupTripsService';
import { fetchTripMoney } from '../../services/trips/operatorDashboardService';
import { fetchTripRefunds } from '../../services/trips/refundsService';
import { policyFromTrip } from '../../services/trips/cancellationPolicy';
import { isTripHost } from '../../utils/tripRole';
import { DocumentReviewScreen, type ReviewTraveler } from '../../components/trips/DocumentReviewScreen';
import { TravelerExtras } from '../../components/trips/dashboard/TravelerExtras';
import { TravelerPriceSheet } from '../../components/trips/TravelerPriceSheet';
import { RefundSheet } from '../../components/trips/RefundSheet';
import { RemoveTravelerSheet } from '../../components/trips/RemoveTravelerSheet';

interface Props {
  tripId: string;
  userId: string;
  onBack: () => void;
  onViewUserProfile?: (userId: string) => void;
  onMessage?: (userId: string, name?: string, avatar?: string | null) => void;
}

export default function TripTravelerScreen({
  tripId,
  userId,
  onBack,
  onViewUserProfile,
  onMessage,
}: Props) {
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const queryClient = useQueryClient();

  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];

  const isHost = isTripHost(trip, participants, currentUserId);
  const isOperatorTrip = trip?.hosting_style === 'C';
  const { can } = useTripCapabilities(tripId, isOperatorTrip);
  // Only the operator of RECORD prices or refunds anyone: the RPCs authorise
  // on `host_id` alone, while `isHost` includes every promoted admin.
  const isTripOwner = !!currentUserId && trip?.host_id === currentUserId;

  // Everyone except the hosts, in the same shape and order the trip screen
  // builds — the review query is keyed on this list.
  const travelers: ReviewTraveler[] = useMemo(
    () =>
      participants
        .filter(p => p.role !== 'host')
        .map(p => ({ userId: p.user_id, name: p.name, avatarUrl: p.profile_image_url })),
    [participants],
  );
  const reviewUserIds = useMemo(() => travelers.map(t => t.userId).sort(), [travelers]);

  const reviewQuery = useTripReview(
    tripId,
    isHost || can('docs.view'),
    reviewUserIds,
    isHost || can('medical.view'),
  );
  const review = reviewQuery.data?.travelers ?? [];

  const canSeeMoney = (isHost || can('payments.view_status')) && isOperatorTrip;
  const money = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
    enabled: canSeeMoney,
  });
  // Kept apart from `money` on purpose: a blocked refund attempt is not money.
  const refunds = useQuery({
    queryKey: ['operatorDashboard', 'refunds', tripId],
    queryFn: () => fetchTripRefunds(tripId),
    enabled: canSeeMoney,
  });
  const requirementsQuery = useTripRequirements(tripId, isHost || can('trip.edit'));

  const [pricing, setPricing] = useState(false);
  const [refundTarget, setRefundTarget] = useState<{
    paymentEventId: string;
    amountUsd: number;
  } | null>(null);
  // The refund just issued, so the block can confirm it before Stripe's
  // webhook writes the real row. See the same state in TripDetailScreen.
  const [justRefunded, setJustRefunded] = useState<{
    userId: string;
    amountUsd: number;
    seenRefunds: number;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  const traveler = travelers.find(t => t.userId === userId) ?? null;
  const name = traveler?.name ?? 'Traveler';
  const travelerMoney = money.data?.travelers.find(m => m.userId === userId) ?? null;

  const invalidateMoney = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['operatorDashboard', 'money', tripId] });
    void queryClient.invalidateQueries({ queryKey: ['operatorDashboard', 'refunds', tripId] });
  }, [queryClient, tripId]);

  return (
    <View style={styles.root}>
      <DocumentReviewScreen
        presentation="screen"
        visible
        onClose={onBack}
        tripId={tripId}
        loading={coreQuery.isLoading || reviewQuery.isLoading}
        travelers={travelers}
        review={review}
        canApprove={isHost || can('docs.approve')}
        initialUserId={userId}
        onChanged={() => reviewQuery.refetch()}
        renderTravelerExtras={(openUserId, documents) => (
          <TravelerExtras
            key={openUserId}
            tripId={tripId}
            userId={openUserId}
            name={name}
            documents={documents}
            money={travelerMoney}
            moneyLoading={money.isPending}
            isOffline={money.data?.isOffline ?? false}
            onSetPrice={isTripOwner ? () => setPricing(true) : undefined}
            onRefund={
              isTripOwner
                ? (paymentEventId, amountUsd) => setRefundTarget({ paymentEventId, amountUsd })
                : undefined
            }
            blockedRefunds={(refunds.data ?? []).filter(
              r => r.userId === openUserId && r.status !== 'succeeded',
            )}
            justRefunded={justRefunded?.userId === openUserId ? justRefunded : null}
            // `travelers.remove`, not `money.manage` — whether someone who has
            // PAID may be removed by this viewer is decided inside the sheet.
            onRemove={isHost || can('travelers.remove') ? () => setRemoving(true) : undefined}
            onMessage={() => onMessage?.(openUserId, traveler?.name ?? undefined, traveler?.avatarUrl ?? null)}
            avatarUrl={traveler?.avatarUrl ?? null}
            onOpenProfile={
              onViewUserProfile && openUserId !== currentUserId
                ? () => onViewUserProfile(openUserId)
                : undefined
            }
          />
        )}
        // Layers, not Modals (`inline`) — the same sheets the trip screen
        // mounts inside its review Modal, under the same rule.
        renderOverlay={() => (
          <>
            {removing && trip ? (
              <RemoveTravelerSheet
                inline
                visible={removing}
                onClose={() => setRemoving(false)}
                tripId={tripId}
                userId={userId}
                travelerName={name}
                paidUsd={travelerMoney?.paidUsd ?? 0}
                cancellation={policyFromTrip(trip)}
                tripStartDate={trip.start_date ?? null}
                canRefund={isTripOwner || can('money.manage')}
                onRemove={async refundedUsd => {
                  await removeParticipant(tripId, userId, refundedUsd);
                  queryClient.setQueryData<TripCoreData>(tripsKeys.detail(tripId), prev =>
                    prev
                      ? { ...prev, participants: prev.participants.filter(p => p.user_id !== userId) }
                      : prev,
                  );
                  setRemoving(false);
                  // They are no longer on the trip, so there is no page to show.
                  onBack();
                }}
                onRefunded={invalidateMoney}
              />
            ) : null}
            <RefundSheet
              inline
              visible={!!refundTarget}
              travelerName={name}
              paymentEventId={refundTarget?.paymentEventId ?? ''}
              paidUsd={refundTarget?.amountUsd ?? 0}
              cancellation={policyFromTrip(trip)}
              onClose={() => setRefundTarget(null)}
              onRefunded={amountUsd => {
                setJustRefunded({
                  userId,
                  amountUsd,
                  seenRefunds: (travelerMoney?.events ?? []).filter(
                    e => e.eventType === 'refunded',
                  ).length,
                });
                invalidateMoney();
              }}
            />
            <TravelerPriceSheet
              inline
              visible={pricing}
              tripId={tripId}
              userId={userId}
              travelerName={name}
              budgetFxRate={trip?.budget_fx_rate ?? null}
              budgetCurrency={trip?.budget_currency ?? null}
              // `null` = not known yet, and the sheet refuses to save on it —
              // an empty list would wipe a negotiated deposit.
              requirements={
                requirementsQuery.data
                  ? requirementsQuery.data.map(r => ({ kind: r.kind, isActive: r.isActive }))
                  : null
              }
              onClose={() => setPricing(false)}
              onSaved={() => {
                setPricing(false);
                void queryClient.invalidateQueries({
                  queryKey: ['operatorDashboard', 'money', tripId],
                });
              }}
            />
          </>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
});
