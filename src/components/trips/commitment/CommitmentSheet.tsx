import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CommitmentItem } from '../../../services/trips/groupTripsService';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.88;

interface Option {
  key: CommitmentItem;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const OPTIONS: Option[] = [
  { key: 'flight_booked', label: 'Flight booked', icon: 'airplane-outline' },
  { key: 'insurance_sorted', label: 'Insurance sorted', icon: 'shield-checkmark-outline' },
  { key: 'something_else', label: 'Something else', icon: 'ellipsis-horizontal' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** If the member is re-submitting, prefill with their last submission. */
  initialItems?: string[];
  initialNote?: string | null;
  onSubmit: (items: CommitmentItem[], note: string) => Promise<void>;
}

export const CommitmentSheet: React.FC<Props> = ({
  visible,
  onClose,
  initialItems,
  initialNote,
  onSubmit,
}) => {
  const [selected, setSelected] = useState<Set<CommitmentItem>>(new Set());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      const seed = new Set<CommitmentItem>();
      (initialItems ?? []).forEach((it) => {
        if (OPTIONS.some((o) => o.key === it)) seed.add(it as CommitmentItem);
      });
      setSelected(seed);
      setNote(initialNote ?? '');
    }
  }, [visible, initialItems, initialNote]);

  const toggle = (k: CommitmentItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const canSubmit = selected.size > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(Array.from(selected), note.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeBtn} onPress={close} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color="#222B30" />
            </TouchableOpacity>
            <Text style={styles.title}>Commitment</Text>
            <View style={styles.closeBtn} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
            keyboardVerticalOffset={0}
          >
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.heading}>How are you committed?</Text>
              <Text style={styles.sub}>Let the host know your status</Text>

              <View style={styles.warningBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#7A5C00" />
                <Text style={styles.warningText}>
                  Only commit if you&rsquo;re sure. Other people are counting on you — pulling out
                  late affects the whole group.
                </Text>
              </View>

              <View style={styles.options}>
                {OPTIONS.map((opt) => {
                  const isOn = selected.has(opt.key);
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.option, isOn && styles.optionOn]}
                      onPress={() => toggle(opt.key)}
                      disabled={submitting}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.check, isOn && styles.checkOn]}>
                        {isOn ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                      </View>
                      <Ionicons
                        name={opt.icon}
                        size={18}
                        color={isOn ? '#0788B0' : '#4A5565'}
                        style={styles.optionIcon}
                      />
                      <Text style={[styles.optionLabel, isOn && styles.optionLabelOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.label, { marginTop: 18 }]}>ADD NOTE (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={note}
                onChangeText={setNote}
                placeholder="Any details you want to share..."
                placeholderTextColor="#9AA0A6"
                multiline
                editable={!submitting}
              />
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.submit, !canSubmit && styles.submitDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: SHEET_MAX_HEIGHT,
    width: '100%',
  },
  flex: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#222B30' },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  heading: { fontSize: 17, fontWeight: '700', color: '#222B30' },
  sub: { fontSize: 13, color: '#7B7B7B', marginTop: 2 },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF7E0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 14,
    alignItems: 'flex-start',
  },
  warningText: { flex: 1, fontSize: 12.5, color: '#7A5C00', lineHeight: 17 },
  options: { marginTop: 14, gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  optionOn: {
    borderColor: '#0788B0',
    backgroundColor: 'rgba(7,136,176,0.06)',
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#9AA0A6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: '#0788B0', backgroundColor: '#0788B0' },
  optionIcon: { marginLeft: 12 },
  optionLabel: { fontSize: 14.5, color: '#222B30', marginLeft: 10 },
  optionLabelOn: { color: '#0788B0', fontWeight: '600' },
  label: { fontSize: 11, fontWeight: '700', color: '#4A5565', letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 6,
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FAFAFA',
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  submit: {
    backgroundColor: '#222B30',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
