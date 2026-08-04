import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../../BottomSheetShell';
import { ff } from '../../../theme/fonts';
import { showErrorAlert } from '../../../utils/friendlyError';

export type ConfirmCopy = { title: string; message: string; confirmLabel: string };

/** Marker for "the operator backed out of a confirm popup". A cancel is not a
 *  failure, so it must not raise an error alert. Checked by identity, never
 *  shown to anyone. Lives here because EditFieldSheet is the only place that
 *  has to tell the two apart. */
export const CANCELLED = Symbol('cancelled');

export type EditFieldSheetProps<T> = {
  visible: boolean;
  title: string;
  /** Seeded into the draft each time the sheet goes closed -> open. */
  initial: T;
  onClose: () => void;
  /** Writes to the database. Throwing keeps the sheet open with the draft intact. */
  onSave: (value: T) => Promise<void>;
  /** Null when the draft is fine, otherwise the sentence to show. */
  validate?: (value: T) => string | null;
  /** Return copy to make Save ask first (spec §3.5 — Where and When). Return
   *  null to save straight away. */
  confirm?: (value: T) => ConfirmCopy | null;
  /** Compares draft to initial. Defaults to a JSON compare, which is right for
   *  the plain objects and arrays every field here uses. */
  isDirty?: (draft: T, initial: T) => boolean;
  children: (draft: T, setDraft: (next: T) => void) => React.ReactNode;
};

/**
 * The one sheet wrapper every row on the Edit trip screen uses.
 *
 * It owns: the local draft, the closed->open reseed, the dirty check that gates
 * Save, validation, the optional confirm popup, the saving spinner, and the
 * error alert. That leaves each row in the screen a ten-line declaration around
 * a body component that already exists in src/components/trips/sheets/.
 *
 * The reseed is on the closed->open EDGE, not on every `initial` change: a
 * React Query refetch mid-edit would otherwise wipe what the operator typed.
 * Same reason ProfileEditSurfStyleScreen uses a prevVisibleRef (:101-110).
 */
export function EditFieldSheet<T>({
  visible,
  title,
  initial,
  onClose,
  onSave,
  validate,
  confirm,
  isDirty,
  children,
}: EditFieldSheetProps<T>) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const prevVisible = useRef(false);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      setDraft(initial);
      setSaving(false);
    }
    prevVisible.current = visible;
  }, [visible, initial]);

  const dirty = isDirty
    ? isDirty(draft, initial)
    : JSON.stringify(draft) !== JSON.stringify(initial);
  const error = validate ? validate(draft) : null;

  const write = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      if (e !== CANCELLED) showErrorAlert('Could not save', e, 'Your changes were not saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, onClose]);

  const handleSave = useCallback(() => {
    if (error) return;
    const ask = confirm?.(draft) ?? null;
    if (!ask) {
      void write();
      return;
    }
    Alert.alert(ask.title, ask.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: ask.confirmLabel, style: 'destructive', onPress: () => void write() },
    ]);
  }, [confirm, draft, error, write]);

  const canSave = dirty && !error && !saving;

  return (
    <BottomSheetShell
      visible={visible}
      onClose={saving ? () => {} : onClose}
      avoidKeyboard
      swipeToDismiss={false}
    >
      {({ panHandlers }) => (
        <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabWrap} {...panHandlers}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{title}</Text>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children(draft, setDraft)}
            {!!error && dirty && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  // BottomSheetShell is HEADLESS — it owns only the Modal, the scrim, the slide
  // and the swipe. Every consumer renders its own white surface and its own
  // bottom inset padding. Without the surface, this content sits directly on the
  // 0.45 black scrim; without the padding, androidNavBarNudge slides the Save
  // button under the Android nav bar. Both only show up on device, so tsc and
  // jest will not catch either. Reference: src/components/trips/RejectDocumentSheet.tsx
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 12, gap: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  title: { fontFamily: ff('Inter', '700'), fontSize: 18, color: '#212121' },
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: 20 },
  error: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#C0392B',
    marginTop: 12,
  },
  footer: { paddingHorizontal: 20, paddingTop: 12 },
  saveBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0788B0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#CFCFCF' },
  saveText: { fontFamily: ff('Inter', '700'), fontSize: 16, color: '#FFFFFF' },
});
