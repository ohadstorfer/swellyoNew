import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Platform,
  Animated,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../utils/keyboardAvoidingView';
import { Ionicons } from '@expo/vector-icons';
import type { EnrichedGearItem } from '../../../services/trips/groupTripsService';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import { HostTag } from '../HostTag';
import { TripIcon } from '../tripIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';
import { friendlyErrorMessage } from '../../../utils/friendlyError';

// Name length cap mirrors the Figma "N /21" counter on the Edit Gear sheet.
const MAX_LEN = 21;

interface Props {
  visible: boolean;
  items: EnrichedGearItem[];
  onClose: () => void;
  onSave: (patch: { name: string; needed_qty: number }, itemId?: string) => Promise<void>;
  onDelete: (itemId: string) => Promise<void>;
  /** When true the sheet skips the list and opens straight into the add/edit
   *  form (used by the full-screen ManageGearScreen, which owns the list). Back
   *  closes the sheet instead of returning to a list. */
  formOnly?: boolean;
  /** The item to edit when formOnly. Omit/null → add mode. */
  editItem?: EnrichedGearItem | null;
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
  formOnly = false,
  editItem = null,
}) => {
  // formOnly opens straight into the form; otherwise start on the list.
  const openView = (): SheetView =>
    formOnly ? (editItem ? { mode: 'edit', item: editItem } : { mode: 'add' }) : { mode: 'list' };
  const [view, setView] = useState<SheetView>(openView);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset to the correct entry view whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) {
      setView(openView());
      setName('');
      setQty(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, formOnly, editItem?.id]);

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

  // Sheet motion — fade the backdrop, slide the sheet (matches every other
  // bottom sheet; the formOnly Modal below consumes it).
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } = useSheetTransition(visible, onClose);
  // Android: pad past the system nav/gesture bar (iOS keeps the static 24).
  const insets = useSafeAreaInsets();

  const beginAdd = () => setView({ mode: 'add' });
  const beginEdit = (item: EnrichedGearItem) => setView({ mode: 'edit', item });
  const backToList = () => setView({ mode: 'list' });

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const itemId = view.mode === 'edit' ? view.item.id : undefined;
      await onSave({ name: name.trim(), needed_qty: qty }, itemId);
      if (formOnly) onClose();
      else setView({ mode: 'list' });
    } catch (e: any) {
      Alert.alert('Could not save', friendlyErrorMessage(e, 'Please try again.'));
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
            if (formOnly) onClose();
            else setView({ mode: 'list' });
          } catch (e: any) {
            Alert.alert('Could not delete', friendlyErrorMessage(e, 'Please try again.'));
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

  // ── Form-only sheet — the Figma "Edit Gear" design (node 12919:32508). ──
  // A custom Modal (not TripBottomSheet) so the header trash button, char
  // counter, boxed quantity stepper and dark Update button match pixel-for-pixel.
  if (formOnly) {
    const isEdit = view.mode === 'edit';
    const canDec = qty > minQty && !saving;
    const saveDisabled = !name.trim() || saving || deleting;

    return (
      <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={fs.kavRoot}
        >
          <Pressable style={fs.container} onPress={onClose}>
            <Animated.View pointerEvents="none" style={[fs.backdrop, { opacity: backdropOpacity }]} />
            <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
              <Pressable
                style={[fs.sheet, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 24) }]}
                onPress={e => e.stopPropagation()}
              >
              {/* Grabber */}
              <View style={fs.grabberRow} {...panHandlers}>
                <View style={fs.grabber} />
              </View>

              {/* Title + trash (edit only) */}
              <View style={fs.titleRow}>
                <View style={fs.titleCol}>
                  <Text style={fs.title}>{isEdit ? 'Edit Gear' : 'Add item'}</Text>
                  {isEdit && editingItem ? (
                    <Text style={fs.subtitle} numberOfLines={1}>
                      {editingItem.name}
                    </Text>
                  ) : null}
                </View>
                {isEdit ? (
                  <TouchableOpacity
                    style={fs.trashBtn}
                    onPress={handleDeletePress}
                    disabled={saving || deleting}
                    activeOpacity={0.7}
                    accessibilityLabel="Delete item"
                  >
                    {deleting ? (
                      <ActivityIndicator color="#FF5367" />
                    ) : (
                      <TripIcon name="trash-01" size={22} color="#FF5367" strokeWidth={1} />
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Name + counter */}
              <View style={fs.block}>
                <View style={fs.labelRow}>
                  <Text style={fs.fieldLabel}>Description</Text>
                  <Text style={fs.counter}>
                    {name.length} /{MAX_LEN}
                  </Text>
                </View>
                {/* An existing item's name is locked (only its quantity changes);
                    adding a new item lets you type it. */}
                <View style={[fs.field, isEdit && fs.fieldLocked]}>
                  {isEdit ? (
                    <TripIcon name="lock" size={20} color="#222B30" strokeWidth={2} />
                  ) : (
                    <TripIcon name="edit-03" size={20} color="#333333" />
                  )}
                  <TextInput
                    style={fs.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Sunscreen bottles"
                    placeholderTextColor="#9CA3AF"
                    maxLength={MAX_LEN}
                    autoFocus={!isEdit}
                    editable={!isEdit && !saving && !deleting}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                  />
                </View>
              </View>

              {/* How many needed? — boxed −/＋ stepper */}
              <View style={fs.block}>
                <Text style={fs.fieldLabel}>How many needed?</Text>
                <View style={fs.qtyRow}>
                  <TouchableOpacity
                    style={[fs.qtyBox, !canDec && fs.qtyBoxDisabled]}
                    onPress={() => canDec && setQty(q => q - 1)}
                    disabled={!canDec}
                    activeOpacity={0.7}
                    accessibilityLabel="One less"
                  >
                    <Ionicons name="remove" size={28} color={canDec ? '#333333' : '#CFCFCF'} />
                  </TouchableOpacity>
                  <View style={fs.qtyValueBox}>
                    <Text style={fs.qtyValue}>{qty}</Text>
                  </View>
                  <TouchableOpacity
                    style={fs.qtyBox}
                    onPress={() => setQty(q => q + 1)}
                    disabled={saving}
                    activeOpacity={0.7}
                    accessibilityLabel="One more"
                  >
                    <Ionicons name="add" size={28} color="#333333" />
                  </TouchableOpacity>
                </View>
                {editingItem && editingItem.claimed_qty > 0 ? (
                  <Text style={fs.hint}>
                    Can't go below {editingItem.claimed_qty} — that's how many people have already
                    committed to bring.
                  </Text>
                ) : null}
              </View>

              {/* Update / Add */}
              <View style={fs.buttonsRow}>
                <TouchableOpacity
                  style={[fs.primaryBtn, saveDisabled && fs.primaryBtnDisabled]}
                  onPress={handleSave}
                  disabled={saveDisabled}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={fs.primaryBtnText}>{isEdit ? 'Update' : 'Add'}</Text>
                  )}
                </TouchableOpacity>
              </View>
              </Pressable>
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  // ── List mode (legacy, not used by ManageGearScreen) — kept via the shared
  //    shell so the in-sheet list/add/edit flow still works if reused. ──
  const headerTitle = view.mode === 'list'
    ? 'Manage Gear'
    : view.mode === 'add'
      ? 'Add item'
      : 'Edit Gear';

  const footer = isForm ? (
    <View style={styles.footerRow}>
      {view.mode === 'edit' && (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDeletePress}
          disabled={saving || deleting}
        >
          {deleting ? (
            <ActivityIndicator color={SHEET.danger} />
          ) : (
            <TripIcon name="trash-01" size={20} color={SHEET.danger} strokeWidth={1} />
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
  ) : (
    <TouchableOpacity style={styles.addBtn} onPress={beginAdd}>
      <Ionicons name="add" size={20} color="#FFFFFF" />
      <Text style={styles.addText}>Add item</Text>
    </TouchableOpacity>
  );

  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title={headerTitle}
      subtitle={isForm ? (view.mode === 'edit' ? view.item.name : undefined) : 'Shared items for the trip'}
      onBack={isForm && !formOnly ? backToList : undefined}
      headerRight={isForm ? undefined : <HostTag />}
      footer={footer}
    >
      {isForm ? (
        <>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sunscreen bottles"
            placeholderTextColor={SHEET.textMuted}
            autoFocus={view.mode === 'add'}
            editable={!saving && !deleting}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>How many needed?</Text>
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
        </>
      ) : (
        <>
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
        </>
      )}
    </TripBottomSheet>
  );
};

export default ManageGearSheet;

// ── Figma "Edit Gear" sheet styles (node 12919:32508). ──
const fs = StyleSheet.create({
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

  // Title row — hairline under the title, trash aligned to the top-right.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleCol: { flex: 1, justifyContent: 'center', gap: 4, paddingBottom: 16 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 16, lineHeight: 24, color: '#333333' },
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

  // Field blocks (Name / How many needed?) — 24 between blocks, 8 within.
  block: { marginTop: 24, gap: 8 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
    paddingRight: 4,
  },
  fieldLabel: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 18, color: '#333333' },
  counter: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#7B7B7B' },
  // Icon + input row (mirrors RequestGearSheet / AddPersonalGearSheet).
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
  // Read-only (editing an existing item) — muted fill signals the locked name.
  fieldLocked: { backgroundColor: '#F7F7F7' },
  input: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#333333',
    // Strip the default min height so the 56px field height holds on Android.
    paddingVertical: 0,
  },

  // Quantity selector — two 56px boxes + a flexible value box, all #cfcfcf.
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  qtyBox: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBoxDisabled: { opacity: 0.6 },
  qtyValueBox: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: { fontFamily: ff('Inter', '700'), fontSize: 20, lineHeight: 24, color: '#333333' },
  hint: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#7B7B7B' },

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

const styles = StyleSheet.create({
  // List
  empty: { color: SHEET.textMuted, fontSize: 14, fontFamily: SHEET.fontBody, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  itemName: { fontSize: 14, fontWeight: '700', fontFamily: SHEET.fontHead, color: SHEET.inkBody },
  itemSub: { fontSize: 12, fontFamily: SHEET.fontBody, color: SHEET.textMuted, marginTop: 2 },
  editBtn: {
    borderWidth: 1,
    borderColor: SHEET.brandTeal,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editText: { fontSize: 12, fontWeight: '700', fontFamily: SHEET.fontBody, color: SHEET.brandTeal },

  // Form — Figma "Name" / "How many needed?": 14px Inter, normal case, dark.
  label: { fontSize: 14, fontWeight: '700', fontFamily: SHEET.fontBody, color: SHEET.inkBody },
  input: {
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 6,
    fontSize: 14,
    fontFamily: SHEET.fontBody,
    color: SHEET.inkBody,
    backgroundColor: SHEET.surfaceMuted,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 10,
    paddingHorizontal: 4,
    marginTop: 6,
    backgroundColor: SHEET.surfaceMuted,
  },
  counterBtn: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  counterBtnDisabled: { opacity: 0.3 },
  counterBtnText: { fontSize: 28, fontWeight: '600', fontFamily: SHEET.fontHead, color: SHEET.inkBody },
  counterValue: { fontSize: 16, fontWeight: '700', fontFamily: SHEET.fontHead, color: SHEET.inkBody },
  hint: { fontSize: 12, fontFamily: SHEET.fontBody, color: SHEET.textMuted, marginTop: 6, fontStyle: 'italic' },

  // Footer
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addBtn: {
    flexDirection: 'row',
    backgroundColor: SHEET.brandTeal,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addText: { color: '#FFFFFF', fontWeight: '700', fontFamily: SHEET.fontHead, fontSize: 15 },
  deleteBtn: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SHEET.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: SHEET.brandTeal,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveText: { color: '#FFFFFF', fontWeight: '700', fontFamily: SHEET.fontHead, fontSize: 15 },
});
