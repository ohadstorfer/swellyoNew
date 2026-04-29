import React, { useMemo, useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { ProfileImage } from './ProfileImage';
import {
  Conversation,
  messagingService,
} from '../services/messaging/messagingService';

interface CreateGroupChatModalProps {
  visible: boolean;
  currentUserId: string | null;
  directConversations: Conversation[];
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
}

export const CreateGroupChatModal: React.FC<CreateGroupChatModalProps> = ({
  visible,
  directConversations,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const contacts = useMemo(() => {
    const seen = new Set<string>();
    const out: { user_id: string; name: string; avatar: string | null }[] = [];
    for (const conv of directConversations) {
      const u = conv.other_user;
      if (!u?.user_id || seen.has(u.user_id)) continue;
      seen.add(u.user_id);
      out.push({
        user_id: u.user_id,
        name: u.name || 'User',
        avatar: u.profile_image_url || null,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [directConversations]);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && selected.size > 0 && !submitting;

  const handleClose = () => {
    if (submitting) return;
    setTitle('');
    setSelected(new Set());
    onClose();
  };

  const toggle = (userId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const conv = await messagingService.createGroupConversation(
        trimmedTitle,
        Array.from(selected)
      );
      setTitle('');
      setSelected(new Set());
      onCreated(conv);
    } catch (e: any) {
      Alert.alert('Could not create group', e?.message || 'Please try again.');
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
            <Text style={styles.headerTitle}>New group</Text>
            <TouchableOpacity
              onPress={handleCreate}
              disabled={!canSubmit}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {submitting ? (
                <ActivityIndicator color="#B72DF2" />
              ) : (
                <Text style={[styles.createBtn, !canSubmit && styles.createBtnDisabled]}>
                  Create
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.titleField}>
            <Text style={styles.label}>Group name</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Bali crew"
              placeholderTextColor="#9AA3A8"
              style={styles.titleInput}
              maxLength={60}
              editable={!submitting}
            />
          </View>

          <Text style={[styles.label, styles.contactsLabel]}>
            Add people {selected.size > 0 ? `(${selected.size})` : ''}
          </Text>

          {contacts.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Start a 1-on-1 chat with someone first to add them to a group.
              </Text>
            </View>
          ) : (
            <FlatList
              data={contacts}
              keyExtractor={(c) => c.user_id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selected.has(item.user_id);
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => toggle(item.user_id)}
                    activeOpacity={0.7}
                  >
                    <ProfileImage
                      imageUrl={item.avatar}
                      name={item.name}
                      style={styles.rowAvatar}
                      showLoadingIndicator={false}
                    />
                    <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                    <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                      {isSelected && (
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
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
    height: '80%',
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
  createBtn: { fontSize: 15, fontWeight: '700', color: '#B72DF2' },
  createBtnDisabled: { color: '#C0C0C0' },

  titleField: { paddingHorizontal: 16, paddingTop: 14 },
  label: { fontSize: 12, color: '#7B7B7B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  titleInput: {
    fontSize: 16,
    color: '#222B30',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E1E1',
  },
  contactsLabel: { paddingHorizontal: 16, marginTop: 18 },

  empty: { padding: 24, alignItems: 'center' },
  emptyText: { color: '#7B7B7B', textAlign: 'center', fontSize: 14, lineHeight: 20 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  rowName: { flex: 1, fontSize: 15, color: '#222B30' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#C7C7CC',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxOn: { backgroundColor: '#B72DF2', borderColor: '#B72DF2' },
});
