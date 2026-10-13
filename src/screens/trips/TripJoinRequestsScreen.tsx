// "Active Requests" — every pending join request on one trip (Figma node
// 17776:48934). The target of the Dashboard's "Join Request" action card.
//
// Approve and Contact sit on the row. Decline does not: tapping the row opens
// the requester's profile, where Approve / Decline both live, the same way the
// Members screen's pending rows do.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore, useTripRequests } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { approveJoinRequest } from '../../services/trips/groupTripsService';
import type { EnrichedJoinRequest } from '../../services/trips/groupTripsService';
import Thumb from '../../components/Thumb';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { PressableScale } from '../../components/trips/PressableScale';
import { textStyle, textStyles } from '../../theme/typography';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { hapticSuccess, hapticError } from '../../utils/haptics';
import { isTripHost } from '../../utils/tripRole';
import { useTripCapabilities } from '../../hooks/trips/useTripCapabilities';

// Tokens mirror the sibling "view all" screens (TripMembers / TripUpdates).
const T = {
  accent: '#05BCD3',
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  row: '#F7F7F7',
  rowPressed: '#F0F0F0',
  hairline: '#EEEEEE',
  outline: '#CFCFCF',
} as const;

/** "15:20" for today, then "1d", "2w" — the short stamp on the right of a row. */
const shortTime = (iso: string): string => {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  if (then.toDateString() === now.toDateString()) {
    return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const days = Math.max(1, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
};

interface Props {
  tripId: string;
  onBack: () => void;
  /** Start (or open) a DM with the requester — the "Contact" button. */
  onMessage?: (userId: string, name?: string, avatar?: string | null) => void;
  /** Open the requester's profile to review (Approve / Decline live inside). */
  onReviewRequest?: (userId: string, requestId: string) => void;
}

export default function TripJoinRequestsScreen({
  tripId,
  onBack,
  onMessage,
  onReviewRequest,
}: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  // Reads hit the react-query cache seeded by TripDetail.
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];

  // Same gate as TripMembersScreen: reviewing join requests is `trip.edit`.
  // UX only — RLS decides.
  const isHost = isTripHost(trip, participants, currentUserId);
  const { can } = useTripCapabilities(tripId, trip?.hosting_style === 'C');
  const canManageRoster = isHost || can('trip.edit');

  const requestsQuery = useTripRequests(tripId, canManageRoster);
  const pending = canManageRoster ? (requestsQuery.data?.pending ?? []) : [];

  // Rows with an approval in flight — both buttons are off until it lands.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  /**
   * Same service call and the same three invalidations as `handleApprove` in
   * TripDetailScreen. The one difference: no optimistic cache write. The row
   * shows a spinner and leaves when the refetch drops it, so a failed approval
   * never has a row to put back.
   */
  const approve = async (requestId: string) => {
    if (busyIds.has(requestId)) return;
    hapticSuccess();
    setBusyIds(prev => new Set(prev).add(requestId));
    try {
      await approveJoinRequest(requestId);
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
      // Awaited, so the spinner holds until the row is really gone.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) }),
        queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequests(tripId) }),
      ]);
    } catch (e: any) {
      hapticError();
      Alert.alert('Could not approve', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setBusyIds(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const loading = coreQuery.isPending || (canManageRoster && requestsQuery.isPending);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Active Requests
        </Text>
        <View style={styles.headerRight}>
          {currentUserId ? <NotificationCenter userId={currentUserId} bare /> : null}
        </View>
      </View>

      <View style={styles.body}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : canManageRoster && requestsQuery.isError ? (
          <View style={styles.center}>
            <Text style={styles.empty}>That did not load.</Text>
            <Pressable onPress={() => void requestsQuery.refetch()} hitSlop={8}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        ) : pending.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>No pending requests.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
            showsVerticalScrollIndicator={false}
          >
            {pending.map(r => (
              <RequestRow
                key={r.id}
                request={r}
                tripTitle={trip?.title ?? null}
                tripCoverUrl={trip?.hero_image_url ?? null}
                busy={busyIds.has(r.id)}
                onApprove={() => void approve(r.id)}
                onContact={
                  onMessage
                    ? () =>
                        onMessage(
                          r.requester.user_id,
                          r.requester.name ?? undefined,
                          r.requester.profile_image_url,
                        )
                    : undefined
                }
                onOpen={
                  onReviewRequest ? () => onReviewRequest(r.requester.user_id, r.id) : undefined
                }
              />
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const RequestRow: React.FC<{
  request: EnrichedJoinRequest;
  tripTitle: string | null;
  tripCoverUrl: string | null;
  busy: boolean;
  onApprove: () => void;
  onContact?: () => void;
  onOpen?: () => void;
}> = ({ request, tripTitle, tripCoverUrl, busy, onApprove, onContact, onOpen }) => {
  const avatar = request.requester.profile_image_url;
  const name = request.requester.name ?? '—';
  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={onOpen ? `Review ${name}'s request` : undefined}
    >
      {/* Requester on top, the trip's cover tucked behind to the right. */}
      <View style={styles.images}>
        {avatar ? (
          <Thumb
            uri={avatar}
            size={96}
            style={[styles.avatar, styles.avatarFront]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFront, styles.avatarEmpty]}>
            <Ionicons name="person" size={24} color="#FFFFFF" />
          </View>
        )}
        {tripCoverUrl ? (
          <Thumb
            uri={tripCoverUrl}
            size={96}
            style={styles.avatar}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]} />
        )}
      </View>

      <View style={styles.rowMain}>
        <View style={styles.rowHead}>
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              requested to <Text style={styles.subJoin}>join</Text>
              {tripTitle ? <Text style={styles.subTrip}>{` ${tripTitle}`}</Text> : ' this trip'}
            </Text>
          </View>
          <View style={styles.timeWrap}>
            <Text style={styles.time}>{shortTime(request.created_at)}</Text>
            <View style={styles.dot} />
          </View>
        </View>

        {/* Each button sits in a flex slot: PressableScale puts `style` on an
            inner view, so `flex: 1` on the button itself would not stretch it. */}
        <View style={styles.buttons}>
          <View style={styles.buttonSlot}>
            <PressableScale
              onPress={onApprove}
              disabled={busy}
              style={[styles.button, styles.approve]}
              accessibilityLabel={`Approve ${name}`}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" style={styles.buttonSpinner} />
              ) : (
                <Text style={[styles.buttonText, styles.approveText]}>Approve</Text>
              )}
            </PressableScale>
          </View>
          <View style={styles.buttonSlot}>
            <PressableScale
              onPress={onContact}
              disabled={busy || !onContact}
              style={[styles.button, styles.contact, busy && styles.buttonOff]}
              accessibilityLabel={`Message ${name}`}
            >
              <Text style={styles.buttonText}>Contact</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

// Text sizes are the Figma styles read per node with get_variable_defs
// (mobile mode), not the px the export prints.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: T.ink,
  },
  backBtn: { padding: 4 },
  // Headings/M H-5
  headerTitle: { ...textStyles.MH5, color: '#FFFFFF', flex: 1, marginLeft: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', minWidth: 28, justifyContent: 'flex-end' },

  body: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  empty: { ...textStyles.MB2, color: T.count },
  link: { ...textStyle('MB2', '500'), color: T.accent },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
    backgroundColor: T.row,
    borderBottomWidth: 1,
    borderBottomColor: T.hairline,
  },
  rowPressed: { backgroundColor: T.rowPressed },

  images: { flexDirection: 'row', alignItems: 'center', width: 80 },
  avatar: { width: 52, height: 52, borderRadius: 40, backgroundColor: '#C9CED2' },
  avatarFront: { zIndex: 2, marginRight: -24, borderWidth: 1.5, borderColor: T.surface },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },

  rowMain: { flex: 1, minWidth: 0, gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  // Size/md on Size/xl, SemiBold — Body/M B-2 with a weight override.
  name: { ...textStyle('MB2', '600'), color: T.title },
  // Body/B-3; "join" and the trip title are bold overrides on the same style.
  sub: { ...textStyles.B3, color: T.count },
  subJoin: { ...textStyle('B3', '700'), color: T.title },
  subTrip: { ...textStyle('B3', '700'), color: T.count },
  timeWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Body/B-4
  time: { ...textStyles.B4, color: T.count, textAlign: 'right' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent },

  buttons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  buttonSlot: { flex: 1 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 11,
    borderRadius: 12,
  },
  approve: { backgroundColor: T.accent },
  // The border is inside the box, so the outline button loses 1.5 of padding
  // on each side to stay the same height as the filled one.
  contact: {
    backgroundColor: T.surface,
    borderWidth: 1.5,
    borderColor: T.outline,
    paddingVertical: 9.5,
  },
  buttonOff: { opacity: 0.5 },
  // Body/B-3
  buttonText: { ...textStyles.B3, color: T.title, textAlign: 'center' },
  approveText: { color: '#FFFFFF' },
  // Same 18 as the label's line height, so the button does not change size.
  buttonSpinner: { height: 18 },
});
