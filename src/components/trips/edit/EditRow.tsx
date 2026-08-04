import React from 'react';
import { Text, StyleSheet, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

/**
 * One row of the Edit trip screen: the field name, an optional value, and a
 * chevron.
 *
 * Deliberately different from ProfileEditPanel's InlineField (:1363), which
 * always renders a value. Most rows here leave `value` unset, because every
 * sheet writes on its own Save (so there is no pending state a row would need
 * to show) and a trip field's value is usually a list that does not fit on one
 * line. `value` exists for the exception: a single short scalar — Price and
 * Deposit — where NOT showing it means the only way to read the current
 * number is to open the sheet. Those two rows also share one sheet, so an
 * unlabelled pair reads as two identical rows doing the same thing.
 */
export const EditRow: React.FC<{
  label: string;
  /** A short scalar (an amount, a count). Long or list-shaped values belong in
   *  the sheet, not here — this is `numberOfLines={1}` and will truncate. */
  value?: string | null;
  onPress: () => void;
  disabled?: boolean;
}> = ({ label, value, onPress, disabled = false }) => (
  <Pressable
    style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed]}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={value ? `${label}, ${value}` : label}
  >
    <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    <View style={styles.spacer} />
    {!!value && (
      <Text style={[styles.value, disabled && styles.labelDisabled]} numberOfLines={1}>
        {value}
      </Text>
    )}
    <Ionicons name="chevron-forward" size={18} color={disabled ? '#D6D6D6' : '#B0B0B0'} />
  </Pressable>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E4E4',
  },
  rowPressed: { backgroundColor: '#F6F6F6' },
  label: { fontFamily: ff('Inter', '400'), fontSize: 16, color: '#222B30' },
  labelDisabled: { color: '#B0B0B0' },
  spacer: { flex: 1 },
  // flexShrink so a long value truncates instead of pushing the chevron off
  // the row — `spacer` collapses to 0 first, then this gives way.
  value: {
    flexShrink: 1,
    marginLeft: 12,
    marginRight: 8,
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    color: '#7B7B7B',
  },
});
