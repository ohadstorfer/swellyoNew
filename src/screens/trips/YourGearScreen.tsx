// Full-screen "Your Gear" checklist — the "View all (N)" target of the Plan-tab
// "Your Gear" preview (Figma node 12919-33069 middle frame). Lists the member's
// gear (host suggestions + their own items) split into packed (done, struck) and
// a "Don't forget" section for what's still to bring. Host-suggested items carry
// a tag; the member's own items can be deleted. "+ Add item" asks the host for a
// new shared item (host reviews — same request flow as Group Gear).
//
// Reads from the same react-query cache (tripsKeys.detail) seeded by TripDetail,
// so the list is there instantly when arriving via "View all". Toggles/deletes
// update the cache optimistically and persist via groupTripsService.

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import {
  setMyGroupGear,
  setMyPersonalGearList,
} from '../../services/trips/groupTripsService';
import type { GroupGearItem, PersonalGearItem } from '../../services/trips/groupTripsService';
import { ff } from '../../theme/fonts';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import { StickyGradientFooter } from '../../components/trips/plan/PlanSections';
import { TripIcon } from '../../components/trips/tripIcons';
import { AddPersonalGearSheet } from '../../components/trips/gear/AddPersonalGearSheet';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { isTripHost } from '../../utils/tripRole';

const T = {
  accent: '#05BCD3',
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  bg: '#FAFAFA',
  hairline: '#EEEEEE',
} as const;

type Row = { kind: 'host' | 'mine'; name: string; done: boolean };

interface Props {
  tripId: string;
  onBack: () => void;
}

export default function YourGearScreen({ tripId, onBack }: Props) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];

  const isHost = isTripHost(trip, participants, currentUserId);
  const me = participants.find(p => p.user_id === currentUserId);
  const myGroupGear: GroupGearItem[] = me?.personal_gear_by_host ?? [];
  const myPersonalGear: PersonalGearItem[] = me?.personal_gear_by_me ?? [];
  // Host suggestions are what the host tells MEMBERS to pack — the host isn't
  // packing them, so hide them from the host's own Your Gear list.
  const hostSuggestions = isHost ? [] : trip?.personal_gear_host_suggestion ?? [];

  const rows: Row[] = useMemo(
    () => [
      ...hostSuggestions.map(name => ({
        kind: 'host' as const,
        name,
        done: myGroupGear.find(it => it.name === name)?.done ?? false,
      })),
      ...myPersonalGear.map(it => ({ kind: 'mine' as const, name: it.name, done: it.done })),
    ],
    [hostSuggestions, myGroupGear, myPersonalGear]
  );

  const doneRows = rows.filter(r => r.done);
  const pendingRows = rows.filter(r => !r.done);
  const doneCount = doneRows.length;

  const [addVisible, setAddVisible] = useState(false);

  // Optimistically patch this member's participant row in the cache, then revert
  // on error (mirrors TripDetailScreen's patchParticipantsCache).
  const patchMe = (patch: (p: any) => any) =>
    queryClient.setQueryData(tripsKeys.detail(tripId), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        participants: old.participants.map((p: any) =>
          p.user_id === currentUserId ? patch(p) : p
        ),
      };
    });

  const toggle = async (row: Row) => {
    if (!currentUserId) return;
    if (row.kind === 'host') {
      const exists = myGroupGear.some(it => it.name === row.name);
      const next = exists
        ? myGroupGear.map(it => (it.name === row.name ? { ...it, done: !it.done } : it))
        : [...myGroupGear, { name: row.name, done: true }];
      patchMe(p => ({ ...p, personal_gear_by_host: next }));
      try {
        await setMyGroupGear(tripId, currentUserId, next);
      } catch (e: any) {
        patchMe(p => ({ ...p, personal_gear_by_host: myGroupGear }));
        Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
      }
    } else {
      const next = myPersonalGear.map(it =>
        it.name === row.name ? { ...it, done: !it.done } : it
      );
      patchMe(p => ({ ...p, personal_gear_by_me: next }));
      try {
        await setMyPersonalGearList(tripId, currentUserId, next);
      } catch (e: any) {
        patchMe(p => ({ ...p, personal_gear_by_me: myPersonalGear }));
        Alert.alert('Could not update', friendlyErrorMessage(e, 'Please try again.'));
      }
    }
  };

  const removeMine = async (name: string) => {
    if (!currentUserId) return;
    const next = myPersonalGear.filter(it => it.name !== name);
    patchMe(p => ({ ...p, personal_gear_by_me: next }));
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
    } catch (e: any) {
      patchMe(p => ({ ...p, personal_gear_by_me: myPersonalGear }));
      Alert.alert('Could not remove', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  // Personal items are added directly to the member's own list — NOT a host
  // request (only shared/Group Gear items go through the host-review flow).
  const addPersonal = async (name: string) => {
    if (!currentUserId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...myPersonalGear, { name: trimmed, done: false }];
    patchMe(p => ({ ...p, personal_gear_by_me: next }));
    setAddVisible(false);
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
    } catch (e: any) {
      patchMe(p => ({ ...p, personal_gear_by_me: myPersonalGear }));
      Alert.alert('Could not add', friendlyErrorMessage(e, 'Please try again.'));
    }
  };

  const renderRow = (row: Row, isLast: boolean) => (
    <Pressable
      key={`${row.kind}-${row.name}`}
      onPress={() => toggle(row)}
      style={[styles.row, isLast && styles.rowLast]}
    >
      <View style={[styles.cb, row.done && styles.cbChecked]}>
        {row.done ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
      </View>
      <Text style={[styles.itemText, row.done && styles.itemTextDone]} numberOfLines={1}>
        {row.name}
      </Text>
      {row.kind === 'host' ? (
        <View style={styles.hostSugg}>
          <Text style={styles.hostSuggText}>Admin suggested</Text>
          <TripIcon name="award-01" size={14} color="#333333" strokeWidth={1.2} />
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => removeMine(row.name)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={`Remove ${row.name}`}
        >
          <TripIcon name="trash-01" size={20} color={T.count} strokeWidth={1} />
        </TouchableOpacity>
      )}
    </Pressable>
  );

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
            <Text style={styles.listTitle}>Your gear</Text>
            <Text style={styles.listCount}>
              {rows.length} item{rows.length === 1 ? '' : 's'} · {doneCount} done
            </Text>
          </View>

          {rows.length === 0 ? (
            <Text style={styles.empty}>No gear yet.</Text>
          ) : (
            <View style={styles.card}>
              {doneRows.map((r, i) =>
                renderRow(r, pendingRows.length === 0 && i === doneRows.length - 1)
              )}

              {/* Separator only when there are BOTH packed and to-pack items;
                  with nothing packed yet the whole list IS "don't forget". */}
              {doneRows.length > 0 && pendingRows.length > 0 ? (
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Don't forget</Text>
                  <View style={styles.dividerLine} />
                </View>
              ) : null}

              {pendingRows.map((r, i) => renderRow(r, i === pendingRows.length - 1))}
            </View>
          )}
        </ScrollView>

        {/* Sticky "+ Add item" — add a private item to your own gear list. */}
        {me ? (
          <StickyGradientFooter bottomInset={insets.bottom}>
            <TouchableOpacity
              style={styles.addBtn}
              activeOpacity={0.85}
              onPress={() => setAddVisible(true)}
              accessibilityLabel="Add an item"
            >
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Add item</Text>
            </TouchableOpacity>
          </StickyGradientFooter>
        ) : null}
      </View>

      <AddPersonalGearSheet
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        existingNames={[...hostSuggestions, ...myPersonalGear.map(it => it.name)]}
        onSubmit={addPersonal}
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

  listHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  listTitle: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, color: T.title },
  listCount: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.count },

  empty: { fontFamily: ff('Inter', '400'), fontSize: 14, color: T.count },

  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: T.hairline,
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.hairline,
  },
  rowLast: { borderBottomWidth: 0 },
  cb: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d5d7da',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cbChecked: { backgroundColor: T.accent, borderColor: T.accent },
  itemText: { flex: 1, fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.title },
  itemTextDone: { textDecorationLine: 'line-through', color: '#a0a0a0' },
  // "Host suggestion" — purple text + Figma award-01 icon (matches PlanSections).
  hostSugg: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hostSuggText: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 14, color: '#B72DF2' },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#000000' },
  dividerText: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: T.count },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 56,
    borderRadius: 12,
    backgroundColor: T.ink,
  },
  addBtnText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
  },
});
