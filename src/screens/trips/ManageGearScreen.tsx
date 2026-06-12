// Full-screen "Manage Gear" — the host's group-gear editor (Figma node
// 12919-14214). Same dark-header full-screen shell as PackingAndGear/YourGear.
// Lists every shared gear item as a white card with a ⋮ handle, name, status
// and a teal "Edit" link; a "+ Add Item" card and a dark "Save" button finish
// the screen. Tapping Edit / Add opens ManageGearSheet in form-only mode (the
// Figma "Edit Gear" sheet), which owns the name + needed-qty form. All writes
// go through the same gear service + react-query cache the trip detail uses.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripGear } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { updateGearItem, addGearItem, deleteGearItem } from '../../services/trips/groupTripsService';
import type { EnrichedGearItem } from '../../services/trips/groupTripsService';
import { ff } from '../../theme/fonts';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { StickyGradientFooter } from '../../components/trips/plan/PlanSections';
import { ManageGearSheet } from '../../components/trips/gear/ManageGearSheet';

// Tokens mirror the Figma frame (accent #05BCD3, dark #212121, muted greys).
const T = {
  accent: '#05BCD3',
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
  cardBorder: '#EEEEEE',
  handle: '#A0A0A0',
} as const;

interface Props {
  tripId: string;
  onBack: () => void;
}

const statusText = (item: EnrichedGearItem): string =>
  item.claimed_qty >= item.needed_qty
    ? 'Covered • All set'
    : `${item.claimed_qty} / ${item.needed_qty} collected`;

export default function ManageGearScreen({ tripId, onBack }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const gearQuery = useTripGear(tripId, currentUserId);
  const gearItems = gearQuery.data ?? [];

  // null + addOpen=false → closed. editItem set → edit; addOpen → add.
  const [editItem, setEditItem] = useState<EnrichedGearItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const closeForm = () => {
    setEditItem(null);
    setAddOpen(false);
  };

  const handleSaveGearItem = async (
    patch: { name: string; needed_qty: number },
    itemId?: string
  ) => {
    if (!currentUserId) return;
    if (itemId) {
      await updateGearItem(itemId, patch);
    } else {
      await addGearItem(tripId, currentUserId, patch.name, patch.needed_qty);
    }
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  const handleDeleteGearItem = async (itemId: string) => {
    await deleteGearItem(itemId);
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Dark header — chevron back + "Manage Gear" + notification bell. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Manage Gear
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
            <Text style={styles.listTitle}>Group Gear</Text>
            <Text style={styles.listCount}>
              {gearItems.length} item{gearItems.length === 1 ? '' : 's'}
            </Text>
          </View>

          <View style={styles.list}>
            {gearItems.map(item => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHandle}>
                  <Ionicons name="ellipsis-vertical" size={22} color={T.handle} />
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {statusText(item)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setEditItem(item)} hitSlop={8}>
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* "+ Add Item" — its own card, last in the list (Figma). */}
            <TouchableOpacity
              style={styles.addCard}
              onPress={() => setAddOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.addCardText}>+ Add Item</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Sticky dark "Save" button (Figma CTA). Edits persist immediately via
            the form sheet, so Save just returns to the trip. */}
        <StickyGradientFooter bottomInset={insets.bottom}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={onBack}
            activeOpacity={0.85}
            accessibilityLabel="Save and go back"
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </StickyGradientFooter>
      </View>

      {/* Edit / Add form — the Figma "Edit Gear" sheet (form-only). */}
      <ManageGearSheet
        visible={!!editItem || addOpen}
        formOnly
        editItem={editItem}
        items={gearItems}
        onClose={closeForm}
        onSave={handleSaveGearItem}
        onDelete={handleDeleteGearItem}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  // Header — identical to PackingAndGear/YourGear so the flow reads as one.
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
    lineHeight: 24,
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

  // "Group Gear" + "N items" (Figma 14 / 12).
  listHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  listTitle: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: T.title },
  listCount: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.count },

  list: { gap: 8 },

  // Gear card — white, rounded-20, border #eee, pl8 pr16 py18 (Figma).
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: 20,
  },
  cardHandle: { width: 22, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 4 },
  itemName: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: T.title },
  itemSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.count },
  editText: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.accent },

  // "+ Add Item" card — white, rounded-20, h76, centered (Figma).
  addCard: {
    height: 76,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCardText: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, fontWeight: '700', color: T.title },

  // Sticky dark "Save" button (Figma CTA).
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 12,
    backgroundColor: T.ink,
  },
  saveBtnText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
