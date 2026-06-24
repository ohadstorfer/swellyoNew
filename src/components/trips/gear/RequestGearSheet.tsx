// "Add item" sheet — a member asks the host to add a shared gear item to the
// trip (Figma node 12919-13316). The host reviews the request and, on approval,
// it becomes a Group Gear item. Name only (the host sets the needed quantity at
// approval time), capped at 21 chars to match the design's counter.

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';

const NAME_MAX = 21;
const NOTE_MAX = 200;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (itemName: string, note: string, neededQty: number) => Promise<void>;
}

export const RequestGearSheet: React.FC<Props> = ({ visible, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setName('');
    setNote('');
    setQty(1);
    onClose();
  };

  const handleAdd = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), note.trim(), qty);
      setName('');
      setNote('');
      setQty(1);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = !name.trim() || submitting;

  return (
    <TripBottomSheet
      visible={visible}
      onClose={close}
      title="Suggest item"
      subtitle="Host will review your suggestion"
      footerDivider={false}
      footer={
        <TouchableOpacity
          style={[styles.add, disabled && styles.addDisabled]}
          onPress={handleAdd}
          disabled={disabled}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.addText}>Add</Text>
          )}
        </TouchableOpacity>
      }
    >
      <View style={styles.labelRow}>
        <Text style={styles.label}>What do we need?</Text>
        <Text style={styles.counter}>
          {name.length} /{NAME_MAX}
        </Text>
      </View>
      <View style={styles.field}>
        <TripIcon name="edit-03" size={24} color="#333333" />
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Portable speaker, Beach towels..."
          placeholderTextColor={SHEET.textMuted}
          maxLength={NAME_MAX}
          autoFocus
          editable={!submitting}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
      </View>

      {/* Why is this needed? — optional note the host sees when reviewing. */}
      <Text style={styles.whyLabel}>Why is this needed?</Text>
      <View style={styles.noteField}>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder="Any details you want to share..."
          placeholderTextColor={SHEET.textMuted}
          maxLength={NOTE_MAX}
          multiline
          editable={!submitting}
          textAlignVertical="top"
        />
      </View>

      <Text style={styles.qtyLabel}>How many needed?</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => setQty(q => Math.max(1, q - 1))}
          disabled={qty <= 1 || submitting}
          accessibilityLabel="Decrease quantity"
        >
          <Ionicons name="remove" size={22} color={qty <= 1 ? SHEET.textMuted : '#333333'} />
        </TouchableOpacity>
        <View style={styles.stepValue}>
          <Text style={styles.stepValueText}>{qty}</Text>
        </View>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => setQty(q => q + 1)}
          disabled={submitting}
          accessibilityLabel="Increase quantity"
        >
          <Ionicons name="add" size={22} color="#333333" />
        </TouchableOpacity>
      </View>
    </TripBottomSheet>
  );
};

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16, // more breathing room above the first label
  },
  label: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
  },
  counter: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: SHEET.textMuted,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    marginTop: 8, // tight to its label (Figma: 8px label→input)
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    borderRadius: 12,
    backgroundColor: SHEET.surface,
  },
  input: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: SHEET.inkBody,
    // Strip the default min height so the 56px field height holds on Android.
    paddingVertical: 0,
  },
  whyLabel: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
    marginTop: 24, // gap below the item input
  },
  noteField: {
    minHeight: 88,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    borderRadius: 12,
    backgroundColor: SHEET.surface,
  },
  noteInput: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: SHEET.inkBody,
    paddingVertical: 0,
  },
  qtyLabel: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: '#333333',
    marginTop: 24, // gap below the note field
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8, // tight to its label (Figma: 8px label→stepper)
    marginBottom: 12, // more gap below the quantity input (before Add)
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    backgroundColor: SHEET.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    backgroundColor: SHEET.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValueText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 16,
    color: '#333333',
  },
  add: {
    height: 56,
    borderRadius: 12,
    backgroundColor: SHEET.inkDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDisabled: { opacity: 0.35 },
  addText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
  },
});

export default RequestGearSheet;
