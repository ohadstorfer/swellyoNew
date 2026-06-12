// EditSuggestedGearSheet — host tool to edit a trip's suggested gear list.
//
// This sheet edits only the ORDERED array of item NAMES that the host suggests
// everyone packs. Each member separately receives a checkable copy of this list
// elsewhere — this sheet does not touch member state, only the names array.
//
// Save model is intentionally simple: every mutation (add / edit / delete)
// updates the local `draft` AND immediately calls onSave(fullNewArray). There is
// no separate save button. Built on the shared TripBottomSheet shell + SHEET tokens.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import { TripIcon } from '../tripIcons';
import { ff } from '../../../theme/fonts';

interface Props {
  visible: boolean;
  onClose: () => void;
  items: string[]; // current suggested item names, ordered
  saving?: boolean;
  onSave: (names: string[]) => void | Promise<void>; // called with the FULL new array after each change
}

type SheetView =
  | { mode: 'list' }
  | { mode: 'add' }
  | { mode: 'edit'; index: number };

export const EditSuggestedGearSheet: React.FC<Props> = ({
  visible,
  onClose,
  items,
  saving,
  onSave,
}) => {
  const [view, setView] = useState<SheetView>({ mode: 'list' });
  const [draft, setDraft] = useState<string[]>(items);

  // Form-local state.
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // Re-seed the draft and reset to the list view every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setDraft(items);
      setView({ mode: 'list' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Initialise the form fields when entering add/edit.
  useEffect(() => {
    if (view.mode === 'add') {
      setName('');
      setError('');
    } else if (view.mode === 'edit') {
      setName(draft[view.index] ?? '');
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const commit = (next: string[]) => {
    setDraft(next);
    onSave(next);
  };

  // Delete lives in the edit form now (the design's rows only carry "Edit"), so
  // removing returns to the list afterwards.
  const removeAt = (index: number) => {
    const target = draft[index];
    Alert.alert(
      'Remove item',
      `Remove "${target}" from suggested gear?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            commit(draft.filter((_, i) => i !== index));
            setView({ mode: 'list' });
          },
        },
      ]
    );
  };

  const handleSubmitForm = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter an item name.');
      return;
    }
    // Case-insensitive duplicate check against the rest of the list.
    const editingIndex = view.mode === 'edit' ? view.index : -1;
    const lower = trimmed.toLowerCase();
    const isDuplicate = draft.some(
      (n, i) => i !== editingIndex && n.trim().toLowerCase() === lower
    );
    if (isDuplicate) {
      setError('That item is already on the list.');
      return;
    }

    if (view.mode === 'add') {
      commit([...draft, trimmed]);
    } else if (view.mode === 'edit') {
      const idx = view.index;
      commit(draft.map((n, i) => (i === idx ? trimmed : n)));
    }
    setView({ mode: 'list' });
  };

  // ----- FORM VIEW (add / edit) -----
  if (view.mode === 'add' || view.mode === 'edit') {
    const isAdd = view.mode === 'add';
    const editIndex = view.mode === 'edit' ? view.index : -1;
    return (
      <TripBottomSheet
        visible={visible}
        onClose={onClose}
        onBack={() => setView({ mode: 'list' })}
        title={isAdd ? 'Add item' : 'Edit item'}
        footer={
          <TouchableOpacity
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
            onPress={handleSubmitForm}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>{isAdd ? 'Add' : 'Save'}</Text>
          </TouchableOpacity>
        }
      >
        <Text style={styles.fieldLabel}>ITEM NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (error) setError('');
          }}
          placeholder="e.g. Wax, sunscreen, reef booties"
          placeholderTextColor={SHEET.textMuted}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmitForm}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!isAdd ? (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => removeAt(editIndex)}
            activeOpacity={0.7}
          >
            <TripIcon name="trash-01" size={16} color={SHEET.danger} strokeWidth={1} />
            <Text style={styles.removeBtnText}>Remove item</Text>
          </TouchableOpacity>
        ) : null}
      </TripBottomSheet>
    );
  }

  // ----- LIST VIEW (Figma node 12933-36310) -----
  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title="Members pack suggestion"
      headerRight={
        <Text style={styles.countText}>
          {draft.length} item{draft.length === 1 ? '' : 's'}
        </Text>
      }
      footer={
        <TouchableOpacity style={styles.saveBtn} onPress={onClose} activeOpacity={0.85}>
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      }
    >
      {draft.map((item, index) => (
        <View key={`${item}-${index}`} style={styles.itemCard}>
          {/* Left drag handle (visual — reorder not wired yet). */}
          <Ionicons name="ellipsis-vertical" size={20} color="#333333" />
          <Text style={styles.itemName} numberOfLines={2}>
            {item}
          </Text>
          <TouchableOpacity
            onPress={() => setView({ mode: 'edit', index })}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={styles.addCard}
        onPress={() => setView({ mode: 'add' })}
        activeOpacity={0.85}
      >
        <Text style={styles.addCardText}>+ Add Item</Text>
      </TouchableOpacity>
    </TripBottomSheet>
  );
};

export default EditSuggestedGearSheet;

const styles = StyleSheet.create({
  // Header count ("N items")
  countText: { fontFamily: ff('Inter', '400'), fontSize: 16, lineHeight: 18, color: SHEET.textMuted, marginRight: 4 },

  // Item cards (Figma 12933-36310): white, #EEE border, radius 20, dots + name + Edit.
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: SHEET.surface,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    borderRadius: 20,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 18,
    marginBottom: 8,
  },
  itemName: { flex: 1, fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: '#333333' },
  editLink: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#05BCD3' },
  // "+ Add Item" card
  addCard: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SHEET.surface,
    borderWidth: 1,
    borderColor: SHEET.hairline,
    borderRadius: 20,
    paddingVertical: 23,
    marginBottom: 8,
  },
  addCardText: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 22, color: '#333333' },

  // Dark sticky "Save" (Figma surface/M-07 #212121, radius 12).
  saveBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#212121',
  },
  saveBtnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#FFFFFF' },

  // "Remove item" (edit form only)
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, alignSelf: 'flex-start' },
  removeBtnText: { fontFamily: ff('Inter', '600'), fontSize: 13, color: SHEET.danger },

  // Form
  fieldLabel: {
    fontFamily: SHEET.fontBody,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: SHEET.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    marginTop: 8,
    backgroundColor: SHEET.surfaceMuted,
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    color: SHEET.inkBody,
  },
  errorText: {
    fontFamily: SHEET.fontBody,
    fontSize: 13,
    color: SHEET.danger,
    marginTop: 8,
  },

  // Footer primary button
  primaryBtn: {
    backgroundColor: SHEET.brandTeal,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    fontFamily: SHEET.fontBody,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
