// JoinModeSheetContent — how travelers get onto an operator trip.
// Writes group_trips.join_mode (migration 20261111000000).
//
// Same two choices and copy as the create wizard's "Who can join" block in
// CreateTripFlowA's pricing step. Card look matches GettingPaidSheetContent.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

export type JoinMode = 'approval' | 'instant';

const C = {
  accent: '#0788B0',
  accentTint: '#E6F4F8',
  ink: '#222B30',
  desc: '#7B7B7B',
  border: '#CFCFCF',
  surface: '#FFFFFF',
  checkboxOffBg: '#F7F7F7',
};

export const JOIN_MODE_OPTIONS: { key: JoinMode; title: string; desc: string }[] = [
  {
    key: 'approval',
    title: 'I approve each traveler',
    desc: 'Travelers send a request. They pay after you approve them.',
  },
  {
    key: 'instant',
    title: 'Anyone can join right away',
    desc: 'No request. Travelers join and go straight to checkout.',
  },
];

export const JoinModeSheetContent: React.FC<{
  value: JoinMode;
  onChange: (next: JoinMode) => void;
}> = ({ value, onChange }) => (
  <View style={styles.list}>
    {JOIN_MODE_OPTIONS.map((o) => {
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
    <Text style={styles.footnote}>
      Requests already waiting stay waiting. Approve or decline them as usual.
    </Text>
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
  title: { fontFamily: ff('Inter', '700'), fontSize: 15, color: C.ink },
  titleSelected: { color: C.accent },
  desc: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: C.desc },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: C.accent },
  checkboxOff: { backgroundColor: C.checkboxOffBg, borderWidth: 1, borderColor: C.border },
  footnote: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 17, color: C.desc },
});

export default JoinModeSheetContent;
