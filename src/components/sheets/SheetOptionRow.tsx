// Reusable bottom-sheet action row: leading icon + label, optional destructive
// red styling. Extracted from surftrips/ParticipantMenuSheet's inline rows.
import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../theme/fonts';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** Scale-down (0.97) press feedback instead of the default opacity dim.
   *  Opt-in — most rows keep the original dim-on-press feel; use this for a
   *  row that reads more like a distinct action (e.g. opening another sheet). */
  pressScale?: boolean;
}

export function SheetOptionRow({ icon, label, onPress, danger = false, pressScale = false }: Props) {
  const color = danger ? '#C0392B' : '#222B30';
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && (pressScale ? styles.pressedScale : styles.pressedDim),
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 20 },
  label: { fontFamily: ff('Inter', '400'), fontSize: 16, includeFontPadding: false },
  // Matches the old TouchableOpacity's activeOpacity={0.7}.
  pressedDim: { opacity: 0.7 },
  pressedScale: { transform: [{ scale: 0.97 }] },
});
