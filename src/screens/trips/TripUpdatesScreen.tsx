// Full-screen "Updates" list — the "View all" target of the Plan-tab
// "Recent admin updates" preview (Figma node 12933-38189). Read-only: host
// add/edit stays on the TripDetail preview card; here we just list every
// admin update with the same dark header + sticky Trip Chat chrome the trip
// detail card uses, so the screen feels native to the trips flow.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore, useTripAdminUpdates } from '../../hooks/trips/useTripDetail';
import { messagingService } from '../../services/messaging/messagingService';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { StickyTripChat } from '../../components/trips/plan/PlanSections';
import { AdminUpdateRow, UpdateDetailModal } from '../../components/trips/AdminUpdateUI';
import { ff } from '../../theme/fonts';
import type { AdminUpdate } from '../../services/trips/groupTripsService';

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
  onOpenGroupChat?: (params: {
    conversationId: string;
    title: string;
    heroImageUrl?: string | null;
    tripId?: string;
  }) => void;
}

export default function TripUpdatesScreen({ tripId, onBack, onOpenGroupChat }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const currentUserId = contextUser?.id?.toString() ?? null;
  // Full text of a tapped (truncated) update — drives the detail overlay.
  const [detail, setDetail] = useState<AdminUpdate | null>(null);

  // Both reads hit the react-query cache seeded by TripDetail, so the list is
  // there instantly when arriving via "View all".
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const updatesQuery = useTripAdminUpdates(tripId);
  const updates = updatesQuery.data ?? [];

  const [openingChat, setOpeningChat] = useState(false);

  const handleOpenGroupChat = async () => {
    if (!trip || !onOpenGroupChat) return;
    setOpeningChat(true);
    try {
      let conv = await messagingService.getConversationByTripId(trip.id);
      if (!conv) {
        conv = await messagingService.createGroupConversation(trip.title || 'Surftrip', [], {
          trip_id: trip.id,
        });
      }
      onOpenGroupChat({
        conversationId: conv.id,
        title: trip.title || 'Surftrip',
        heroImageUrl: trip.hero_image_url ?? null,
        tripId: trip.id,
      });
    } catch (e: any) {
      Alert.alert('Could not open chat', e?.message || 'Please try again.');
    } finally {
      setOpeningChat(false);
    }
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
            { paddingBottom: Math.max(insets.bottom, 16) + 96 },
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
                  formatTime={formatRelativeTime}
                  onOpenDetail={setDetail}
                />
              ))}
            </View>
          )}
        </ScrollView>

        {trip && onOpenGroupChat ? (
          <StickyTripChat
            onPress={handleOpenGroupChat}
            loading={openingChat}
            bottomInset={insets.bottom}
          />
        ) : null}
      </View>

      <UpdateDetailModal
        update={detail}
        formatTime={formatRelativeTime}
        onClose={() => setDetail(null)}
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
  listTitle: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 24, fontWeight: '700', color: T.title },
  listCount: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.count },

  list: { gap: 8 },

  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.count },
});
