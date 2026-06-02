// AdminUpdateSheet — host-only bottom sheet to post or edit a trip update.
// Wraps the shared TripBottomSheet shell; no Modal/KAV of its own.

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
import { HostTag } from '../HostTag';

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  initialBody?: string;
  saving?: boolean;
  onSubmit: (body: string) => void | Promise<void>;
}

export const AdminUpdateSheet: React.FC<Props> = ({
  visible,
  onClose,
  mode,
  initialBody,
  saving,
  onSubmit,
}) => {
  const [body, setBody] = useState(initialBody ?? '');

  // Reset the draft from initialBody each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setBody(initialBody ?? '');
    }
  }, [visible]);

  const title = mode === 'add' ? 'New update' : 'Edit update';
  const disabled = body.trim().length === 0 || !!saving;

  const handleSubmit = () => {
    if (disabled) return;
    onSubmit(body.trim());
  };

  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle="Visible to everyone in the trip"
      headerRight={<HostTag />}
      footer={
        <TouchableOpacity
          style={[styles.submitBtn, disabled && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={disabled}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>
              {mode === 'add' ? 'Post update' : 'Save'}
            </Text>
          )}
        </TouchableOpacity>
      }
    >
      <View>
        <Text style={styles.label}>UPDATE</Text>
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
          autoFocus
          placeholder="e.g. Updated the accommodation — we booked the beachfront villa"
          placeholderTextColor={SHEET.textMuted}
        />
      </View>
    </TripBottomSheet>
  );
};

export default AdminUpdateSheet;

const styles = StyleSheet.create({
  label: {
    fontFamily: SHEET.fontBody,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: SHEET.textMuted,
  },
  input: {
    minHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    backgroundColor: SHEET.surfaceMuted,
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    color: SHEET.inkBody,
  },
  submitBtn: {
    width: '100%',
    backgroundColor: SHEET.brandTeal,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
