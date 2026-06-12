// Full-screen "Packing & Gear" list — the "View all" target of the Plan-tab
// "Group Gear" preview (Figma node 12919-32700). Lists every shared gear item
// as its own card, with the same dark header the trip detail card uses. Tapping
// a card opens the claim sheet; approved members get a sticky "Request" button
// to ask the host for a missing item — same handlers the preview card uses, so
// claims/requests stay single-sourced through react-query.

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore, useTripGear } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { setMyGearClaim, createGearRequest, addGearItem } from '../../services/trips/groupTripsService';
import type { EnrichedGearItem } from '../../services/trips/groupTripsService';
import { ff } from '../../theme/fonts';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { GearRow, StickyGradientFooter } from '../../components/trips/plan/PlanSections';
import { TripIcon } from '../../components/trips/tripIcons';
import { GearItemSheet } from '../../components/trips/gear/GearItemSheet';
import { RequestGearSheet } from '../../components/trips/gear/RequestGearSheet';
import { ManageGearSheet } from '../../components/trips/gear/ManageGearSheet';

// Tokens mirror the Figma frame (accent #05BCD3, dark #212121, muted greys).
const T = {
  accent: '#05BCD3',
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
} as const;

interface Props {
  tripId: string;
  onBack: () => void;
  /** Host only — opens the "Edit Group Gear" screen (reorder/edit items). */
  onEdit?: () => void;
}

export default function PackingAndGearScreen({ tripId, onBack, onEdit }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  // Both reads hit the react-query cache seeded by TripDetail, so the list is
  // there instantly when arriving via "View all".
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];
  const gearQuery = useTripGear(tripId, currentUserId);
  const gearItems = gearQuery.data ?? [];

  const isHost = !!trip && !!currentUserId && trip.host_id === currentUserId;
  const isApprovedMember = useMemo(
    () =>
      !!currentUserId &&
      participants.some(p => p.user_id === currentUserId && p.role !== 'host'),
    [participants, currentUserId]
  );

  const [gearItemSheetItem, setGearItemSheetItem] = useState<EnrichedGearItem | null>(null);
  const [requestSheetVisible, setRequestSheetVisible] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);

  // Host adds a group gear item directly (Figma 12919-32232) — reuses the
  // "Edit Gear" sheet in add mode; goes straight into group_trip_gear_items.
  const handleAddItem = async (patch: { name: string; needed_qty: number }) => {
    if (!currentUserId) return;
    await addGearItem(tripId, currentUserId, patch.name, patch.needed_qty);
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  const handleSetGearClaim = async (itemId: string, quantity: number) => {
    if (!currentUserId) return;
    try {
      await setMyGearClaim(itemId, currentUserId, quantity);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
    } catch (e: any) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  const handleSubmitGearRequest = async (itemName: string, note: string, neededQty: number) => {
    if (!currentUserId) return;
    try {
      await createGearRequest(tripId, currentUserId, itemName, note || undefined, neededQty);
      Alert.alert('Request sent', 'The host will review your suggestion.');
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
      throw e;
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Dark header — chevron back + "Packing & Gear" + notification bell. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Packing & Gear
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
            <View style={styles.listHeaderText}>
              <Text style={styles.listTitle}>Group Gear</Text>
              <Text style={styles.listCount}>
                {gearItems.length} item{gearItems.length === 1 ? '' : 's'}
              </Text>
            </View>
            {/* Edit — host only — opens "Edit Group Gear" (reorder/edit). */}
            {isHost && onEdit ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={onEdit}
                activeOpacity={0.85}
                accessibilityLabel="Edit group gear"
              >
                <TripIcon name="edit-02" size={16} color="#FFFFFF" />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {gearItems.length === 0 ? (
            <Text style={styles.empty}>No items yet.</Text>
          ) : (
            <View style={styles.list}>
              {gearItems.map(item => (
                <GearRow
                  key={item.id}
                  item={item}
                  onPress={() => setGearItemSheetItem(item)}
                  currentUserId={currentUserId}
                  standalone
                />
              ))}
            </View>
          )}
        </ScrollView>

        {/* Sticky CTA — host adds a group gear item ("+ Add item"); approved
            members instead ask the host for a missing item. */}
        {isHost ? (
          <StickyGradientFooter bottomInset={insets.bottom}>
            <TouchableOpacity
              style={styles.requestBtn}
              activeOpacity={0.85}
              onPress={() => setAddSheetVisible(true)}
              accessibilityLabel="Add an item"
            >
              <Text style={styles.requestBtnText}>+ Add item</Text>
            </TouchableOpacity>
          </StickyGradientFooter>
        ) : isApprovedMember ? (
          <StickyGradientFooter bottomInset={insets.bottom}>
            <TouchableOpacity
              style={styles.requestBtn}
              activeOpacity={0.85}
              onPress={() => setRequestSheetVisible(true)}
              accessibilityLabel="Suggest an item"
            >
              <Text style={styles.requestBtnText}>Suggest item</Text>
            </TouchableOpacity>
          </StickyGradientFooter>
        ) : null}
      </View>

      {/* Gear bottom sheets — same handlers as the trip detail preview. */}
      <GearItemSheet
        visible={!!gearItemSheetItem}
        item={gearItemSheetItem}
        currentUserId={currentUserId}
        onClose={() => setGearItemSheetItem(null)}
        onSetClaim={handleSetGearClaim}
      />
      <RequestGearSheet
        visible={requestSheetVisible}
        onClose={() => setRequestSheetVisible(false)}
        onSubmit={handleSubmitGearRequest}
      />
      {/* Host "+ Add item" — the "Edit Gear" sheet in add mode (Figma 12919-32232). */}
      <ManageGearSheet
        visible={addSheetVisible}
        items={gearItems}
        formOnly
        editItem={null}
        onClose={() => setAddSheetVisible(false)}
        onSave={handleAddItem}
        onDelete={async () => {}}
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

  // "Group Gear" + "N items" (stacked) with a host "Edit" button on the right.
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  listHeaderText: { flex: 1, gap: 4 },
  listTitle: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, fontWeight: '700', color: T.title },
  listCount: { fontFamily: ff('Inter', '400'), fontSize: 16, lineHeight: 18, color: T.count },
  // Dark "Edit" pill (Figma 13179-8187) — pencil + white label, host only.
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: T.ink,
  },
  editBtnText: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: '#FFFFFF' },

  list: { gap: 8 },
  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.count },

  // Sticky "Request" CTA (Figma — dark #212121 button).
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 12,
    backgroundColor: T.ink,
  },
  requestBtnText: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
