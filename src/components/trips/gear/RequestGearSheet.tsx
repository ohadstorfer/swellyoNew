import React, { useState } from 'react';
import {
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (itemName: string, note: string) => Promise<void>;
}

export const RequestGearSheet: React.FC<Props> = ({ visible, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setName('');
    setNote('');
    onClose();
  };

  const handleSend = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), note.trim());
      setName('');
      setNote('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TripBottomSheet
      visible={visible}
      onClose={close}
      title="Request item"
      subtitle="The host will review your request"
      footer={
        <TouchableOpacity
          style={[styles.send, (!name.trim() || submitting) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!name.trim() || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.sendText}>Send to host</Text>
          )}
        </TouchableOpacity>
      }
    >
      <Text style={styles.label}>WHAT DO WE NEED?</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Portable speaker, Beach towels..."
        placeholderTextColor={SHEET.textMuted}
        autoFocus
        editable={!submitting}
      />

      <Text style={[styles.label, { marginTop: 16 }]}>WHY? (OPTIONAL)</Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        value={note}
        onChangeText={setNote}
        placeholder="Add a note to help the host decide..."
        placeholderTextColor={SHEET.textMuted}
        multiline
        editable={!submitting}
      />
    </TripBottomSheet>
  );
};

const styles = StyleSheet.create({
  label: {
    fontFamily: SHEET.fontBody,
    fontSize: 11,
    fontWeight: '700',
    color: SHEET.textMuted,
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 6,
    fontSize: 14,
    fontFamily: SHEET.fontBody,
    color: SHEET.inkBody,
    backgroundColor: SHEET.surfaceMuted,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  send: {
    backgroundColor: SHEET.brandTeal,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  sendDisabled: { opacity: 0.35 },
  sendText: {
    fontFamily: SHEET.fontBody,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});

export default RequestGearSheet;
