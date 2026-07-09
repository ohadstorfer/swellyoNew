// Full-screen "Updates" list — the "View all" target of the Plan-tab
// "Recent admin updates" preview (Figma node 12933-38189). Lists every admin
// update in full under the same dark header the trip detail card uses. The host
// gets a per-card "Edit" link that opens the same AdminUpdateSheet (edit/delete)
// the Plan tab uses, so editing works from here too (Figma node 13179:8792).

import React, { useState } from 'react';
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
import { useTripCore, useTripAdminUpdates } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { updateAdminUpdate, deleteAdminUpdate } from '../../services/trips/groupTripsService';
import type { AdminUpdate } from '../../services/trips/groupTripsService';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { AdminUpdateRow } from '../../components/trips/AdminUpdateUI';
import { AdminUpdateSheet } from '../../components/trips/updates/AdminUpdateSheet';
import { ff } from '../../theme/fonts';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { isTripHost } from '../../utils/tripRole';

// Tokens mirror the Figma frame (accent #05BCD3, dark #212121, muted greys).
const T = {
  accent: '#05BCD3',
  ink: '#212121',
  inkBody: '#222B30',
  title: '#333333',
  count: '#7B7B7B',
  time: '#6A7282',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  cardBorder: '#EEEEEE',
  iconBg: '#F7F7F7',
  fontHead: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
  fontBody: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
} as const;

// Same relative-time formatter the TripDetail preview uses (kept local — there
// is no shared date util in the project).
const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
};

interface Props {
  tripId: string;
  onBack: () => void;
}

export default function TripUpdatesScreen({ tripId, onBack }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  // Both reads hit the react-query cache seeded by TripDetail, so the list and
  // host check are there instantly when arriving via "View all".
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];
  const isHost = isTripHost(trip, participants, currentUserId);
  const updatesQuery = useTripAdminUpdates(tripId);
  const updates = updatesQuery.data ?? [];

  // Host edit — same AdminUpdateSheet (edit/delete) the Plan tab drives, with
  // the same optimistic cache patch so the list updates instantly.
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const editingUpdate = editingUpdateId ? updates.find(u => u.id === editingUpdateId) ?? null : null;
  const editingTitle = editingUpdate?.title ?? '';
  const editingBody = editingUpdate?.body ?? '';

  const patchUpdatesCache = (updater: (prev: AdminUpdate[]) => AdminUpdate[]) => {
    queryClient.setQueryData<AdminUpdate[]>(tripsKeys.detailUpdates(tripId), prev =>
      updater(prev ?? [])
    );
  };

  const handleSubmitEdit = async (title: string, body: string) => {
    const titleText = title.trim();
    if (!editingUpdateId || !titleText) {
      setEditingUpdateId(null);
      return;
    }
    setSavingUpdate(true);
    try {
      const updated = await updateAdminUpdate(editingUpdateId, titleText, body.trim());
      patchUpdatesCache(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      setEditingUpdateId(null);
    } catch (e: any) {
      Alert.alert('Could not save update', friendlyErrorMessage(e, 'Please try again.'));
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleDeleteEditing = () => {
    if (!editingUpdateId) return;
    Alert.alert('Delete update', 'This update will be removed for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const id = editingUpdateId;
          try {
            await deleteAdminUpdate(id);
            patchUpdatesCache(prev => prev.filter(u => u.id !== id));
            setEditingUpdateId(null);
          } catch (e: any) {
            Alert.alert('Could not delete', friendlyErrorMessage(e, 'Please try again.'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Dark header — chevron back + "Updates" + notification bell (Figma). */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Updates
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
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Recent admin updates</Text>
            <Text style={styles.listCount}>
              {updates.length} Update{updates.length === 1 ? '' : 's'}
            </Text>
          </View>

          {updates.length === 0 ? (
            <Text style={styles.empty}>No updates yet.</Text>
          ) : (
            <View style={styles.list}>
              {updates.map(u => (
                <AdminUpdateRow
                  key={u.id}
                  update={u}
                  expanded
                  formatTime={formatRelativeTime}
                  right={
                    isHost ? (
                      <Pressable onPress={() => setEditingUpdateId(u.id)} hitSlop={8}>
                        <Text style={styles.editLink}>Edit</Text>
                      </Pressable>
                    ) : undefined
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Host edits an existing update — opens the same sheet as the Plan tab,
          in edit mode (with delete). */}
      <AdminUpdateSheet
        visible={!!editingUpdateId}
        mode="edit"
        initialTitle={editingTitle}
        initialBody={editingBody}
        saving={savingUpdate}
        onClose={() => setEditingUpdateId(null)}
        onSubmit={handleSubmitEdit}
        onDelete={handleDeleteEditing}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  // Header — identical to TripDetailScreen's so the two read as one flow.
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

  // "Recent admin updates" + "N Updates"
  listHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  listTitle: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: T.title },
  listCount: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.count },

  list: { gap: 8 },

  // Per-card host "Edit" — bumped up from the Figma 10px for legibility.
  editLink: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 20, color: T.accent },

  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.count },
});
