// "Request item" sheet — a member asks the host to add a shared gear item to the
// trip (Figma node 12919-12792). The host reviews the request and, on approval,
// it becomes a Group Gear item. No quantity here — the host sets the needed
// quantity at approval time. The item name is capped at 21 chars to match the
// design's counter, plus an optional short "why" note for the host.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';

const NAME_MAX = 21;
const NOTE_MAX = 80;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (itemName: string, note: string) => Promise<void>;
}

export const RequestGearSheet: React.FC<Props> = ({ visible, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);

  // Open with the keyboard already up + cursor in the first field. The delay
  // lets the sheet mount/lay out so the keyboard rises with it.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => nameRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [visible]);

  const close = () => {
    setName('');
    setNote('');
    onClose();
  };

  const handleSubmit = async () => {
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

  const disabled = !name.trim() || submitting;

  return (
    <TripBottomSheet
      visible={visible}
      onClose={close}
      title="Suggest item"
      subtitle="Admin will review your suggestion"
      hideClose
      footerDivider={false}
      footer={
        <TouchableOpacity
          style={[styles.submit, disabled && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={disabled}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>Suggest</Text>
          )}
        </TouchableOpacity>
      }
    >
      {/* What do we need? — the item name (becomes the Group Gear item on approval). */}
      <View style={[styles.labelRow, styles.firstLabelRow]}>
        <Text style={styles.label}>What do we need?</Text>
        <Text style={styles.counter}>
          {name.length} /{NAME_MAX}
        </Text>
      </View>
      <View style={styles.field}>
        <TripIcon name="edit-03" size={24} color="#333333" />
        <TextInput
          ref={nameRef}
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Portable speaker, Beach towels..."
          placeholderTextColor={SHEET.textMuted}
          maxLength={NAME_MAX}
          editable={!submitting}
          returnKeyType="next"
          onSubmitEditing={() => noteRef.current?.focus()}
        />
      </View>

      {/* Why? (optional) — a short note the host sees when reviewing the request. */}
      <View style={styles.labelRow}>
        <Text style={styles.label}>Why? (optional)</Text>
        <Text style={styles.counter}>
          {note.length} /{NOTE_MAX}
        </Text>
      </View>
      <View style={styles.field}>
        <TripIcon name="edit-03" size={24} color="#333333" />
        <TextInput
          ref={noteRef}
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Add a note to help the admin decide..."
          placeholderTextColor={SHEET.textMuted}
          maxLength={NOTE_MAX}
          editable={!submitting}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
      </View>
    </TripBottomSheet>
  );
};

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24, // 24px gap between field blocks (Figma: gap-24)
  },
  // Extra top breathing room under the sheet title, matching our other sheets
  // (body pads 18 + 12 ≈ 30 to the first label).
  firstLabelRow: { marginTop: 12 },
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
    // Small vertical padding so descenders (g, y, p) aren't clipped. The field
    // is a fixed 56px row with the input centered, so this won't grow the field.
    paddingVertical: 6,
    // Pin alignment LTR so the placeholder / text doesn't jump to the right when
    // the user switches to an RTL keyboard (e.g. Hebrew).
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  // Matches the create-trip / commitment "Select" footer button — dark pill,
  // 62 tall, radius 16, with 22px side margins (footer pads 18 → 40 total inset).
  submit: {
    height: 62,
    borderRadius: 16,
    marginHorizontal: 22,
    backgroundColor: SHEET.inkDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.35 },
  submitText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 24,
    color: '#FFFFFF',
  },
});

export default RequestGearSheet;
