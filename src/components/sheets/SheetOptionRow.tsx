// Reusable bottom-sheet action row: leading icon + label, optional destructive
// red styling. Extracted from surftrips/ParticipantMenuSheet's inline rows.
import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

export function SheetOptionRow({ icon, label, onPress, danger = false }: Props) {
  const color = danger ? '#C0392B' : '#222B30';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 20 },
  label: { fontFamily: ff('Inter', '400'), fontSize: 16, includeFontPadding: false },
});
