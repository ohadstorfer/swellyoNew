// WhatsApp-style member action sheet for the Trip Members screen.
// Renders options only; the parent owns confirmation dialogs + RPC calls.
//   Any viewer:              View profile · Message
//   Host viewer, other row:  + Set as admin / Remove as admin, + Remove from trip
// "host" in the DB is shown as "admin" to users (matches AdminBadgeIcon).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheetShell } from '../BottomSheetShell';
import { SheetOptionRow } from '../sheets/SheetOptionRow';
import Thumb from '../Thumb';
import { Image } from 'expo-image';
import { Images } from '../../assets/images';
import { ff } from '../../theme/fonts';
import type { EnrichedParticipant } from '../../services/trips/groupTripsService';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { TravelerPriceSheet } from './TravelerPriceSheet';
import { RemoveTravelerSheet } from './RemoveTravelerSheet';
import type { CancellationPolicy } from '../../services/trips/cancellationPolicy';

interface Props {
  visible: boolean;
  member: EnrichedParticipant | null;
  viewerIsHost: boolean;
  isSelf: boolean;
  /** Needed to open the per-traveler price sheet — operator + managed-trip only. */
  tripId: string;
  /** `group_trips.host_id === currentUserId`. NOT `viewerIsHost`: that is flat
   *  multi-host (every promoted admin), and `operator_set_traveler_price`
   *  authorises on `host_id` alone — only the operator of record is paid, so
   *  only they may price anyone. Showing this row to an admin would be a
   *  button that always errors. */
  viewerIsOperator: boolean;
  /**
   * May this viewer remove a traveler? `travelers.remove` in the capability
   * set, which the seeded Manager tier carries. Deliberately separate from
   * `viewerIsHost`: promoting an admin writes `participants.role = 'host'` and
   * stays host-only, while removing someone is its own capability — the
   * database splits them the same way (20260807000100 §2). Defaults to
   * `viewerIsHost` so existing callers keep today's behaviour.
   */
  viewerCanRemove?: boolean;
  /** `group_trips.host_id` — the trip's owner. Their row gets no "Remove as
   *  admin" and no "Remove from trip", for anyone, including themselves:
   *  `protect_trip_owner_membership` (20260803000000 §11) refuses both at the
   *  database, so offering them would turn an ordinary tap into an error
   *  alert. The rule is absolute — nobody can remove the owner, and the owner
   *  cannot leave — because either one hands `host_id`, and with it every
   *  future traveler payment, to whoever is next in line. */
  ownerUserId: string | null;
  paymentMode: string | null;
  /** `group_trips.budget_fx_rate` — passed straight through to the price sheet. */
  budgetFxRate: number | null;
  /** `group_trips.budget_currency` — ditto. Decides which currency the operator
   *  edits this traveler's price in. */
  budgetCurrency?: string | null;
  /** Every requirement row on the trip, active or not — passed straight
   *  through to the price sheet, which reads the pay rows out of it to decide
   *  whether a Deposit field may be shown. `null` means not yet loaded (or
   *  the load failed) and must NOT be flattened to `[]` on the way through:
   *  the sheet blocks saving on it. */
  requirements: { kind: string; isActive: boolean }[] | null;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string, name?: string, avatar?: string | null) => void;
  onSetAdmin: (member: EnrichedParticipant) => void;
  onRemoveAdmin: (member: EnrichedParticipant) => void;
  /**
   * Remove someone who has paid NOTHING. Runs through `wrap` — an Alert can sit
   * over a dismissing sheet safely, because it is not a Modal.
   *
   * A traveler who HAS paid never reaches this: their removal opens the nested
   * RemoveTravelerSheet below, which needs a refund decision first.
   */
  onRemove: (member: EnrichedParticipant) => void;
  /**
   * What this member has paid, net of refunds. `> 0` routes "Remove from trip"
   * to the refund sheet instead of the plain Alert. 0 (the default) keeps every
   * existing caller on today's behaviour.
   */
  paidUsd?: number;
  /** The trip's frozen cancellation policy — the refund sheet suggests from it. */
  cancellation?: CancellationPolicy | null;
  /** `group_trips.start_date`, for measuring the policy window. */
  tripStartDate?: string | null;
  /** Does this viewer hold `money.manage`? Separate from `viewerCanRemove`. */
  canRefund?: boolean;
  /**
   * Does the removal once the refund is settled, with what actually went back.
   * Only called from the paid path.
   */
  onRemoveWithRefund?: (member: EnrichedParticipant, refundedUsd: number) => Promise<void>;
}

const joinedAgo = (iso: string | null): string => {
  if (!iso) return '';
  const day = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (day <= 0) return 'Joined today';
  if (day < 7) return `Joined ${day} day${day === 1 ? '' : 's'} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `Joined ${wk} week${wk === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  return `Joined ${mo} month${mo === 1 ? '' : 's'} ago`;
};

export function TripMemberSheet({
  visible, member, viewerIsHost, viewerCanRemove, isSelf, tripId, viewerIsOperator, ownerUserId, paymentMode,
  budgetFxRate, budgetCurrency, requirements, onClose,
  onViewProfile, onMessage, onSetAdmin, onRemoveAdmin, onRemove,
  paidUsd = 0, cancellation = null, tripStartDate = null, canRefund = false, onRemoveWithRefund,
}: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const m = member;
  // Close first, then run the action, so the confirm Alert sits above nothing.
  const wrap = (fn: () => void) => () => { onClose(); fn(); };
  const canManage = viewerIsHost && !isSelf && !!m;
  // Same shape as canManage, on the removal capability instead of hostship.
  const canRemove = (viewerCanRemove ?? viewerIsHost) && !isSelf && !!m;
  // The owner's row. `!isSelf` already hides everything below from the owner
  // viewing themselves, but this does not lean on that: the row must be
  // unmanageable when a PROMOTED ADMIN is looking at it, which is exactly the
  // case `!isSelf` does not cover and the case the attack used.
  const isOwnerRow = !!m && !!ownerUserId && m.user_id === ownerUserId;
  // `viewerIsOperator`, not `viewerIsHost` — see the prop's own comment. The
  // `!isSelf` inside canManage also mirrors the RPC's refusal to let anyone
  // set their own price.
  const canSetPrice = canManage && viewerIsOperator && paymentMode === 'managed';

  const [priceOpen, setPriceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  // Don't let a stale "open" carry forward to the next member this sheet is
  // opened for.
  useEffect(() => {
    if (!visible) {
      setPriceOpen(false);
      setRemoveOpen(false);
    }
  }, [visible]);

  /** Has this person got money on the trip that a removal has to answer for? */
  const removalNeedsRefund = paidUsd > 0 && !!onRemoveWithRefund;

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        {m ? (
          <>
            <View style={styles.header}>
              {m.profile_image_url ? (
                <Thumb uri={m.profile_image_url} size={128} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
              )}
              <Text style={styles.name} numberOfLines={1}>{m.name ?? 'User'}</Text>
              <Text style={styles.sub} numberOfLines={1}>{joinedAgo(m.joined_at)}</Text>
            </View>

            <View style={styles.group}>
              <SheetOptionRow icon="person-outline" label="View profile" onPress={wrap(() => onViewProfile(m.user_id))} />
              <SheetOptionRow icon="chatbubble-outline" label="Message" onPress={wrap(() => onMessage(m.user_id, m.name ?? undefined, m.profile_image_url))} />
              {canManage && m.role === 'member' ? (
                <SheetOptionRow icon="shield-checkmark-outline" label="Set as admin" onPress={wrap(() => onSetAdmin(m))} />
              ) : null}
              {canManage && m.role === 'host' && !isOwnerRow ? (
                <SheetOptionRow icon="shield-outline" label="Remove as admin" onPress={wrap(() => onRemoveAdmin(m))} />
              ) : null}
              {canSetPrice ? (
                <SheetOptionRow icon="cash-outline" label="Price" onPress={() => setPriceOpen(true)} pressScale />
              ) : null}
              {canRemove && !isOwnerRow ? (
                <SheetOptionRow
                  icon="person-remove-outline"
                  label="Remove from trip"
                  danger
                  // ⚠️ NOT `wrap` when there is money. `wrap` closes this sheet
                  // and fires the handler in the same tick; if that handler
                  // opens another BottomSheetShell as a SIBLING in the parent
                  // screen, two independent native Modals overlap mid-dismiss
                  // and iOS strands an invisible view controller that eats
                  // every touch — the app looks frozen. That is exactly what
                  // this row did when the refund sheet was first added, and it
                  // is why `Price` above never used `wrap` either. The paid
                  // path stays nested inside THIS Modal, like the price sheet.
                  //
                  // The unpaid path keeps `wrap`: it opens an Alert, which is
                  // not a Modal and cannot race one.
                  onPress={
                    removalNeedsRefund ? () => setRemoveOpen(true) : wrap(() => onRemove(m))
                  }
                  pressScale={removalNeedsRefund}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </View>

      {/* Rendered INSIDE this sheet's own Modal (via BottomSheetShell), not as a
          sibling in the parent screen. BottomSheetShell renders a native Modal;
          two independent top-level Modals dismissing in overlapping frames can
          strand an invisible view controller on iOS that silently eats every
          touch on the screen underneath. Nesting here means the two sheets'
          native lifecycles are coupled through this component's own state
          instead of racing each other.
          Mounted on `viewerIsOperator && m` — `viewerIsOperator` IS derived
          from useTripCore's query data (`trip.host_id`), same as everything
          else here, so "never on query data" isn't the reason this is safe.
          It's safe because saving a price never changes who the operator is:
          nothing this sheet does can flip that boolean while it's presenting,
          even after the `tripsKeys.detail` invalidation below triggers a
          refetch. (host_id is stabler still than the old `viewerIsHost`
          mount: it does not move when someone is promoted or demoted.) `m`
          (the selected member) is likewise never nulled by that refetch — it
          is independent local state on the parent screen, only ever changed
          by an explicit tap on a different row. */}
      {viewerIsOperator && m ? (
        <TravelerPriceSheet
          visible={priceOpen}
          tripId={tripId}
          userId={m.user_id}
          travelerName={m.name ?? 'This traveler'}
          budgetFxRate={budgetFxRate}
          budgetCurrency={budgetCurrency}
          requirements={requirements}
          onClose={() => setPriceOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: tripsKeys.payments(tripId, m.user_id) });
            queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          }}
        />
      ) : null}

      {/* Removing someone who has paid. Nested for the SAME reason the price
          sheet above is — see the note there, and the one on the Remove row. */}
      {removalNeedsRefund && m ? (
        <RemoveTravelerSheet
          visible={removeOpen}
          onClose={() => setRemoveOpen(false)}
          tripId={tripId}
          userId={m.user_id}
          travelerName={m.name ?? 'this traveler'}
          paidUsd={paidUsd}
          cancellation={cancellation}
          tripStartDate={tripStartDate}
          canRefund={canRefund}
          onRemove={async refundedUsd => {
            await onRemoveWithRefund!(m, refundedUsd);
            // The member row is gone; close both sheets rather than leaving
            // this one open over a person who is no longer on the trip.
            setRemoveOpen(false);
            onClose();
          }}
          onRefunded={() => {
            queryClient.invalidateQueries({ queryKey: ['operatorDashboard', 'money', tripId] });
            queryClient.invalidateQueries({ queryKey: ['operatorDashboard', 'refunds', tripId] });
          }}
        />
      ) : null}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24 },
  header: { alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  name: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', marginTop: 12, includeFontPadding: false },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 4, includeFontPadding: false },
  group: { marginTop: 4 },
});
