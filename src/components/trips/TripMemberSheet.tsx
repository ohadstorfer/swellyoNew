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

interface Props {
  visible: boolean;
  member: EnrichedParticipant | null;
  viewerIsHost: boolean;
  isSelf: boolean;
  /** Needed to open the per-traveler price sheet — host + managed-trip only. */
  tripId: string;
  paymentMode: string | null;
  /** `group_trips.budget_fx_rate` — passed straight through to the price sheet. */
  budgetFxRate: number | null;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string, name?: string, avatar?: string | null) => void;
  onSetAdmin: (member: EnrichedParticipant) => void;
  onRemoveAdmin: (member: EnrichedParticipant) => void;
  onRemove: (member: EnrichedParticipant) => void;
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
  visible, member, viewerIsHost, isSelf, tripId, paymentMode, budgetFxRate, onClose,
  onViewProfile, onMessage, onSetAdmin, onRemoveAdmin, onRemove,
}: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const m = member;
  // Close first, then run the action, so the confirm Alert sits above nothing.
  const wrap = (fn: () => void) => () => { onClose(); fn(); };
  const canManage = viewerIsHost && !isSelf && !!m;
  const canSetPrice = canManage && paymentMode === 'managed';

  const [priceOpen, setPriceOpen] = useState(false);
  // Don't let a stale "open" carry forward to the next member this sheet is
  // opened for.
  useEffect(() => {
    if (!visible) setPriceOpen(false);
  }, [visible]);

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
              {canManage && m.role === 'host' ? (
                <SheetOptionRow icon="shield-outline" label="Remove as admin" onPress={wrap(() => onRemoveAdmin(m))} />
              ) : null}
              {canSetPrice ? (
                <SheetOptionRow icon="cash-outline" label="Price" onPress={() => setPriceOpen(true)} pressScale />
              ) : null}
              {canManage ? (
                <SheetOptionRow icon="person-remove-outline" label="Remove from trip" danger onPress={wrap(() => onRemove(m))} />
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
          Mounted on `viewerIsHost && m` — `viewerIsHost` IS derived from
          useTripCore's query data (via isTripHost), same as everything else
          here, so "never on query data" isn't the reason this is safe. It's
          safe because saving a price never changes who is host: nothing this
          sheet does can flip that boolean while it's presenting, even after
          the `tripsKeys.detail` invalidation below triggers a refetch. `m`
          (the selected member) is likewise never nulled by that refetch — it
          is independent local state on the parent screen, only ever changed
          by an explicit tap on a different row. */}
      {viewerIsHost && m ? (
        <TravelerPriceSheet
          visible={priceOpen}
          tripId={tripId}
          userId={m.user_id}
          travelerName={m.name ?? 'This traveler'}
          budgetFxRate={budgetFxRate}
          onClose={() => setPriceOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: tripsKeys.payments(tripId, m.user_id) });
            queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
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
