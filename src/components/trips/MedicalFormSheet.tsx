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
 * The form itself (`MedicalFormBody` + `useMedicalForm`) is exported on its
 * own: traveler onboarding renders it INLINE as the "Personal Info" step
 * (Figma 17134:25594), and the Plan tab keeps this sheet. One form, two
 * frames — two copies of "what counts as answered" would drift.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import { textStyle, textStyles } from '../../theme/typography';
import { PersonalInfoIcon } from './PersonalInfoIcon';
import { PhoneField } from './PhoneField';
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
  { key: 'emergencyName', label: 'Full name', placeholder: 'Full Name', autoComplete: 'name', max: 120 },
  {
    key: 'emergencyPhone',
    label: 'Phone number',
    // Drawn by PhoneField (flag + dial code picker). Still stored as one
    // string, "+371 21234567".
    placeholder: 'Phone number',
    keyboardType: 'phone-pad',
    autoComplete: 'tel',
    max: 40,
  },
  {
    key: 'emergencyRelation',
    label: 'Relationship',
    placeholder: 'Relationship (optional)',
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
  /** The "nothing to declare" radio. */
  noneLabel: string;
  /** The "I have something" radio — the one that opens the text box. */
  someLabel: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'allergies',
    noneKey: 'allergiesNone',
    label: 'Allergies',
    placeholder: 'Peanuts, penicillin, bee stings...',
    noneLabel: 'No allergies',
    someLabel: 'I have allergies',
    icon: <PersonalInfoIcon name="allergies" />,
  },
  {
    key: 'dietary',
    noneKey: 'dietaryNone',
    label: 'Dietary needs',
    placeholder: 'Vegetarian, gluten free',
    noneLabel: 'I have no dietary needs',
    someLabel: 'I have dietary needs',
    icon: <PersonalInfoIcon name="dietary" />,
  },
  {
    key: 'injuries',
    noneKey: 'injuriesNone',
    label: 'Injuries or conditions',
    placeholder: 'Shoulder injury, asthma...',
    noneLabel: 'I have no injuries or conditions',
    someLabel: 'I have something to share',
    icon: <PersonalInfoIcon name="injuries" />,
  },
  {
    key: 'medications',
    noneKey: 'medicationsNone',
    label: 'Medication',
    placeholder: 'Anything you take regularly...',
    noneLabel: "I don't take any medication",
    someLabel: 'I take medication',
    icon: <PersonalInfoIcon name="medication" />,
  },
];

/**
 * Load, edit and save one traveler's medical form. `active` is the sheet's
 * `visible`, or always true for the inline onboarding step.
 */
export function useMedicalForm(tripId: string, userId: string, active: boolean, onSaved: () => void) {
  const [form, setForm] = useState<MedicalForm>(EMPTY_MEDICAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
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
  }, [active, tripId, userId]);

  // Every field must be answered: either text, or an explicit "none".
  const answersComplete = FIELDS.every(f => {
    const none = form[f.noneKey] as boolean;
    return none || (form[f.key] as string).trim().length > 0;
  });
  // A name and a number. `isMedicalFormComplete` asks the same question of a
  // SAVED form — same rule, one place, so the form cannot let through
  // something the dashboard then reports as missing.
  const contactComplete =
    form.emergencyName.trim().length > 0 && form.emergencyPhone.trim().length > 0;
  const complete = answersComplete && contactComplete;
  const hint = complete
    ? null
    : !contactComplete
      ? 'Add an emergency contact — a name and a phone number.'
      : 'Answer every question — pick an option, and add details if you have any.';

  const save = useCallback(async () => {
    if (saving || !complete) return;
    setSaving(true);
    try {
      await saveMedicalForm(tripId, userId, form);
      setSaving(false);
      onSaved();
    } catch (e) {
      console.error('[MedicalFormSheet] save failed:', e);
      setSaving(false);
      showErrorAlert('Could not save', e, 'Could not save your personal info. Please try again.');
    }
  }, [saving, complete, tripId, userId, form, onSaved]);

  return { form, setForm, loading, saving, complete, hint, save };
}

/**
 * The form body — Figma 17134:25594. An "Emergency contact" card, then one
 * card per question: icon, label, two radios ("none" / "I have…") and a text
 * box. The box is always drawn; picking "none" greys it out and empties it.
 *
 * ⚠️ NOTHING IS PRE-SELECTED. A fresh form shows both radios empty, so a
 * traveler who scrolls past has answered nothing — "none" is only ever an
 * explicit choice, which is the whole point of the `*_none` columns. The table
 * has no column for "picked I-have but wrote nothing yet", so that half lives
 * in `pickedSome` here and the question stays unanswered until text is typed.
 */
export const MedicalFormBody: React.FC<{
  form: MedicalForm;
  setForm: React.Dispatch<React.SetStateAction<MedicalForm>>;
}> = ({ form, setForm }) => {
  const setField = (key: FieldKey, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const setContact = (key: ContactKey, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const [pickedSome, setPickedSome] = useState<Set<FieldKey>>(() => new Set());

  // Picking "none" clears the text — keeping both would be contradictory data
  // the operator has to guess at.
  const pickNone = (noneKey: keyof MedicalForm, textKey: FieldKey) =>
    setForm(prev => ({ ...prev, [noneKey]: true, [textKey]: '' }));

  const pickSome = (noneKey: keyof MedicalForm, textKey: FieldKey) => {
    setPickedSome(prev => (prev.has(textKey) ? prev : new Set(prev).add(textKey)));
    setForm(prev => (prev[noneKey] ? { ...prev, [noneKey]: false } : prev));
  };

  return (
    <View style={styles.formStack}>
      {/* ── Emergency contact ─────────────────────────────────────────────
          First, and set apart as its own floating card, because it is the only
          block here that exists to be used rather than read. */}
      <View style={styles.contactBlock}>
        <View style={styles.contactHead}>
          <View style={styles.deetIcon}>
            <PersonalInfoIcon name="user" />
          </View>
          <View style={styles.contactHeadText}>
            <Text style={styles.blockTitle}>Emergency contact</Text>
            <Text style={styles.blockSub}>
              One person we can reach if something happens to you.
            </Text>
          </View>
        </View>
        {CONTACT_FIELDS.map(c =>
          c.key === 'emergencyPhone' ? (
            <PhoneField
              key={c.key}
              value={form[c.key]}
              onChangeText={t => setContact(c.key, t)}
              placeholder={c.placeholder}
              maxLength={c.max}
              accessibilityLabel={c.label}
            />
          ) : (
          <TextInput
            key={c.key}
            value={form[c.key]}
            onChangeText={t => setContact(c.key, t.slice(0, c.max))}
            placeholder={c.placeholder}
            placeholderTextColor="#7B7B7B"
            keyboardType={c.keyboardType ?? 'default'}
            autoComplete={c.autoComplete}
            accessibilityLabel={c.optional ? `${c.label}, optional` : c.label}
            style={styles.input}
          />
          ),
        )}
      </View>

      <View style={styles.deetsGroup}>
        <Text style={styles.deetsTitle}>Basic deets</Text>
        {FIELDS.map(f => {
          const none = form[f.noneKey] as boolean;
          const text = form[f.key] as string;
          const some = !none && (pickedSome.has(f.key) || text.trim().length > 0);
          return (
            <View key={f.key} style={styles.deetCard}>
              <View style={styles.deetRow}>
                <View style={styles.deetIcon}>{f.icon}</View>
                <Text style={styles.deetLabel}>{f.label}</Text>
              </View>
              <View accessibilityRole="radiogroup" style={styles.radioGroup}>
                <RadioRow
                  label={f.noneLabel}
                  selected={none}
                  onPress={() => pickNone(f.noneKey, f.key)}
                />
                <RadioRow
                  label={f.someLabel}
                  selected={some}
                  onPress={() => pickSome(f.noneKey, f.key)}
                />
              </View>
              <TextInput
                value={text}
                onChangeText={t => setField(f.key, t.slice(0, 500))}
                placeholder={f.placeholder}
                placeholderTextColor={none ? '#A0A0A0' : '#7B7B7B'}
                editable={!none}
                multiline
                accessibilityLabel={f.label}
                style={[styles.input, styles.inputMulti, none && styles.inputOff]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
};

const RadioRow: React.FC<{ label: string; selected: boolean; onPress: () => void }> = ({
  label,
  selected,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    hitSlop={{ top: 6, bottom: 6, left: 4, right: 12 }}
    style={styles.radioRow}
    accessibilityRole="radio"
    accessibilityState={{ selected }}
    accessibilityLabel={label}
  >
    <View style={[styles.box, selected && styles.boxOn]}>
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
    <Text style={styles.noneText}>{label}</Text>
  </Pressable>
);

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
  const { form, setForm, loading, saving, complete, hint, save } = useMedicalForm(
    tripId,
    userId,
    visible,
    onSaved,
  );

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
            <Text style={styles.title}>Personal Info</Text>
            <Text style={styles.sub}>Only you and your trip organiser can see this.</Text>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <MedicalFormBody form={form} setForm={setForm} />
              </ScrollView>

              <View style={styles.footer}>
                <Pressable
                  onPress={save}
                  disabled={!complete || saving}
                  style={[styles.primaryBtn, (!complete || saving) && styles.btnDisabled]}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Save</Text>
                  )}
                </Pressable>
                {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
  formStack: { gap: 24 },
  // Figma 17134:25614 — a floating white card, set apart from the questions.
  contactBlock: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 24,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  // MB2 bold 14/18 + B3 (the export's bold 18 is the desktop mode).
  blockTitle: { ...textStyle('MB2', '700'), color: '#333333' },
  blockSub: { ...textStyles.B3, color: '#333333' },
  input: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...textStyles.MB2,
    color: '#333333',
  },
  inputMulti: { paddingTop: 18, paddingBottom: 18, textAlignVertical: 'top' },
  // Surface/M 03 — the box under a "none" answer.
  inputOff: { backgroundColor: '#E4E4E4' },
  contactHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  contactHeadText: { flex: 1, gap: 1 },
  radioGroup: { gap: 12 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  deetsGroup: { gap: 15 },
  deetsTitle: { ...textStyle('MB1', '700'), color: '#333333', marginBottom: -7 },
  deetCard: {
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  deetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deetIcon: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deetLabel: { flex: 1, ...textStyle('B3', '700'), color: '#333333' },
  box: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: '#05BCD3', borderColor: '#05BCD3' },
  noneText: { ...textStyles.B3, color: '#333333' },
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
