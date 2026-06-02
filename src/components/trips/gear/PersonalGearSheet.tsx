// PersonalGearSheet — the "Your gear" View-All sheet.
//
// Shows the current user's full personal packing list: the host's suggested
// items (with my own done-state) and my own personal items. Presentation only —
// it never calls services, only the callbacks the parent passes in.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import { HostTag } from '../HostTag';
import type { GroupGearItem, PersonalGearItem } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  onClose: () => void;
  hostItems: string[];           // suggested item names from the host
  myHostState: GroupGearItem[];  // my done-state copies of the host items (match by name)
  myItems: PersonalGearItem[];   // my own personal items
  canEdit: boolean;              // false when trip cancelled / not a member
  onToggleHostItem: (name: string) => void;
  onTogglePersonalItem: (name: string) => void;
  onRemovePersonalItem: (name: string) => void;
  onAddPersonal: () => void;     // parent opens the add-item sheet
}

export const PersonalGearSheet: React.FC<Props> = ({
  visible,
  onClose,
  hostItems,
  myHostState,
  myItems,
  canEdit,
  onToggleHostItem,
  onTogglePersonalItem,
  onRemovePersonalItem,
  onAddPersonal,
}) => {
  const total = hostItems.length + myItems.length;
  const hostDoneCount = hostItems.filter(
    name => (myHostState.find(i => i.name === name)?.done ?? false),
  ).length;
  const personalDoneCount = myItems.filter(i => i.done).length;
  const done = hostDoneCount + personalDoneCount;

  const subtitle = `${total} ${total === 1 ? 'item' : 'items'} · ${done} packed`;

  const footer = canEdit ? (
    <TouchableOpacity style={styles.addBtn} onPress={onAddPersonal} activeOpacity={0.85}>
      <Ionicons name="add" size={18} color="#FFFFFF" />
      <Text style={styles.addBtnText}>Add item</Text>
    </TouchableOpacity>
  ) : undefined;

  return (
    <TripBottomSheet visible={visible} onClose={onClose} title="Your gear" subtitle={subtitle} footer={footer}>
      {total === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No gear yet.</Text>
          {canEdit ? <Text style={styles.emptyHint}>Tap Add item to start your list.</Text> : null}
        </View>
      ) : (
        <>
          {hostItems.length > 0 ? (
            <View>
              <Text style={styles.groupLabel}>SUGGESTED BY HOST</Text>
              {hostItems.map(name => {
                const itemDone = myHostState.find(i => i.name === name)?.done ?? false;
                return (
                  <TouchableOpacity
                    key={`host-${name}`}
                    style={styles.row}
                    activeOpacity={canEdit ? 0.6 : 1}
                    disabled={!canEdit}
                    onPress={() => onToggleHostItem(name)}
                  >
                    <Ionicons
                      name={itemDone ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={itemDone ? SHEET.done : '#B0B0B0'}
                    />
                    <Text style={[styles.itemName, itemDone && styles.itemNameDone]}>{name}</Text>
                    <HostTag />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View>
            <Text style={[styles.groupLabel, styles.groupLabelSecond]}>MY ITEMS</Text>
            {myItems.map(item => (
              <View key={`mine-${item.name}`} style={styles.row}>
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={canEdit ? 0.6 : 1}
                  disabled={!canEdit}
                  onPress={() => onTogglePersonalItem(item.name)}
                >
                  <Ionicons
                    name={item.done ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={item.done ? SHEET.done : '#B0B0B0'}
                  />
                  <Text style={[styles.itemName, item.done && styles.itemNameDone]}>{item.name}</Text>
                </TouchableOpacity>
                {canEdit ? (
                  <TouchableOpacity
                    onPress={() => onRemovePersonalItem(item.name)}
                    hitSlop={10}
                    style={styles.trashBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={SHEET.danger} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </View>
        </>
      )}
    </TripBottomSheet>
  );
};

export default PersonalGearSheet;

const styles = StyleSheet.create({
  groupLabel: {
    fontFamily: SHEET.fontBody,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: SHEET.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  groupLabelSecond: {
    marginTop: 24,
  },
  row: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: SHEET.hairline,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemName: {
    flex: 1,
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    color: SHEET.inkBody,
  },
  itemNameDone: {
    textDecorationLine: 'line-through',
    color: SHEET.textMuted,
  },
  trashBtn: {
    paddingLeft: 4,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    color: SHEET.textMuted,
  },
  emptyHint: {
    fontFamily: SHEET.fontBody,
    fontSize: 13,
    color: SHEET.textMuted,
    marginTop: 6,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: SHEET.brandTeal,
    borderRadius: 12,
    paddingVertical: 16,
  },
  addBtnText: {
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
