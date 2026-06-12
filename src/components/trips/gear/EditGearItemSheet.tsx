// EditGearItemSheet — bottom sheet to add or edit a single suggested-gear name.
// Opened from the full-screen ManageSuggestedGearScreen (Figma node 12933-36734).
// The sheet only edits a NAME string; the parent screen owns the list + Save.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';

const MAX_LEN = 21;

interface Props {
  visible: boolean;
  mode: 'add' | 'edit';
  initialName?: string;
  /** Other names already on the list (case-insensitive duplicate guard). */
  existingNames: string[];
  onSubmit: (name: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export const EditGearItemSheet: React.FC<Props> = ({
  visible,
  mode,
  initialName = '',
  existingNames,
  onSubmit,
  onDelete,
  onClose,
}) => {
  const isAdd = mode === 'add';
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');

  // Re-seed the field each time the sheet opens / target changes.
  useEffect(() => {
    if (visible) {
      setName(initialName);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialName]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter an item name.');
      return;
    }
    const lower = trimmed.toLowerCase();
    if (existingNames.some(n => n.trim().toLowerCase() === lower)) {
      setError('That item is already on the list.');
      return;
    }
    onSubmit(trimmed);
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
            <View style={styles.grabberWrap}>
              <View style={styles.grabber} />
            </View>

            {/* Title row + trash (edit only) */}
            <View style={styles.titleRow}>
              <View style={styles.titleCol}>
                <Text style={styles.title}>{isAdd ? 'Add Gear' : 'Edit Gear'}</Text>
                {!isAdd && initialName ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {initialName}
                  </Text>
                ) : null}
              </View>
              {!isAdd && onDelete ? (
                <TouchableOpacity
                  style={styles.trashBtn}
                  onPress={onDelete}
                  activeOpacity={0.7}
                  accessibilityLabel="Remove item"
                >
                  <TripIcon name="trash-01" size={22} color="#FF5367" strokeWidth={1} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Name label + counter */}
            <View style={styles.labelRow}>
              <Text style={styles.nameLabel}>Name</Text>
              <Text style={styles.counter}>
                {name.length} /{MAX_LEN}
              </Text>
            </View>

            <TextInput
              style={styles.input}
              value={name}
              onChangeText={t => {
                setName(t);
                if (error) setError('');
              }}
              placeholder="e.g. Wax, sunscreen, reef booties"
              placeholderTextColor="#9CA3AF"
              maxLength={MAX_LEN}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Update / Add */}
            <View style={styles.buttonsRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>{isAdd ? 'Add' : 'Update'}</Text>
              </TouchableOpacity>
            </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default EditGearItemSheet;

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
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: '#7B7B7B' },

  // Title row (border-bottom hairline)
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleCol: { flex: 1, gap: 4 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 20, lineHeight: 24, color: '#333333' },
  subtitle: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: '#4A5565' },
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

  // Name label + counter
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 8,
  },
  nameLabel: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: '#333333' },
  counter: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#7B7B7B' },

  input: {
    height: 56,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#333333',
  },
  errorText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#C0392B', marginTop: 8 },

  // Update button
  buttonsRow: { flexDirection: 'row', paddingTop: 24, paddingHorizontal: 16 },
  primaryBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#212121',
  },
  primaryBtnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#FFFFFF' },
});
