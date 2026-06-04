// Host-only inline edit sheets for the trip Overview (Figma "admin view").
// Each sheet edits exactly one field with a focused, keyboard-aware UX:
//   • EditTextSheet  — multiline text (trip description, host self-intro).
//   • EditCoverSheet — the trip cover photo (pick → preview → save).
//
// All three are opened from the "Edit" pills in TripDetailViewRedesigned and
// persist via the parent's onSave handler (which calls updateGroupTrip).
// Built on WizardBottomSheet so they inherit the drag-to-dismiss + keyboard
// anchoring used across the create-trip wizard.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WizardBottomSheet } from './WizardBottomSheet';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  accent: '#0788B0',
  ink: '#333333',
  textMuted: '#7B7B7B',
  textFaint: '#A0A0A0',
  border: '#E1E1E1',
  surfaceMuted: '#F7F7F7',
  white: '#FFFFFF',
  danger: '#C0392B',
};

// Shared image picker (mirrors CreateTripFlowA — kept inline to avoid coupling
// to the wizard screen). Returns a local file URI, or null on cancel/deny.
const pickImageUri = async (aspect: [number, number] = [12, 5]): Promise<string | null> => {
  try {
    const ImagePicker = require('expo-image-picker');
    const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
    if (!usePhotoPicker) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'We need photo library access to pick an image.');
        return null;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect,
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      return result.assets[0].uri as string;
    }
  } catch (e) {
    console.error('[TripEditSheets] pickImage error:', e);
  }
  return null;
};

// ---------------------------------------------------------------------------
const SaveButton: React.FC<{ onPress: () => void; loading?: boolean; disabled?: boolean; label?: string }> = ({
  onPress,
  loading,
  disabled,
  label = 'Save',
}) => (
  <TouchableOpacity
    style={[styles.saveBtn, (disabled || loading) && styles.saveBtnDisabled]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.85}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    {loading ? (
      <ActivityIndicator color={C.white} />
    ) : (
      <Text style={styles.saveBtnText}>{label}</Text>
    )}
  </TouchableOpacity>
);

// ---------------------------------------------------------------------------
// EditTextSheet — one multiline text field with optional char counter.
// ---------------------------------------------------------------------------
export interface EditTextSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  maxLength?: number;
  /** Approx. visible rows (sets minHeight). Default 6. */
  rows?: number;
  onClose: () => void;
  /** Persist the trimmed value. May be async; the Save button shows a spinner. */
  onSave: (value: string) => void | Promise<void>;
}

export const EditTextSheet: React.FC<EditTextSheetProps> = ({
  visible,
  title,
  subtitle,
  label,
  initialValue,
  placeholder,
  maxLength,
  rows = 6,
  onClose,
  onSave,
}) => {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  // Reset the draft each time the sheet opens so a cancelled edit doesn't leak
  // into the next open.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const handleSave = async () => {
    const next = value.trim();
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } catch {
      // onSave surfaces its own error alert; keep the sheet open to retry.
    } finally {
      setSaving(false);
    }
  };

  const dirty = value.trim() !== initialValue.trim();

  return (
    <WizardBottomSheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      heightMode="auto"
      extendBehindKeyboard
      footer={<SaveButton onPress={handleSave} loading={saving} disabled={!dirty} />}
    >
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {maxLength ? (
          <Text
            style={[
              styles.counter,
              { color: value.length >= maxLength ? C.danger : C.textMuted },
            ]}
          >
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
      <TextInput
        style={[styles.input, { minHeight: rows * 22 }]}
        value={value}
        onChangeText={t => setValue(maxLength ? t.slice(0, maxLength) : t)}
        placeholder={placeholder}
        placeholderTextColor={C.textFaint}
        multiline
        maxLength={maxLength}
        textAlignVertical="top"
        autoFocus
      />
    </WizardBottomSheet>
  );
};

// ---------------------------------------------------------------------------
// EditCoverSheet — pick a new cover photo, preview, then save.
// ---------------------------------------------------------------------------
export interface EditCoverSheetProps {
  visible: boolean;
  currentUri: string | null;
  onClose: () => void;
  /** Receives the picked LOCAL uri to upload + persist. May be async. */
  onSave: (localUri: string) => void | Promise<void>;
}

export const EditCoverSheet: React.FC<EditCoverSheetProps> = ({
  visible,
  currentUri,
  onClose,
  onSave,
}) => {
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setPickedUri(null);
  }, [visible]);

  const previewUri = pickedUri ?? currentUri;

  const handlePick = async () => {
    const uri = await pickImageUri([12, 5]);
    if (uri) setPickedUri(uri);
  };

  const handleSave = async () => {
    if (!pickedUri) return;
    setSaving(true);
    try {
      await onSave(pickedUri);
      onClose();
    } catch {
      // parent alerts; keep open to retry
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardBottomSheet
      visible={visible}
      title="Edit cover"
      subtitle="This photo shows at the top of your trip."
      onClose={onClose}
      heightMode="auto"
      footer={<SaveButton onPress={handleSave} loading={saving} disabled={!pickedUri} />}
    >
      <TouchableOpacity
        style={styles.coverPreviewWrap}
        onPress={handlePick}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={previewUri ? 'Change cover photo' : 'Add cover photo'}
      >
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.coverPreview} resizeMode="cover" />
        ) : (
          <View style={[styles.coverPreview, styles.coverPreviewEmpty]}>
            <Ionicons name="image-outline" size={36} color={C.textFaint} />
            <Text style={styles.coverEmptyText}>No cover yet</Text>
          </View>
        )}
        <View style={styles.coverOverlayPill}>
          <Ionicons name="camera-outline" size={16} color={C.white} />
          <Text style={styles.coverOverlayText}>
            {previewUri ? 'Change photo' : 'Choose photo'}
          </Text>
        </View>
      </TouchableOpacity>
    </WizardBottomSheet>
  );
};

const styles = StyleSheet.create({
  // Save button (footer)
  saveBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '600',
    color: C.white,
  },

  // Text field
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fieldLabel: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: C.ink,
  },
  counter: {
    fontFamily: FONT_INTER,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 22,
    color: C.ink,
    backgroundColor: C.surfaceMuted,
  },

  // Cover preview
  coverPreviewWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.surfaceMuted,
  },
  coverPreview: {
    width: '100%',
    aspectRatio: 12 / 5,
  },
  coverPreviewEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  coverEmptyText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: C.textFaint,
  },
  coverOverlayPill: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coverOverlayText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '600',
    color: C.white,
  },
});
