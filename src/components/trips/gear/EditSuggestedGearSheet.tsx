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
import { HostTag } from '../HostTag';

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

  const handleDelete = (index: number) => {
    const target = draft[index];
    Alert.alert(
      'Remove item',
      `Remove "${target}" from suggested gear?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => commit(draft.filter((_, i) => i !== index)),
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
      </TripBottomSheet>
    );
  }

  // ----- LIST VIEW -----
  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title="Suggested gear"
      subtitle="Items you suggest everyone packs"
      headerRight={<HostTag />}
      footer={
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => setView({ mode: 'add' })}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Add item</Text>
        </TouchableOpacity>
      }
    >
      {draft.length === 0 ? (
        <Text style={styles.empty}>
          No suggested items yet. Add the gear you want everyone to pack.
        </Text>
      ) : (
        draft.map((item, index) => (
          <View key={`${item}-${index}`} style={styles.row}>
            <Text style={styles.itemName} numberOfLines={2}>
              {item}
            </Text>
            <TouchableOpacity
              style={styles.editPill}
              onPress={() => setView({ mode: 'edit', index })}
              activeOpacity={0.7}
            >
              <Text style={styles.editPillText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(index)}
              hitSlop={8}
              style={styles.trashBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color={SHEET.danger} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </TripBottomSheet>
  );
};

export default EditSuggestedGearSheet;

const styles = StyleSheet.create({
  // List rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  itemName: {
    flex: 1,
    fontFamily: SHEET.fontHead,
    fontSize: 15,
    fontWeight: '700',
    color: SHEET.inkBody,
  },
  editPill: {
    borderWidth: 1,
    borderColor: SHEET.brandTeal,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginLeft: 10,
  },
  editPillText: {
    fontFamily: SHEET.fontBody,
    fontSize: 13,
    fontWeight: '700',
    color: SHEET.brandTeal,
  },
  trashBtn: {
    marginLeft: 12,
    padding: 2,
  },
  empty: {
    fontFamily: SHEET.fontBody,
    fontSize: 14,
    color: SHEET.textMuted,
    textAlign: 'center',
    paddingVertical: 24,
    lineHeight: 20,
  },

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
