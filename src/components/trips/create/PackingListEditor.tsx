// PackingListEditor — the operator builds the "suggested packing" list while
// creating a trip. Lives inside the "Add A Packing List For Guests" card of the
// wizard's requirements step (Figma 17098:23607, Block 8).
//
// The list is what guests later see tagged "Admin suggested". It is the same
// ordered string[] ManageSuggestedGearScreen edits after publish
// (group_trips.personal_gear_host_suggestion), and it reuses that screen's
// EditGearItemSheet. Controlled: nothing is written here, the wizard keeps the
// list in its draft and writes it on publish.
//
// No drag-to-reorder: the wizard step is a ScrollView, and the full editor
// with reordering is one tap away once the trip is live.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EditGearItemSheet } from '../gear/EditGearItemSheet';
import { TripIcon } from '../tripIcons';
import { textStyle, textStyles } from '../../../theme/typography';

// The usual surf-trip kit, one tap each. Picking one adds the exact label to
// the same string[] the free-text rows write, so guests and the post-publish
// editor see no difference between a chip and a typed item.
export const COMMON_PACKING_ITEMS = [
  'Surf wax',
  'Reef-safe sunscreen',
  'Rash guard',
  'Wetsuit',
  'Leash',
  'Fins',
  'Reef booties',
  'Board bag',
  'Ding repair kit',
  'Sun hat',
  'Reusable water bottle',
  'Beach towel',
] as const;

const COMMON_SET = new Set<string>(COMMON_PACKING_ITEMS.map(n => n.toLowerCase()));

type Sheet = { mode: 'add' } | { mode: 'edit'; index: number } | null;

export interface PackingListEditorProps {
  items: string[];
  onChange: (next: string[]) => void;
}

export const PackingListEditor: React.FC<PackingListEditorProps> = ({ items, onChange }) => {
  const [sheet, setSheet] = useState<Sheet>(null);

  const handleSubmit = (name: string) => {
    onChange(
      sheet?.mode === 'edit'
        ? items.map((n, i) => (i === sheet.index ? name : n))
        : [...items, name],
    );
    setSheet(null);
  };

  const handleDelete = () => {
    if (sheet?.mode !== 'edit') return;
    const idx = sheet.index;
    onChange(items.filter((_, i) => i !== idx));
    setSheet(null);
  };

  const has = (label: string) => items.some(n => n.toLowerCase() === label.toLowerCase());
  const toggleCommon = (label: string) => {
    onChange(
      has(label)
        ? items.filter(n => n.toLowerCase() !== label.toLowerCase())
        : [...items, label],
    );
  };

  // Names already used (minus the one being edited) for the sheet's dedupe.
  const existingNames =
    sheet?.mode === 'edit' ? items.filter((_, i) => i !== sheet.index) : items;

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Packing list</Text>
        <Text style={styles.count}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.chips}>
        {COMMON_PACKING_ITEMS.map(label => {
          const on = has(label);
          return (
            <Pressable
              key={label}
              onPress={() => toggleCommon(label)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={label}
              hitSlop={4}
              style={({ pressed }) => [
                styles.chip,
                on && styles.chipOn,
                pressed && styles.chipPressed,
              ]}
            >
              {on ? <Ionicons name="checkmark" size={14} color={ACCENT} /> : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Typed items (anything not in the chips above) stay editable rows. */}
      {items.map((name, index) => COMMON_SET.has(name.toLowerCase()) ? null : (
        <Pressable
          key={name}
          onPress={() => setSheet({ mode: 'edit', index })}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name}`}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
        >
          <Text style={styles.itemName} numberOfLines={2}>
            {name}
          </Text>
          {/* edit-02's viewBox is 12.27, so 0.85 lands near a 1.2px stroke. */}
          <TripIcon name="edit-02" size={16} color="#333333" strokeWidth={0.85} />
        </Pressable>
      ))}

      <Pressable
        onPress={() => setSheet({ mode: 'add' })}
        accessibilityRole="button"
        accessibilityLabel="Add an item to the packing list"
        style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
      >
        <Text style={styles.addText}>+ Add your own</Text>
      </Pressable>

      <Text style={styles.hint}>
        Guests see these on their packing list, tagged “Admin suggested”.
      </Text>

      {/* A Modal of its own, rendered INSIDE the wizard's Modal tree — a
          sibling of that Modal would never receive touches on iOS. */}
      <EditGearItemSheet
        visible={sheet !== null}
        mode={sheet?.mode === 'edit' ? 'edit' : 'add'}
        initialName={sheet?.mode === 'edit' ? items[sheet.index] ?? '' : ''}
        existingNames={existingNames}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
        onClose={() => setSheet(null)}
      />
    </View>
  );
};

const ACCENT = '#05BCD3';

const styles = StyleSheet.create({
  root: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  chipOn: { borderColor: ACCENT, backgroundColor: '#EAF9FB' },
  // Press feedback only; selection itself is instant (picked many times in a row).
  chipPressed: { transform: [{ scale: 0.97 }] },
  chipText: { ...textStyles.B3, color: '#333333' },
  chipTextOn: { ...textStyle('B3', '700'), color: '#333333' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  headerLabel: { ...textStyle('B3', '700'), color: '#333333' },
  count: { ...textStyles.B3, color: '#7B7B7B' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  itemName: { flex: 1, ...textStyle('MB2', '700'), color: '#333333' },
  addBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  // Same press feedback as the waiver "Upload PDF" button in this card stack.
  pressed: { backgroundColor: '#F6F6F6', transform: [{ scale: 0.985 }] },
  addText: { ...textStyle('MB2', '700'), color: '#333333' },
  hint: { ...textStyles.B3, color: '#7B7B7B' },
});

export default PackingListEditor;
