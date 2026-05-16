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
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.88;
import { Ionicons } from '@expo/vector-icons';
import type { EnrichedGearItem } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  items: EnrichedGearItem[];
  onClose: () => void;
  onSave: (patch: { name: string; needed_qty: number }, itemId?: string) => Promise<void>;
  onDelete: (itemId: string) => Promise<void>;
}

type SheetView =
  | { mode: 'list' }
  | { mode: 'add' }
  | { mode: 'edit'; item: EnrichedGearItem };

export const ManageGearSheet: React.FC<Props> = ({
  visible,
  items,
  onClose,
  onSave,
  onDelete,
}) => {
  const [view, setView] = useState<SheetView>({ mode: 'list' });
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset to list whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) {
      setView({ mode: 'list' });
      setName('');
      setQty(1);
    }
  }, [visible]);

  // Keep the form in sync when entering edit mode.
  useEffect(() => {
    if (view.mode === 'edit') {
      setName(view.item.name);
      setQty(view.item.needed_qty);
    } else if (view.mode === 'add') {
      setName('');
      setQty(1);
    }
  }, [view]);

  const beginAdd = () => setView({ mode: 'add' });
  const beginEdit = (item: EnrichedGearItem) => setView({ mode: 'edit', item });
  const backToList = () => setView({ mode: 'list' });

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const itemId = view.mode === 'edit' ? view.item.id : undefined;
      await onSave({ name: name.trim(), needed_qty: qty }, itemId);
      setView({ mode: 'list' });
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePress = () => {
    if (view.mode !== 'edit') return;
    const item = view.item;
    Alert.alert('Delete item', `Remove "${item.name}" from group gear?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await onDelete(item.id);
            setView({ mode: 'list' });
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message || 'Please try again.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const isForm = view.mode !== 'list';
  const editingItem = view.mode === 'edit' ? view.item : null;
  // For edit mode: can't drop needed_qty below what's already claimed.
  const minQty = editingItem ? Math.max(1, editingItem.claimed_qty) : 1;

  const headerTitle = view.mode === 'list'
    ? 'Manage Gear'
    : view.mode === 'add'
      ? 'Add item'
      : 'Edit item';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <TouchableOpacity onPress={isForm ? backToList : onClose} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color="#222B30" />
            </TouchableOpacity>
            <Text style={styles.title}>{headerTitle}</Text>
            <View style={{ width: 22 }} />
          </View>

          {isForm ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.flex}
              keyboardVerticalOffset={0}
            >
              <ScrollView
                contentContainerStyle={styles.body}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.label}>NAME</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Sunscreen bottles"
                  placeholderTextColor="#9AA0A6"
                  autoFocus={view.mode === 'add'}
                  editable={!saving && !deleting}
                />

                <Text style={[styles.label, { marginTop: 16 }]}>HOW MANY NEEDED?</Text>
                <View style={styles.counterRow}>
                  <TouchableOpacity
                    style={[styles.counterBtn, qty <= minQty && styles.counterBtnDisabled]}
                    onPress={() => qty > minQty && setQty(q => q - 1)}
                    disabled={qty <= minQty || saving}
                  >
                    <Text style={styles.counterBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.counterValue}>{qty}</Text>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setQty(q => q + 1)}
                    disabled={saving}
                  >
                    <Text style={styles.counterBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                {editingItem && editingItem.claimed_qty > 0 ? (
                  <Text style={styles.hint}>
                    Can't go below {editingItem.claimed_qty} — that's how many
                    people have already committed to bring.
                  </Text>
                ) : null}
              </ScrollView>

              <View style={styles.footer}>
                {view.mode === 'edit' && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={handleDeletePress}
                    disabled={saving || deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator color="#C0392B" />
                    ) : (
                      <Ionicons name="trash-outline" size={20} color="#C0392B" />
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, (!name.trim() || saving) && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={!name.trim() || saving || deleting}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveText}>
                      {view.mode === 'add' ? 'Add' : 'Save'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          ) : (
            <>
              <ScrollView contentContainerStyle={styles.listBody}>
                {items.length === 0 ? (
                  <Text style={styles.empty}>
                    No gear items yet. Tap "Add item" to start.
                  </Text>
                ) : (
                  items.map(item => (
                    <View key={item.id} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemSub}>
                          {item.claimed_qty} / {item.needed_qty} collected
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.editBtn} onPress={() => beginEdit(item)}>
                        <Text style={styles.editText}>Edit</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </ScrollView>

              <View style={styles.footer}>
                <TouchableOpacity style={styles.addBtn} onPress={beginAdd}>
                  <Ionicons name="add" size={20} color="#FFFFFF" />
                  <Text style={styles.addText}>Add item</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222B30' },

  // List
  listBody: { padding: 16, paddingBottom: 8 },
  empty: { color: '#7B7B7B', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  itemName: { fontSize: 15, fontWeight: '700', color: '#222B30' },
  itemSub: { fontSize: 13, color: '#4A5565', marginTop: 2 },
  editBtn: {
    borderWidth: 1,
    borderColor: '#0788B0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editText: { fontSize: 13, fontWeight: '700', color: '#0788B0' },

  // Form
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
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 4,
    marginTop: 6,
    backgroundColor: '#FAFAFA',
  },
  counterBtn: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  counterBtnDisabled: { opacity: 0.3 },
  counterBtnText: { fontSize: 28, fontWeight: '600', color: '#222B30' },
  counterValue: { fontSize: 22, fontWeight: '700', color: '#222B30' },
  hint: { fontSize: 12, color: '#7B7B7B', marginTop: 6, fontStyle: 'italic' },

  // Footer (shared)
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0788B0',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  deleteBtn: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C0392B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#0788B0',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
