// Host-facing sheet to invite matching surfers to a group trip.
// Lists candidates scored against the trip's criteria (see tripInviteMatching.ts)
// and lets the host invite them one at a time.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { listInviteCandidates, inviteUserToTrip, type InviteCandidate } from '../../services/trips/tripInvitesService';
import type { TripInviteCriteria } from '../../services/trips/tripInviteMatching';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';

interface InviteMembersSheetProps {
  visible: boolean;
  tripId: string;
  hostId: string;
  criteria: TripInviteCriteria;
  onClose: () => void;
  onInvited: (userId: string) => void;
  onViewProfile: (userId: string) => void;
}

export function InviteMembersSheet({
  visible, tripId, hostId, criteria, onClose, onInvited, onViewProfile,
}: InviteMembersSheetProps) {
  const insets = useSafeAreaInsets();
  const [candidates, setCandidates] = useState<InviteCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    listInviteCandidates(tripId, criteria)
      .then(result => { if (!cancelled) setCandidates(result); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, tripId, criteria]);

  const handleInvite = useCallback(async (userId: string) => {
    setInvitingId(userId);
    try {
      await inviteUserToTrip(tripId, userId, hostId);
      setCandidates(prev => prev.filter(c => c.user_id !== userId));
      onInvited(userId);
    } catch (e) {
      // Leave the candidate in the list so the host can retry.
      showErrorAlert('Could not send invite', e, 'Could not send invite. Please try again.');
    } finally {
      setInvitingId(null);
    }
  }, [tripId, hostId, onInvited]);

  return (
    <BottomSheetShell visible={visible} onClose={onClose} swipeToDismiss={false}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        <Text style={styles.title}>Invite surfers</Text>
        {loading ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <FlatList
            data={candidates}
            keyExtractor={c => c.user_id}
            style={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No matching surfers found.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <TouchableOpacity style={styles.rowMain} onPress={() => onViewProfile(item.user_id)}>
                  {item.profile_image_url ? (
                    <Image source={{ uri: item.profile_image_url }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]} />
                  )}
                  <View>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.meta}>
                      {[item.surf_level_category, item.surfboard_type, item.country_from].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.inviteButton}
                  disabled={invitingId === item.user_id}
                  onPress={() => handleInvite(item.user_id)}
                >
                  <Text style={styles.inviteButtonText}>{invitingId === item.user_id ? '...' : 'Invite'}</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24, maxHeight: '80%' },
  title: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', marginBottom: 12, paddingHorizontal: 16, includeFontPadding: false },
  loading: { marginTop: 32, marginBottom: 32 },
  list: { flexGrow: 0 },
  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, textAlign: 'center', color: '#888', marginTop: 32, marginBottom: 32, includeFontPadding: false },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: '#ddd' },
  name: { fontFamily: ff('Montserrat', '600'), fontSize: 15, color: '#212121', includeFontPadding: false },
  meta: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#888', marginTop: 2, includeFontPadding: false },
  inviteButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#111' },
  inviteButtonText: { fontFamily: ff('Montserrat', '600'), fontSize: 13, color: '#fff', includeFontPadding: false },
});

export default InviteMembersSheet;
