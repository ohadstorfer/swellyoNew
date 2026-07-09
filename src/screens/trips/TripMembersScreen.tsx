// Full-screen "Members" list — the "View all" target of both the Plan-tab
// Members section and the Overview Participants row (Figma node 13459-48582).
//
// Three permission layers (same screen, progressively fewer affordances):
//   • Admin (host)      — sees committed badges + count, can Remove members.
//   • Member (approved) — sees committed badges + count, NO Remove.
//   • Outside viewer     — sees members + join dates only; no committed status,
//                          no count of who's committed, no Remove.

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore, useTripRequests } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { removeParticipant, promoteTripHost, demoteTripHost } from '../../services/trips/groupTripsService';
import type { EnrichedParticipant } from '../../services/trips/groupTripsService';
import Thumb from '../../components/Thumb';
import { CommittedPassportIcon, AdminBadgeIcon } from '../../components/trips/plan/PlanSections';
import { TripMemberSheet } from '../../components/trips/TripMemberSheet';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { ff } from '../../theme/fonts';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { isTripHost } from '../../utils/tripRole';

// Tokens mirror the sibling "view all" screens (TripUpdates / PackingAndGear).
const T = {
  accent: '#05BCD3',
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  cardBorder: '#EEEEEE',
} as const;

// "2 weeks ago" — same relative-time shape the TripDetail preview uses.
const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
};
const formatJoined = (iso: string | null): string => (iso ? `Joined ${timeAgo(iso)}` : '');

interface Props {
  tripId: string;
  onBack: () => void;
  /** Open a member's profile — invoked from the member sheet's "View profile". */
  onViewUserProfile?: (userId: string) => void;
  /** Start (or open) a DM with a member — from the sheet's "Message". */
  onMessage?: (userId: string, name?: string, avatar?: string | null) => void;
  /** Host only — open a requester's profile to review (Approve/Decline live
   *  inside the profile). */
  onReviewRequest?: (userId: string, requestId: string) => void;
}

export default function TripMembersScreen({ tripId, onBack, onViewUserProfile, onMessage, onReviewRequest }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  // Reads hit the react-query cache seeded by TripDetail, so the list is there
  // instantly when arriving via "View all".
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];

  // ── Permission layers ─────────────────────────────────────────────────────
  const isHost = isTripHost(trip, participants, currentUserId);
  const isMember = useMemo(
    () =>
      !!currentUserId &&
      participants.some(p => p.user_id === currentUserId && p.role !== 'host'),
    [participants, currentUserId]
  );
  const isInsider = isHost || isMember;
  // Insiders see who's committed; outside viewers do not.
  const canSeeCommitted = isInsider;

  const participantCount = participants.length;
  const maxParticipants = trip?.max_participants ?? null;
  const committedCount = useMemo(
    () => participants.filter(p => p.committed).length,
    [participants]
  );

  // Pending join requests — host only. Tapping a request opens the requester's
  // profile to review; Approve / Decline live inside that profile.
  const requestsQuery = useTripRequests(tripId, isHost);
  const pendingRequests = requestsQuery.data?.pending ?? [];

  const [sheetMember, setSheetMember] = useState<EnrichedParticipant | null>(null);

  const refetchCore = () =>
    queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });

  const confirmSetAdmin = (m: EnrichedParticipant) => {
    Alert.alert(
      `Set ${m.name ?? 'this member'} as admin?`,
      'Admins can edit this trip, approve requests, remove members, and delete the trip.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set as admin',
          onPress: async () => {
            try {
              await promoteTripHost(tripId, m.user_id);
              await refetchCore();
            } catch (e: any) {
              Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
            }
          },
        },
      ]
    );
  };

  const confirmRemoveAdmin = (m: EnrichedParticipant) => {
    Alert.alert(
      `Remove ${m.name ?? 'this member'} as admin?`,
      'They stay on the trip as a member and lose admin controls.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove as admin',
          style: 'destructive',
          onPress: async () => {
            try {
              await demoteTripHost(tripId, m.user_id);
              await refetchCore();
            } catch (e: any) {
              Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
            }
          },
        },
      ]
    );
  };

  const confirmRemove = (m: EnrichedParticipant) => {
    Alert.alert(
      'Remove from trip',
      `Remove ${m.name ?? 'this member'} from the trip? They lose access to the plan and group chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeParticipant(tripId, m.user_id);
              await refetchCore();
            } catch (e: any) {
              Alert.alert('Could not remove', friendlyErrorMessage(e, 'Please try again.'));
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Dark header — chevron back + "Members" + notification bell (Figma). */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Members
        </Text>
        <View style={styles.headerRight}>
          {currentUserId ? <NotificationCenter userId={currentUserId} bare /> : null}
        </View>
      </View>

      <View style={styles.body}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Pending join requests — host only. Same row design as the members
              card below; tapping (or "View") opens the requester's profile to
              review, where Approve / Decline live. */}
          {isHost && pendingRequests.length > 0 ? (
            <View style={styles.pendingSection}>
              <Text style={styles.sectionLabel}>
                {pendingRequests.length} pending request{pendingRequests.length === 1 ? '' : 's'}
              </Text>
              <View style={styles.card}>
                {pendingRequests.map((r, i) => {
                  const thumb = r.requester.profile_image_url;
                  const review = onReviewRequest
                    ? () => onReviewRequest(r.requester.user_id, r.id)
                    : undefined;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={review}
                      disabled={!review}
                      style={[styles.row, i < pendingRequests.length - 1 && styles.rowDivider]}
                      accessibilityRole={review ? 'button' : undefined}
                    >
                      <View style={styles.avatarWrap}>
                        {thumb ? (
                          <Thumb
                            uri={thumb}
                            size={96}
                            style={styles.avatar}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                          />
                        ) : (
                          <View style={[styles.avatar, styles.avatarEmpty]}>
                            <Ionicons name="person" size={26} color="#FFFFFF" />
                          </View>
                        )}
                      </View>

                      <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>
                          {r.requester.name ?? '—'}
                        </Text>
                        <Text style={styles.joined} numberOfLines={1}>
                          {r.request_note ? `“${r.request_note}”` : `Requested ${timeAgo(r.created_at)}`}
                        </Text>
                      </View>

                      {review ? <Text style={styles.viewText}>View</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Count row — "9/12 members" + (insiders only) "5 committed". */}
          <View style={styles.countRow}>
            <Text style={styles.countText}>
              {participantCount}
              {maxParticipants ? `/${maxParticipants}` : ''} member
              {participantCount === 1 ? '' : 's'}
            </Text>
            {canSeeCommitted ? (
              <Text style={styles.countText}>{committedCount} committed</Text>
            ) : null}
          </View>

          {participants.length === 0 ? (
            <Text style={styles.empty}>No members yet.</Text>
          ) : (
            <View style={styles.card}>
              {participants.map((p, i) => {
                const thumb = p.profile_image_url;
                const isOwnRow = p.user_id === currentUserId;
                return (
                  <Pressable
                    key={p.user_id}
                    onPress={isOwnRow ? undefined : () => setSheetMember(p)}
                    disabled={isOwnRow}
                    style={[styles.row, i < participants.length - 1 && styles.rowDivider]}
                    accessibilityRole={isOwnRow ? undefined : 'button'}
                    accessibilityLabel={p.name ? `Open options for ${p.name}` : undefined}
                  >
                    <View style={styles.avatarWrap}>
                      {thumb ? (
                        <Thumb
                          uri={thumb}
                          size={96}
                          style={styles.avatar}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <View style={[styles.avatar, styles.avatarEmpty]}>
                          <Ionicons name="person" size={26} color="#FFFFFF" />
                        </View>
                      )}
                      {/* Host → amber Admin crown (shown to everyone). Other
                          members → teal Committed badge (insiders only). */}
                      {p.role === 'host' ? (
                        <View style={styles.badge}>
                          <AdminBadgeIcon size={22} />
                        </View>
                      ) : canSeeCommitted && p.committed ? (
                        <View style={styles.badge}>
                          <CommittedPassportIcon size={22} />
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>
                        {p.name ?? '—'}
                      </Text>
                      <Text style={styles.joined} numberOfLines={1}>
                        {formatJoined(p.joined_at)}
                      </Text>
                    </View>

                    {!isOwnRow ? (
                      <Ionicons name="chevron-forward" size={20} color="#C4C4C4" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      <TripMemberSheet
        visible={!!sheetMember}
        member={sheetMember}
        viewerIsHost={isHost}
        isSelf={sheetMember?.user_id === currentUserId}
        onClose={() => setSheetMember(null)}
        onViewProfile={userId => onViewUserProfile?.(userId)}
        onMessage={(userId, name, avatar) => onMessage?.(userId, name, avatar)}
        onSetAdmin={confirmSetAdmin}
        onRemoveAdmin={confirmRemoveAdmin}
        onRemove={confirmRemove}
      />
    </SafeAreaView>
  );
}

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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'left',
    marginLeft: 8,
    fontFamily: ff('Montserrat', '700'),
  },
  headerRight: { minWidth: 28, alignItems: 'flex-end' },

  body: { flex: 1, backgroundColor: T.bg },
  scrollContent: { paddingHorizontal: 16, paddingTop: 24 },

  // Pending requests block (host only) — sits above the count row.
  pendingSection: { marginBottom: 24 },
  // "View" → opens the requester's profile to review (Approve/Decline inside).
  viewText: { fontFamily: ff('Inter', '700'), fontSize: 13, lineHeight: 16, fontWeight: '700', color: T.accent },
  // Matches the "X/Y members" count text below (Inter 400, 13/16).
  sectionLabel: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 16,
    color: T.title,
    marginBottom: 12,
    paddingHorizontal: 2,
  },

  // "9/12 members" ........ "5 committed"
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 16,
  },
  countText: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 16, color: T.title },

  // Rounded white card wrapping all rows, hairline dividers between them.
  card: {
    backgroundColor: T.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: T.cardBorder },

  avatarWrap: { width: 56, height: 56 },
  avatar: { width: 56, height: 56, borderRadius: 40 },
  avatarEmpty: { backgroundColor: '#C9CED2', alignItems: 'center', justifyContent: 'center' },
  // Committed badge overlaps the avatar's bottom-right, matching the Plan row.
  badge: { position: 'absolute', right: -2, bottom: -2 },

  rowText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  name: { fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 18, fontWeight: '700', color: T.title },
  joined: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 16, color: T.count, marginTop: 2 },

  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.count },
});
