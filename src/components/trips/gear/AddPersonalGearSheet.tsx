// AddPersonalGearSheet — lets a user add a private item to their personal gear list.
//
// Matches the other gear bottom sheets (ManageGearSheet "Add item", AdminUpdateSheet):
// a custom Modal with a grabber, a title/subtitle row over a hairline, a single
// labelled input, and a dark #212121 primary action. Motion is the shared sheet
// transition — the backdrop FADES while the sheet SLIDES up (useSheetTransition).
// Duplicate checking is case-insensitive against the user's existing gear list.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';
import { TripIcon } from '../tripIcons';

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

  // Fade the backdrop, slide the sheet (matches the other bottom sheets).
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } = useSheetTransition(visible, onClose);
  // Android: pad past the system nav/gesture bar (iOS keeps the static 24).
  const insets = useSafeAreaInsets();

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
    if (!trimmed || saving) return;
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

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kavRoot}
      >
        <Pressable style={s.container} onPress={onClose}>
          <Animated.View pointerEvents="none" style={[s.backdrop, { opacity: backdropOpacity }]} />
          <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
            <Pressable
              style={[s.sheet, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 24) }]}
              onPress={e => e.stopPropagation()}
            >
              {/* Grabber */}
              <View style={s.grabberRow} {...panHandlers}>
                <View style={s.grabber} />
              </View>

              {/* Title + subtitle, hairline underneath. */}
              <View style={s.titleRow}>
                <View style={s.titleCol}>
                  <Text style={s.title}>Add to my gear</Text>
                  <Text style={s.subtitle}>Only you see your personal items</Text>
                </View>
              </View>

              {/* Item field */}
              <View style={s.block}>
                <Text style={s.fieldLabel}>Item</Text>
                <View style={s.field}>
                  <TripIcon name="edit-03" size={20} color="#333333" />
                  <TextInput
                    style={s.input}
                    value={name}
                    onChangeText={handleChangeText}
                    placeholder="e.g. Passport, phone charger"
                    placeholderTextColor="#9CA3AF"
                    autoFocus
                    editable={!saving}
                    returnKeyType="done"
                    onSubmitEditing={attemptAdd}
                  />
                </View>
                {error ? <Text style={s.error}>{error}</Text> : null}
              </View>

              {/* Dark CTA */}
              <View style={s.buttonsRow}>
                <TouchableOpacity
                  style={[s.primaryBtn, disabled && s.primaryBtnDisabled]}
                  onPress={attemptAdd}
                  disabled={disabled}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={s.primaryBtnText}>Add</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default AddPersonalGearSheet;

// Mirrors ManageGearSheet's "Add item" sheet (Figma 12919:32232) so the two read
// as the same component.
const s = StyleSheet.create({
  kavRoot: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(33,33,33,0.7)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 2,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  grabberRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: '#7B7B7B' },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleCol: { flex: 1, justifyContent: 'center', gap: 4, paddingBottom: 16 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 24, color: '#333333' },
  subtitle: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: '#4A5565' },

  block: { marginTop: 24, gap: 8 },
  fieldLabel: { fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 24, color: '#333333' },
  // Icon + input row (mirrors RequestGearSheet's field).
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#333333',
    // Strip the default min height so the 56px field height holds on Android.
    paddingVertical: 0,
  },
  error: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#FF5367' },

  buttonsRow: { flexDirection: 'row', marginTop: 24, paddingTop: 8, paddingHorizontal: 16 },
  primaryBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#212121',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, lineHeight: 24, color: '#FFFFFF' },
});
