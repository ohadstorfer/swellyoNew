// VisibilitySheetContent — where the trip shows up. Writes group_trips.visibility.
//
// 'link_only' needs no migration: visibility is a plain text column with no
// CHECK constraint (20260525000002_group_trips_a_columns.sql:8), and every
// version of the explore_feed RPC filters `visibility IS NULL OR visibility =
// 'public'` (most recently 20260701010000_explore_feed_sort_by_participants.sql:58).
// Writing 'link_only' drops the trip out of Explore on its own — no server change.
//
// Does NOT reuse SheetOptionCard (src/components/trips/sheets/SheetOptionCard.tsx):
// its `image` prop is required (a fixed 84x84 photo thumbnail) and every current
// user of it — Levels, Boards, Vibe — picks from a photo-backed set. Visibility is
// a plain two-option text toggle with no photo to show, so bending SheetOptionCard
// into an image-less shape would mean faking an image prop it isn't built for.
// This mirrors the plain bordered-card look AgeSheetContent/SpotsSheetContent use
// for their own local, image-free option UI instead.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

const C = {
  accent: '#0788B0',
  accentTint: '#E6F4F8',
  ink: '#222B30',
  desc: '#7B7B7B',
  border: '#CFCFCF',
  surface: '#FFFFFF',
  checkboxOffBg: '#F7F7F7',
};

const OPTIONS = [
  {
    key: 'public',
    title: 'Listed in explore',
    desc: 'Anyone browsing trips can find this one.',
  },
  {
    key: 'link_only',
    title: 'Link only',
    desc: 'Only people you send the link to can see it. Travelers who already joined keep their access.',
  },
] as const;

export interface VisibilitySheetContentProps {
  value: string;
  onChange: (next: string) => void;
}

export const VisibilitySheetContent: React.FC<VisibilitySheetContentProps> = ({
  value,
  onChange,
}) => (
  <View style={styles.list}>
    {OPTIONS.map((o) => {
      const selected = value === o.key;
      return (
        <TouchableOpacity
          key={o.key}
          activeOpacity={0.85}
          onPress={() => onChange(o.key)}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={o.title}
          style={[styles.card, selected && styles.cardSelected]}
        >
          <View style={styles.textCol}>
            <Text style={[styles.title, selected && styles.titleSelected]}>{o.title}</Text>
            <Text style={styles.desc}>{o.desc}</Text>
          </View>
          <View style={[styles.checkbox, selected ? styles.checkboxOn : styles.checkboxOff]}>
            {selected ? (
              <MaterialCommunityIcons name="check-bold" size={13} color="#FFFFFF" />
            ) : null}
          </View>
        </TouchableOpacity>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  list: { gap: 12, paddingVertical: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: C.accent,
    backgroundColor: C.accentTint,
    padding: 15,
  },
  textCol: { flex: 1, gap: 4 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 15,
    color: C.ink,
  },
  titleSelected: { color: C.accent },
  desc: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: C.desc,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: C.accent },
  checkboxOff: {
    backgroundColor: C.checkboxOffBg,
    borderWidth: 1,
    borderColor: C.border,
  },
});

export default VisibilitySheetContent;
