// AdminUpdateSheet — host-only bottom sheet to post or edit a trip update.
// Custom Modal matching the Figma "Add an update" design (node 12933:37758):
// white sheet + 80x4 grabber, a megaphone-iconed title with a hairline divider,
// a pencil-iconed body field, and a dark #212121 CTA. Edit mode keeps its
// "Edit update" title and shows a trash button; add mode hides the trash.

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
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';
import { AnnouncementIcon } from '../AdminUpdateUI';
import { TripIcon } from '../tripIcons';

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  initialBody?: string;
  saving?: boolean;
  onSubmit: (body: string) => void | Promise<void>;
  /** Edit mode only — host deletes the update (parent owns the confirm). */
  onDelete?: () => void;
}

export const AdminUpdateSheet: React.FC<Props> = ({
  visible,
  onClose,
  mode,
  initialBody,
  saving,
  onSubmit,
  onDelete,
}) => {
  const [body, setBody] = useState(initialBody ?? '');

  // Reset the draft from initialBody each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setBody(initialBody ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const isEdit = mode === 'edit';
  // Add mode follows the Figma title; edit keeps the existing copy.
  const title = isEdit ? 'Edit update' : 'Add an update';
  const disabled = body.trim().length === 0 || !!saving;

  const handleSubmit = () => {
    if (disabled) return;
    onSubmit(body.trim());
  };

  const { mounted, backdropOpacity, translateY, onSheetLayout } = useSheetTransition(visible);
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kavRoot}
      >
        <Pressable style={styles.container} onPress={onClose}>
          <Animated.View
            pointerEvents="none"
            style={[styles.backdrop, { opacity: backdropOpacity }]}
          />
          <Animated.View
            style={{ transform: [{ translateY }] }}
            onLayout={onSheetLayout}
          >
            <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
            {/* Grabber */}
            <View style={styles.grabberRow}>
              <View style={styles.grabber} />
            </View>

            {/* Megaphone + title, trash (edit only) */}
            <View style={styles.titleRow}>
              <View style={styles.titleLeft}>
                <View style={styles.megaBox}>
                  <AnnouncementIcon size={18} color="#333333" />
                </View>
                <View style={styles.titleCol}>
                  <Text style={styles.title}>{title}</Text>
                </View>
              </View>
              {isEdit && onDelete ? (
                <TouchableOpacity
                  style={styles.trashBtn}
                  onPress={onDelete}
                  disabled={!!saving}
                  activeOpacity={0.7}
                  accessibilityLabel="Delete update"
                >
                  <TripIcon name="trash-01" size={22} color="#FF5367" strokeWidth={1} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Update body — pencil-iconed field */}
            <View style={styles.block}>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>Update</Text>
              </View>
              <View style={styles.field}>
                <TripIcon name="edit-02" size={20} color="#7B7B7B" strokeWidth={1.5} />
                <TextInput
                  style={styles.input}
                  value={body}
                  onChangeText={setBody}
                  multiline
                  textAlignVertical="top"
                  autoFocus
                  editable={!saving}
                  placeholder="e.g. Updated the accommodation — we booked the beachfront villa"
                  placeholderTextColor="#7B7B7B"
                />
              </View>
            </View>

            {/* Dark CTA */}
            <View style={styles.buttonsRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
                onPress={handleSubmit}
                disabled={disabled}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {isEdit ? 'Save' : 'Post update'}
                  </Text>
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

export default AdminUpdateSheet;

const styles = StyleSheet.create({
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

  // Title row — megaphone + title on the left, hairline underneath.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  megaBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCol: { flex: 1, justifyContent: 'center', gap: 4 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 20, lineHeight: 24, color: '#333333' },
  trashBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 8,
  },

  // Body field — 24 below the title, 8 between label and input.
  block: { marginTop: 24, gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', height: 24, paddingRight: 4 },
  fieldLabel: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: '#333333' },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minHeight: 56,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    padding: 0,
    textAlignVertical: 'top',
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: '#333333',
  },

  // Dark CTA.
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
  primaryBtnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#FFFFFF' },
});
