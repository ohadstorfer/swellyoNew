// Host-facing sheet to invite matching surfers to a group trip.
// Lists candidates scored against the trip's criteria (see tripInviteMatching.ts)
// and lets the host invite them one at a time. Visual language matches the other
// group-trip sheets (TripMemberSheet): white surface, grabber, Thumb avatars.
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import Thumb from '../Thumb';
import { Image } from 'expo-image';
import { Images } from '../../assets/images';
import { listInviteCandidates, inviteUserToTrip, type InviteCandidate } from '../../services/trips/tripInvitesService';
import type { TripInviteCriteria } from '../../services/trips/tripInviteMatching';
import { ff } from '../../theme/fonts';

interface InviteMembersSheetProps {
  visible: boolean;
  tripId: string;
  hostId: string;
  criteria: TripInviteCriteria;
  onClose: () => void;
  onInvited: (userId: string) => void;
  onViewProfile: (userId: string) => void;
}

const SKELETON_ROWS = [0, 1, 2, 3];

export function InviteMembersSheet({
  visible, tripId, hostId, criteria, onClose, onInvited, onViewProfile,
}: InviteMembersSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [candidates, setCandidates] = useState<InviteCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [failedId, setFailedId] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    listInviteCandidates(tripId, criteria)
      .then(result => { if (!cancelled) setCandidates(result); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tripId, criteria]);

  useEffect(() => {
    if (!visible) return;
    setInvitedIds(new Set());
    setFailedId(null);
    return load();
  }, [visible, load]);

  const handleInvite = useCallback(async (userId: string) => {
    setInvitingId(userId);
    setFailedId(null);
    try {
      await inviteUserToTrip(tripId, userId, hostId);
      // Keep the row (marked "Invited") instead of removing it — no list jump.
      setInvitedIds(prev => new Set(prev).add(userId));
      onInvited(userId);
    } catch {
      // Inline error on the row itself; the host can just tap again.
      setFailedId(userId);
    } finally {
      setInvitingId(null);
    }
  }, [tripId, hostId, onInvited]);

  const renderRow = ({ item }: { item: InviteCandidate }) => {
    const isInviting = invitingId === item.user_id;
    const isInvited = invitedIds.has(item.user_id);
    const isFailed = failedId === item.user_id;
    return (
      <View style={styles.row}>
        <TouchableOpacity style={styles.rowMain} activeOpacity={0.6} onPress={() => onViewProfile(item.user_id)}>
          {item.profile_image_url ? (
            <Thumb uri={item.profile_image_url} size={128} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
          )}
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.meta, isFailed && styles.metaError]} numberOfLines={1}>
              {isFailed
                ? "Couldn't send — tap Invite to retry"
                : [item.surf_level_category, item.surfboard_type, item.country_from].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </TouchableOpacity>
        {isInvited ? (
          <View style={styles.invitedPill}>
            <Ionicons name="checkmark" size={14} color="#1B8A4B" />
            <Text style={styles.invitedPillText}>Invited</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.inviteButton, isInviting && styles.inviteButtonBusy]}
            activeOpacity={0.8}
            disabled={isInviting}
            onPress={() => handleInvite(item.user_id)}
          >
            {isInviting
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={styles.inviteButtonText}>Invite</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const skeleton = (
    <View>
      {SKELETON_ROWS.map(i => (
        <View key={i} style={styles.row}>
          <View style={styles.rowMain}>
            <View style={[styles.avatar, styles.skeletonBlock]} />
            <View style={styles.rowText}>
              <View style={[styles.skeletonBlock, styles.skeletonName]} />
              <View style={[styles.skeletonBlock, styles.skeletonMeta]} />
            </View>
          </View>
          <View style={[styles.skeletonBlock, styles.skeletonButton]} />
        </View>
      ))}
    </View>
  );

  const emptyState = (
    <View style={styles.stateBox}>
      <Ionicons name="people-outline" size={28} color="#B9BEC3" />
      <Text style={styles.stateTitle}>No matching surfers</Text>
      <Text style={styles.stateSub}>No one matches this trip's criteria right now. Check back later.</Text>
    </View>
  );

  const errorState = (
    <View style={styles.stateBox}>
      <Ionicons name="cloud-offline-outline" size={28} color="#B9BEC3" />
      <Text style={styles.stateTitle}>Couldn't load surfers</Text>
      <TouchableOpacity style={styles.retryButton} activeOpacity={0.8} onPress={load}>
        <Text style={styles.retryButtonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      {({ panHandlers }) => (
        <View style={[styles.sheet, { maxHeight: Math.round(windowHeight * 0.7), paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          {/* Grabber + header own the swipe-down gesture so it never fights the list scroll. */}
          <View {...panHandlers} style={styles.handleZone}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Invite surfers</Text>
            <Text style={styles.subtitle}>Surfers whose profile matches this trip</Text>
          </View>
          {loading ? skeleton : loadError ? errorState : (
            <FlatList
              data={candidates}
              keyExtractor={c => c.user_id}
              renderItem={renderRow}
              ListEmptyComponent={emptyState}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handleZone: { paddingTop: 8, paddingBottom: 8, paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#E2E5E8', marginBottom: 14 },
  title: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', includeFontPadding: false },
  subtitle: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 2, includeFontPadding: false },
  listContent: { paddingBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, marginRight: 12 },
  rowText: { flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', includeFontPadding: false },
  meta: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B', marginTop: 2, includeFontPadding: false },
  metaError: { color: '#C0392B' },

  inviteButton: {
    minWidth: 76, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#212121',
  },
  inviteButtonBusy: { opacity: 0.7 },
  inviteButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 13, color: '#FFFFFF', includeFontPadding: false },
  invitedPill: {
    minWidth: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E8F5EE',
  },
  invitedPillText: { fontFamily: ff('Montserrat', '600'), fontSize: 13, color: '#1B8A4B', includeFontPadding: false },

  stateBox: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 32 },
  stateTitle: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', marginTop: 10, includeFontPadding: false },
  stateSub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 4, textAlign: 'center', includeFontPadding: false },
  retryButton: { marginTop: 14, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 20, backgroundColor: '#212121' },
  retryButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 13, color: '#FFFFFF', includeFontPadding: false },

  skeletonBlock: { backgroundColor: '#EEF0F2', borderRadius: 8 },
  skeletonName: { width: 140, height: 14, marginBottom: 6 },
  skeletonMeta: { width: 180, height: 10 },
  skeletonButton: { width: 76, height: 34, borderRadius: 20 },
});

export default InviteMembersSheet;
