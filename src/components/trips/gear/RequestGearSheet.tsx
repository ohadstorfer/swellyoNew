import React, { useState } from 'react';
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

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.88;
import { Ionicons } from '@expo/vector-icons';

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Request item</Text>
              <Text style={styles.subtitle}>Host will review your request</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={close} hitSlop={8}>
              <Ionicons name="close" size={18} color="#222B30" />
            </TouchableOpacity>
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
              <Text style={styles.label}>WHAT DO WE NEED?</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Portable speaker, Beach towels..."
                placeholderTextColor="#9AA0A6"
                autoFocus
                editable={!submitting}
              />

              <Text style={[styles.label, { marginTop: 16 }]}>WHY? (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={note}
                onChangeText={setNote}
                placeholder="Add a note to help the host decide..."
                placeholderTextColor="#9AA0A6"
                multiline
                editable={!submitting}
              />
            </ScrollView>

            <View style={styles.footer}>
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222B30' },
  subtitle: { fontSize: 13, color: '#7B7B7B', marginTop: 2 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16 },
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
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  send: {
    backgroundColor: '#0788B0',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  sendDisabled: { opacity: 0.35 },
  sendText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
