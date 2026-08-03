/**
 * MedicalFormSheet — allergies, diet, injuries, medication.
 *
 * This is the one requirement that is NOT a file, and it must stay that way.
 * Medical data is a table row guarded by RLS: the traveler can read and write
 * their own, the host can read it, and there is no export and no signed URL.
 * The 30-day document purge does not touch it because there is no object to
 * delete.
 *
 * Each field has a "none" toggle. That matters: an empty box is ambiguous
 * ("nothing to declare" or "did not fill it in?"), while an explicit
 * `allergies_none = true` is an answer the operator can rely on.
 *
 * Spec: docs/specs/operator-trips/waiver-medical.md
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import {
  fetchMyMedicalForm,
  saveMedicalForm,
  EMPTY_MEDICAL_FORM,
  type MedicalForm,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

type FieldKey = 'allergies' | 'dietary' | 'injuries' | 'medications';

const FIELDS: {
  key: FieldKey;
  noneKey: keyof MedicalForm;
  label: string;
  placeholder: string;
  noneLabel: string;
}[] = [
  {
    key: 'allergies',
    noneKey: 'allergiesNone',
    label: 'Allergies',
    placeholder: 'Peanuts, penicillin, bee stings…',
    noneLabel: 'No allergies',
  },
  {
    key: 'dietary',
    noneKey: 'dietaryNone',
    label: 'Diet',
    placeholder: 'Vegetarian, gluten free…',
    noneLabel: 'No dietary needs',
  },
  {
    key: 'injuries',
    noneKey: 'injuriesNone',
    label: 'Injuries or conditions',
    placeholder: 'Shoulder injury, asthma…',
    noneLabel: 'None',
  },
  {
    key: 'medications',
    noneKey: 'medicationsNone',
    label: 'Medication',
    placeholder: 'Anything you take regularly',
    noneLabel: 'None',
  },
];

export const MedicalFormSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  tripId: string;
  userId: string;
  onSaved: () => void;
}> = ({ visible, onClose, tripId, userId, onSaved }) => {
  const [form, setForm] = useState<MedicalForm>(EMPTY_MEDICAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const existing = await fetchMyMedicalForm(tripId, userId);
        if (!cancelled) setForm(existing ?? EMPTY_MEDICAL_FORM);
      } catch (e) {
        console.error('[MedicalFormSheet] load failed:', e);
        if (!cancelled) setForm(EMPTY_MEDICAL_FORM);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tripId, userId]);

  const setField = (key: FieldKey, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const toggleNone = (noneKey: keyof MedicalForm, textKey: FieldKey) =>
    setForm(prev => {
      const next = !prev[noneKey];
      // Turning "none" on clears the text — keeping both would be contradictory
      // data the operator has to guess at.
      return { ...prev, [noneKey]: next, ...(next ? { [textKey]: '' } : {}) };
    });

  // Every field must be answered: either text, or an explicit "none".
  const complete = FIELDS.every(f => {
    const none = form[f.noneKey] as boolean;
    return none || (form[f.key] as string).trim().length > 0;
  });

  const handleSave = useCallback(async () => {
    if (saving || !complete) return;
    setSaving(true);
    try {
      await saveMedicalForm(tripId, userId, form);
      setSaving(false);
      onSaved();
    } catch (e) {
      console.error('[MedicalFormSheet] save failed:', e);
      setSaving(false);
      showErrorAlert('Could not save', e, 'Could not save your medical info. Please try again.');
    }
  }, [saving, complete, tripId, userId, form, onSaved]);

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {({ panHandlers }) => (
        <View style={styles.surface}>
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Medical info</Text>
            <Text style={styles.sub}>Only you and your trip organiser can see this.</Text>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                {FIELDS.map(f => {
                  const none = form[f.noneKey] as boolean;
                  return (
                    <View key={f.key} style={styles.field}>
                      <Text style={styles.label}>{f.label}</Text>
                      <TextInput
                        value={form[f.key] as string}
                        onChangeText={t => setField(f.key, t.slice(0, 500))}
                        placeholder={f.placeholder}
                        placeholderTextColor="#9A9A9A"
                        editable={!none}
                        multiline
                        style={[styles.input, none && styles.inputDisabled]}
                      />
                      <Pressable
                        onPress={() => toggleNone(f.noneKey, f.key)}
                        style={styles.noneRow}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: none }}
                      >
                        <View style={[styles.box, none && styles.boxOn]}>
                          {none ? (
                            <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                          ) : null}
                        </View>
                        <Text style={styles.noneText}>{f.noneLabel}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.footer}>
                <Pressable
                  onPress={handleSave}
                  disabled={!complete || saving}
                  style={[styles.primaryBtn, (!complete || saving) && styles.btnDisabled]}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Save</Text>
                  )}
                </Pressable>
                {!complete ? (
                  <Text style={styles.hint}>
                    Answer every question — write something, or tick the box.
                  </Text>
                ) : null}
              </View>
            </>
          )}
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
    maxHeight: '90%',
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 10, gap: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4', marginBottom: 4 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
  },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 12, color: '#7B7B7B' },
  center: { padding: 32, alignItems: 'center' },
  body: { borderTopWidth: 1, borderTopColor: '#EEEEEE' },
  bodyContent: { padding: 20, gap: 18 },
  field: { gap: 8 },
  label: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    padding: 12,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: '#212121',
    textAlignVertical: 'top',
  },
  inputDisabled: { backgroundColor: '#F7F7F5', color: '#9A9A9A' },
  noneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: '#05BCD3', borderColor: '#05BCD3' },
  noneText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#555555' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
  },
  primaryBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#05BCD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: { opacity: 0.45 },
  hint: {
    fontFamily: ff('Inter', '400'),
    fontSize: 11,
    color: '#9A9A9A',
    textAlign: 'center',
  },
});
