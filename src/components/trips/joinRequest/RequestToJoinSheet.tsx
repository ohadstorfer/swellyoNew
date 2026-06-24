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
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSheetTransition } from '../../../hooks/useSheetTransition';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.88;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } = useSheetTransition(visible, close);
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavRoot}
      >
      <Pressable style={styles.container} onPress={close}>
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        />
        <Animated.View
          style={{ transform: [{ translateY }] }}
          onLayout={onSheetLayout}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header} {...panHandlers}>
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
        </Animated.View>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
