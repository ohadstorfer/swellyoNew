// Full-screen "Members pack suggestion" editor — the host's "Manage" target on
// the Plan-tab "What should members pack for themselves?" section. Pushed as a
// card (slide-from-right) from the trip detail. Figma node 12933-36310.
//
// Edits are staged in a local draft (add / edit / delete via the EditGearItemSheet
// bottom sheet) and only persisted to group_trips.personal_gear_host_suggestion
// when the host taps the dark "Save" button — a DB trigger then fans the new list
// out to each member's checklist.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { setTripGroupGear } from '../../services/trips/groupTripsService';
import { ff } from '../../theme/fonts';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { StickyGradientFooter } from '../../components/trips/plan/PlanSections';
import { EditGearItemSheet } from '../../components/trips/gear/EditGearItemSheet';

const T = {
  accent: '#05BCD3',
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
  hairline: '#EEEEEE',
} as const;

type Sheet = { mode: 'add' } | { mode: 'edit'; index: number } | null;

interface Props {
  tripId: string;
  onBack: () => void;
}

export default function ManageSuggestedGearScreen({ tripId, onBack }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;

  // Local draft, seeded once from the cached trip (later refetches don't clobber
  // in-progress edits).
  const [draft, setDraft] = useState<string[]>(trip?.personal_gear_host_suggestion ?? []);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && trip) {
      setDraft(trip.personal_gear_host_suggestion ?? []);
      seeded.current = true;
    }
  }, [trip]);

  const [sheet, setSheet] = useState<Sheet>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = (name: string) => {
    setDraft(prev => {
      if (sheet?.mode === 'edit') return prev.map((n, i) => (i === sheet.index ? name : n));
      return [...prev, name];
    });
    setSheet(null);
  };

  const handleDelete = () => {
    if (sheet?.mode !== 'edit') return;
    const idx = sheet.index;
    setDraft(prev => prev.filter((_, i) => i !== idx));
    setSheet(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setTripGroupGear(tripId, draft);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      onBack();
    } catch (e: any) {
      Alert.alert('Could not save list', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Names already used (excludes the one being edited) for the sheet's dedupe.
  const existingNames =
    sheet?.mode === 'edit' ? draft.filter((_, i) => i !== sheet.index) : draft;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Manage Member
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
            <Text style={styles.listTitle}>Members pack suggestion</Text>
            <Text style={styles.listCount}>
              {draft.length} item{draft.length === 1 ? '' : 's'}
            </Text>
          </View>

          {draft.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.itemCard}>
              <Ionicons name="ellipsis-vertical" size={20} color="#333333" />
              <Text style={styles.itemName} numberOfLines={2}>
                {item}
              </Text>
              <TouchableOpacity
                onPress={() => setSheet({ mode: 'edit', index })}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => setSheet({ mode: 'add' })}
            activeOpacity={0.85}
          >
            <Text style={styles.addCardText}>+ Add Item</Text>
          </TouchableOpacity>
        </ScrollView>

        <StickyGradientFooter bottomInset={insets.bottom}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </StickyGradientFooter>
      </View>

      <EditGearItemSheet
        visible={sheet !== null}
        mode={sheet?.mode === 'edit' ? 'edit' : 'add'}
        initialName={sheet?.mode === 'edit' ? draft[sheet.index] : ''}
        existingNames={existingNames}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        onClose={() => setSheet(null)}
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
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'left',
    marginLeft: 8,
    fontFamily: ff('Montserrat', '700'),
  },
  headerRight: { minWidth: 28, alignItems: 'flex-end' },

  body: { flex: 1, backgroundColor: T.bg },
  scrollContent: { paddingHorizontal: 16, paddingTop: 24 },

  listHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  listTitle: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: T.title },
  listCount: { fontFamily: ff('Inter', '400'), fontSize: 16, lineHeight: 18, color: T.count },

  // Item cards — dots handle + name + Edit (Figma 12933-36310).
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: T.hairline,
    borderRadius: 20,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 18,
    marginBottom: 8,
  },
  itemName: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: T.title },
  editLink: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.accent },

  addCard: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: T.hairline,
    borderRadius: 20,
    paddingVertical: 23,
    marginBottom: 8,
  },
  addCardText: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: T.title },

  saveBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.ink,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#FFFFFF' },
});
