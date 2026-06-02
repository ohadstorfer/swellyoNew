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
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.88;

const SURF_LEVEL_LABEL: Record<string, string> = {
  beginner: 'Beginner surfer',
  intermediate: 'Intermediate surfer',
  advanced: 'Advanced surfer',
  pro: 'Pro surfer',
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Lightweight profile preview shown at the top of the sheet. */
  profile: {
    name: string | null;
    avatarUrl: string | null;
    surfLevel: string | null;
  } | null;
  onSubmit: (note: string) => Promise<void>;
}

export const RequestToJoinSheet: React.FC<Props> = ({
  visible,
  onClose,
  profile,
  onSubmit,
}) => {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const handleSend = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(note.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const levelLabel = profile?.surfLevel
    ? SURF_LEVEL_LABEL[profile.surfLevel] ?? `${profile.surfLevel} surfer`
    : 'Surfer';
  const displayName = profile?.name?.trim() || 'You';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavRoot}
      >
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeBtn} onPress={close} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color="#222B30" />
            </TouchableOpacity>
            <Text style={styles.title}>Join Trip</Text>
            <View style={styles.closeBtn} />
          </View>

          <>
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.profileCard}>
                <Text style={styles.profileLabel}>Your profile</Text>
                <View style={styles.profileRow}>
                  {profile?.avatarUrl ? (
                    <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Text style={styles.avatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={styles.profileText}>
                    <Text style={styles.profileName}>{displayName}</Text>
                    <Text style={styles.profileSub}>{levelLabel}</Text>
                  </View>
                </View>
              </View>

              <Text style={[styles.label, { marginTop: 18 }]}>
                Anything you want to tell the host?
              </Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={note}
                onChangeText={setNote}
                placeholder="Ask anything before joining..."
                placeholderTextColor="#9AA0A6"
                multiline
                editable={!submitting}
                autoFocus
              />
              <Text style={styles.caption}>
                This helps the host understand your vibe and experience level.
              </Text>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.submit, submitting && styles.submitDisabled]}
                onPress={handleSend}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitText}>Send Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
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
  kavRoot: { flex: 1 },
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
  profileCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FAFAFA',
  },
  profileLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5565',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E5E7EB' },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: '#4A5565' },
  profileText: { flex: 1 },
  profileName: { fontSize: 15, fontWeight: '700', color: '#222B30' },
  profileSub: { fontSize: 13, color: '#7B7B7B', marginTop: 2 },
  label: { fontSize: 13.5, fontWeight: '700', color: '#222B30' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 8,
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FAFAFA',
  },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top' },
  caption: {
    fontSize: 12,
    color: '#7B7B7B',
    marginTop: 8,
  },
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
