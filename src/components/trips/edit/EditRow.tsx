import React from 'react';
import { Text, StyleSheet, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

/**
 * One row of the Edit trip screen: the field name and a chevron. No value.
 *
 * Deliberately different from ProfileEditPanel's InlineField (:1363), which
 * renders a value too. Values are left out here because every sheet writes on
 * its own Save, so there is no pending state a row would need to show, and a
 * trip field's value is usually a list that does not fit on one line.
 */
export const EditRow: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
}> = ({ label, onPress, disabled = false }) => (
  <Pressable
    style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed]}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    <View style={styles.spacer} />
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
});
