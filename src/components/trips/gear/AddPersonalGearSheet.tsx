// AddPersonalGearSheet — lets a user add a private item to their personal gear list.
//
// Uses the shared TripBottomSheet shell (Modal + keyboard avoidance handled there).
// This sheet only describes its body (a single labelled text input) and footer
// (the primary "Add" action). Duplicate checking is case-insensitive against the
// user's existing combined gear list.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  existingNames?: string[]; // names already on the user's combined gear list (for case-insensitive dupe check)
  saving?: boolean;
  onSubmit: (name: string) => void | Promise<void>;
}

export const AddPersonalGearSheet: React.FC<Props> = ({
  visible,
  onClose,
  existingNames = [],
  saving = false,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // Reset input + error each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setName('');
      setError('');
    }
  }, [visible]);

  const handleChangeText = (text: string) => {
    setName(text);
    if (error) setError('');
  };

  const attemptAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const isDupe = existingNames.some(
      n => n.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDupe) {
      setError('Already on your list');
      return;
    }
    onSubmit(trimmed);
  };

  const disabled = name.trim().length === 0 || saving;

  const footer = (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={attemptAdd}
      disabled={disabled}
      activeOpacity={0.85}
    >
      {saving ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.buttonText}>Add</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title="Add to my gear"
      subtitle="Only you see your personal items"
      footer={footer}
    >
      <Text style={styles.label}>ITEM</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={handleChangeText}
        placeholder="e.g. Passport, phone charger"
        placeholderTextColor={SHEET.textMuted}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={attemptAdd}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </TripBottomSheet>
  );
};

export default AddPersonalGearSheet;

const styles = StyleSheet.create({
  label: {
    fontFamily: SHEET.fontBody,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: SHEET.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    marginTop: 8,
    backgroundColor: SHEET.surfaceMuted,
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    color: SHEET.inkBody,
  },
  error: {
    color: SHEET.danger,
    fontSize: 12,
    marginTop: 6,
    fontFamily: SHEET.fontBody,
  },
  button: {
    width: '100%',
    backgroundColor: SHEET.brandTeal,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    fontWeight: '700',
  },
});
