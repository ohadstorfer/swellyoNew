/**
 * MedicalFormSheet — emergency contact, allergies, diet, injuries, medication.
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
 * The emergency contact is the one block with no "none" toggle, and it is
 * FIRST. Everything below it is information the operator reads while planning;
 * this is the only thing on the form that gets used in the ninety seconds after
 * something goes wrong, and it should not be at the bottom of a scroll. Added
 * 4 Sep 2026 — Product Specs §"Trip onboarding" listed it from the start and
 * the table never had a column for it.
 *
 * Spec: docs/specs/operator-trips/waiver-medical.md
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import {
  fetchMyMedicalForm,
  saveMedicalForm,
  EMPTY_MEDICAL_FORM,
  isMedicalFormComplete,
  type MedicalForm,
} from '../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../utils/friendlyError';

type FieldKey = 'allergies' | 'dietary' | 'injuries' | 'medications';

type ContactKey = 'emergencyName' | 'emergencyPhone' | 'emergencyRelation';

/** The three lines of the emergency contact. `optional` is only true of the
 *  relationship: a name and a number are what get dialled. */
const CONTACT_FIELDS: {
  key: ContactKey;
  label: string;
  placeholder: string;
  optional?: boolean;
  keyboardType?: 'default' | 'phone-pad';
  autoComplete?: 'name' | 'tel' | 'off';
  max: number;
}[] = [
  { key: 'emergencyName', label: 'Full name', placeholder: 'Who should we call?', autoComplete: 'name', max: 120 },
  {
    key: 'emergencyPhone',
    label: 'Phone number',
    placeholder: 'Include the country code',
    keyboardType: 'phone-pad',
    autoComplete: 'tel',
    max: 40,
  },
  {
    key: 'emergencyRelation',
    label: 'Relationship',
    placeholder: 'Mother, partner, friend…',
    optional: true,
    autoComplete: 'off',
    max: 60,
  },
];

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
  const insets = useSafeAreaInsets();
  // The cap has to be a NUMBER. `maxHeight: '90%'` resolves against the parent,
  // and BottomSheetShell wraps children in auto-height views — so the 90% was
  // taken of the surface's OWN content height, leaving the white surface
  // shorter than the box it sits in and a strip of the trip screen showing
  // below the sheet. Same fix as ManageRequirementsSheet, EditFieldSheet and
  // InviteMembersSheet.
  const { height: windowHeight } = useWindowDimensions();
  const maxSheetHeight = Math.round(windowHeight * 0.9);
  const [form, setForm] = useState<MedicalForm>(EMPTY_MEDICAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Let go of the keyboard BEFORE the sheet starts sliding out. A TextInput in
  // here is the Modal's first responder, and iOS dismissing the two in the
  // wrong order is what leaves a layer behind that eats every touch on the
  // screen underneath.
  //
  // Guarded on the open→close transition, not on `!visible`: this sheet stays
  // mounted for the life of the screen now, so an unguarded dismiss would also
  // fire on mount and could snatch the keyboard from something else on the
  // trip screen.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (wasVisible.current && !visible) Keyboard.dismiss();
    wasVisible.current = visible;
  }, [visible]);

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

  const setContact = (key: ContactKey, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const toggleNone = (noneKey: keyof MedicalForm, textKey: FieldKey) =>
    setForm(prev => {
      const next = !prev[noneKey];
      // Turning "none" on clears the text — keeping both would be contradictory
      // data the operator has to guess at.
      return { ...prev, [noneKey]: next, ...(next ? { [textKey]: '' } : {}) };
    });

  // Every field must be answered: either text, or an explicit "none".
  const answersComplete = FIELDS.every(f => {
    const none = form[f.noneKey] as boolean;
    return none || (form[f.key] as string).trim().length > 0;
  });
  // A name and a number. `isMedicalFormComplete` asks the same question of a
  // SAVED form — same rule, one place, so the sheet cannot let through
  // something the dashboard then reports as missing.
  const contactComplete =
    form.emergencyName.trim().length > 0 && form.emergencyPhone.trim().length > 0;
  const complete = answersComplete && contactComplete;

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
        // Home indicator: the surface used a flat 24, which on an iPhone with a
        // 34pt indicator left the Save button sitting under it. Same
        // `Math.max(insets.bottom, …)` the other operator sheets use.
        <View
          style={[
            styles.surface,
            { maxHeight: maxSheetHeight, paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
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
                {/* ── Emergency contact ─────────────────────────────────────
                    First, and visually set apart, because it is the only block
                    here that exists to be used rather than read. */}
                <View style={styles.contactBlock}>
                  <Text style={styles.blockTitle}>Emergency contact</Text>
                  <Text style={styles.blockSub}>
                    One person we can reach if something happens to you on this trip.
                  </Text>
                  {CONTACT_FIELDS.map(c => (
                    <View key={c.key} style={styles.field}>
                      <Text style={styles.label}>
                        {c.label}
                        {c.optional ? <Text style={styles.optional}>  Optional</Text> : null}
                      </Text>
                      <TextInput
                        value={form[c.key]}
                        onChangeText={t => setContact(c.key, t.slice(0, c.max))}
                        placeholder={c.placeholder}
                        placeholderTextColor="#9A9A9A"
                        keyboardType={c.keyboardType ?? 'default'}
                        autoComplete={c.autoComplete}
                        style={styles.input}
                      />
                    </View>
                  ))}
                </View>

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
                    {!contactComplete
                      ? 'Add an emergency contact — a name and a phone number.'
                      : 'Answer every question — write something, or tick the box.'}
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
    // paddingBottom and maxHeight are applied INLINE, in pixels — see
    // maxSheetHeight above for why the cap cannot be a percentage.
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
  // The emergency contact reads as one object, not three loose inputs — a
  // tinted card with its own heading, so it does not look like a fifth
  // question in the list below it.
  contactBlock: {
    gap: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#F5FBFC',
    borderWidth: 1,
    borderColor: '#DCEFF2',
  },
  blockTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 15,
    fontWeight: '700',
    color: '#212121',
  },
  blockSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#7B7B7B',
    marginTop: -8,
  },
  optional: { fontFamily: ff('Inter', '400'), fontSize: 11, color: '#9A9A9A' },
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
  // The app's one primary CTA — same as onboarding's Next. See TravelerPriceSheet.
  primaryBtn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
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
