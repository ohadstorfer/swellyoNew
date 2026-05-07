import React, { useEffect, useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import {
  addMembersFromDms,
  createSurftripGroup,
  listMyDmPartners,
  updateSurftripGroup,
} from '../../services/surftrips/surftripsService';
import { uploadSurftripImage } from '../../services/storage/storageService';
import type { SurftripGroup } from '../../types/surftrips';
import { AddMembersSheet } from './AddMembersSheet';

interface CreateSurftripModalProps {
  visible: boolean;
  currentUserId: string | null;
  /** When provided, the modal opens in edit mode and updates the existing group instead of creating one. */
  initialGroup?: SurftripGroup | null;
  onClose: () => void;
  onCreated?: (group: SurftripGroup) => void;
  onUpdated?: (group: SurftripGroup) => void;
}

const pickImage = async (): Promise<string | null> => {
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
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      return result.assets[0].uri;
    }
  } catch (e) {
    console.error('[CreateSurftripModal] pickImage error:', e);
  }
  return null;
};

export const CreateSurftripModal: React.FC<CreateSurftripModalProps> = ({
  visible,
  currentUserId,
  initialGroup,
  onClose,
  onCreated,
  onUpdated,
}) => {
  const editMode = !!initialGroup;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  /** When in edit mode, holds either the original remote URL or a fresh local URI from the picker. */
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageDirty, setImageDirty] = useState(false);
  const [maxMembersText, setMaxMembersText] = useState('50');
  const [submitting, setSubmitting] = useState(false);
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const [showInviteSheet, setShowInviteSheet] = useState(false);

  // Hydrate state when entering edit mode (or reset when closing the edit-mode modal).
  useEffect(() => {
    if (visible && initialGroup) {
      setName(initialGroup.name ?? '');
      setDescription(initialGroup.description ?? '');
      setImageUri(initialGroup.hero_image_url ?? null);
      setImageDirty(false);
      setMaxMembersText(String(initialGroup.max_members ?? 50));
      setInvitedUserIds([]);
    }
    if (!visible) {
      // wipe local state on close so the next open starts fresh
      setName('');
      setDescription('');
      setImageUri(null);
      setImageDirty(false);
      setMaxMembersText('50');
      setInvitedUserIds([]);
      setShowInviteSheet(false);
    }
  }, [visible, initialGroup]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  const reset = () => {
    setName('');
    setDescription('');
    setImageUri(null);
    setImageDirty(false);
    setMaxMembersText('50');
    setInvitedUserIds([]);
  };

  const parsedMaxMembers = (() => {
    const n = parseInt(maxMembersText, 10);
    if (Number.isNaN(n)) return 50;
    return Math.max(2, Math.min(200, n));
  })();

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handlePickImage = async () => {
    if (submitting) return;
    const uri = await pickImage();
    if (uri) {
      setImageUri(uri);
      setImageDirty(true);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // In create mode: upload the picked image (if any).
      // In edit mode: upload only if the user picked a new one (imageDirty).
      let heroImageUrl: string | null | undefined = undefined;
      if (editMode) {
        if (imageDirty) {
          if (imageUri && currentUserId) {
            const upload = await uploadSurftripImage(imageUri, currentUserId);
            if (upload.success && upload.url) {
              heroImageUrl = upload.url;
            } else {
              Alert.alert('Upload failed', upload.error || 'Could not upload image. Try again.');
              setSubmitting(false);
              return;
            }
          } else {
            heroImageUrl = null; // user cleared the image
          }
        }
      } else {
        heroImageUrl = null;
        if (imageUri && currentUserId) {
          const upload = await uploadSurftripImage(imageUri, currentUserId);
          if (upload.success && upload.url) {
            heroImageUrl = upload.url;
          } else {
            Alert.alert('Upload failed', upload.error || 'Could not upload image. Try again.');
            setSubmitting(false);
            return;
          }
        }
      }

      if (editMode && initialGroup) {
        const updated = await updateSurftripGroup(initialGroup.id, {
          name: trimmedName,
          description: description.trim() || null,
          maxMembers: parsedMaxMembers,
          ...(heroImageUrl !== undefined ? { heroImageUrl } : {}),
        });
        reset();
        onUpdated?.(updated);
      } else {
        const group = await createSurftripGroup({
          name: trimmedName,
          description: description.trim() || null,
          heroImageUrl: heroImageUrl ?? null,
          maxMembers: parsedMaxMembers,
        });
        if (invitedUserIds.length > 0) {
          try {
            await addMembersFromDms(group.id, invitedUserIds);
          } catch (e) {
            // Group is created; only the bulk-invite step failed. Warn but
            // don't block — the host can use "+ Add" on the detail screen.
            console.warn('[CreateSurftripModal] addMembersFromDms failed:', e);
            Alert.alert(
              'Group created, invites partially failed',
              "We couldn't add some of the people you picked. You can add them from the group's detail screen."
            );
          }
        }
        reset();
        onCreated?.(group);
      }
    } catch (e: any) {
      Alert.alert(
        editMode ? 'Could not save changes' : 'Could not create surftrip',
        e?.message || 'Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color="#222B30" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{editMode ? 'Edit surftrip' : 'New surftrip'}</Text>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canSubmit}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {submitting ? (
                <ActivityIndicator color="#0788B0" />
              ) : (
                <Text style={[styles.createBtn, !canSubmit && styles.createBtnDisabled]}>
                  {editMode ? 'Save' : 'Create'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.imagePicker}
              onPress={handlePickImage}
              disabled={submitting}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.heroImage} />
              ) : (
                <View style={styles.heroPlaceholder}>
                  <Ionicons name="camera-outline" size={28} color="#7B7B7B" />
                  <Text style={styles.heroHint}>Add cover photo</Text>
                </View>
              )}
              {imageUri && !submitting && (
                <View style={styles.editBadge}>
                  <Ionicons name="pencil" size={14} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.field}>
              <Text style={styles.label}>Trip name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. El Salvador 2026"
                placeholderTextColor="#9AA3A8"
                style={styles.input}
                maxLength={80}
                editable={!submitting}
                autoFocus
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>About this trip</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="When, where, vibe, who you're looking for…"
                placeholderTextColor="#9AA3A8"
                style={[styles.input, styles.inputMultiline]}
                maxLength={500}
                editable={!submitting}
                multiline
                numberOfLines={4}
              />
              <Text style={styles.helper}>Optional · {description.length}/500</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Max members</Text>
              <TextInput
                value={maxMembersText}
                onChangeText={(t) => setMaxMembersText(t.replace(/[^0-9]/g, ''))}
                placeholder="50"
                placeholderTextColor="#9AA3A8"
                style={styles.input}
                keyboardType="number-pad"
                editable={!submitting}
                maxLength={3}
              />
              <Text style={styles.helper}>Between 2 and 200 · default 50</Text>
            </View>

            {!editMode && (
              <View style={styles.field}>
                <Text style={styles.label}>Invite from your chats</Text>
                <TouchableOpacity
                  style={styles.invitePicker}
                  onPress={() => setShowInviteSheet(true)}
                  activeOpacity={0.7}
                  disabled={submitting}
                >
                  <Ionicons
                    name={invitedUserIds.length > 0 ? 'people' : 'person-add-outline'}
                    size={20}
                    color={invitedUserIds.length > 0 ? '#0788B0' : '#7B7B7B'}
                  />
                  <Text
                    style={[
                      styles.invitePickerText,
                      invitedUserIds.length > 0 && styles.invitePickerTextActive,
                    ]}
                  >
                    {invitedUserIds.length === 0
                      ? 'Pick people'
                      : invitedUserIds.length === 1
                      ? '1 person selected'
                      : `${invitedUserIds.length} people selected`}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color="#9AA3A8" />
                </TouchableOpacity>
                <Text style={styles.helper}>
                  Optional · they&apos;ll be added straight into the group
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      {!editMode && (
        <AddMembersSheet
          visible={showInviteSheet}
          loadPartners={listMyDmPartners}
          commitSelection={async (ids) => ids}
          remainingSlots={Math.max(0, parsedMaxMembers - 1)}
          initialSelectedIds={invitedUserIds}
          submitLabel={(n) => (n === 0 ? 'Done' : `Confirm ${n}`)}
          onClose={() => setShowInviteSheet(false)}
          onCommitted={(ids) => {
            setInvitedUserIds(ids);
            setShowInviteSheet(false);
          }}
        />
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 24,
    height: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#222B30' },
  createBtn: { fontSize: 15, fontWeight: '700', color: '#0788B0' },
  createBtnDisabled: { color: '#C0C0C0' },

  body: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 18,
  },

  imagePicker: {
    alignSelf: 'center',
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F4F4F4',
    borderWidth: 1,
    borderColor: '#EEE',
    position: 'relative',
  },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  heroHint: { fontSize: 13, color: '#7B7B7B' },
  editBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  field: { gap: 6 },
  label: {
    fontSize: 12,
    color: '#7B7B7B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    fontSize: 16,
    color: '#222B30',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E1E1',
  },
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: 'top',
    borderBottomWidth: 0,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  helper: { fontSize: 12, color: '#9AA3A8', marginTop: 2 },

  invitePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    borderRadius: 10,
  },
  invitePickerText: {
    flex: 1,
    fontSize: 15,
    color: '#7B7B7B',
  },
  invitePickerTextActive: {
    color: '#222B30',
    fontWeight: '600',
  },
});
