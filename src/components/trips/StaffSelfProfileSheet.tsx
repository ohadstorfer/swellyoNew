/**
 * StaffSelfProfileSheet — how a crew member is introduced on one trip, edited
 * by the crew member.
 *
 * Product Specs §"Manage self": "edit your own description." Until
 * 20260904000300 nobody could: every write to `organized_trip_staff` needed
 * `staff.manage`, so a guide who wanted to fix a typo in their own bio had to
 * ask the operator to do it.
 *
 * ── Two fields, and only two ───────────────────────────────────────────────
 * Title and bio. Not the tier (that is a permission set, and letting someone
 * grant themselves one is the hole the migration's trigger exists to close),
 * not their name or photo (those come from their Swellyo profile — this is one
 * trip, not a second identity), and not whether they are shown to travelers at
 * all (`profile.shown_to_travelers` is the operator's call about their own
 * shop window).
 *
 * The database refuses all of that regardless of what this file does. The
 * point of listing it here is that the screen should never OFFER something the
 * server will refuse.
 *
 * ── Not TripStaffSheet ─────────────────────────────────────────────────────
 * That sheet is the operator's crew manager and is gated on `staff.manage`,
 * which is exactly who this is not for. Same two fields, a fifth of the
 * surface.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import { showErrorAlert } from '../../utils/friendlyError';
import {
  updateTripStaffProfile,
  STAFF_PROFESSIONS,
  type TripStaffMember,
} from '../../services/trips/tripStaffService';

const C = {
  ink: '#212121',
  muted: '#7B7B7B',
  line: '#EEEEEE',
  chip: '#F4F6F7',
  chipOn: '#E4F8FB',
  chipOnText: '#066B8C',
  accent: '#05BCD3',
};

const BIO_MAX = 400;
const TITLE_MAX = 60;

export const StaffSelfProfileSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** The viewer's own live staff row. The caller has already fetched it — that
   *  is also how it decided whether to offer this at all. */
  member: TripStaffMember | null;
  /** Re-read the crew list and this row after a successful save. */
  onSaved: () => void;
}> = ({ visible, onClose, member, onSaved }) => {
  const insets = useSafeAreaInsets();
  // A number, not '90%'. BottomSheetShell wraps children in auto-height views,
  // so a percentage resolves against the surface's own content height and
  // leaves a strip of the screen showing below the sheet. Same fix as
  // MedicalFormSheet and ManageRequirementsSheet.
  const { height: windowHeight } = useWindowDimensions();
  const maxSheetHeight = Math.round(windowHeight * 0.9);

  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  // Reseed on every open, not on every `member` change: the row's object
  // identity moves whenever the crew query refetches, and reseeding then would
  // wipe what the person was halfway through typing.
  useEffect(() => {
    if (!visible) return;
    setTitle(member?.title ?? '');
    setBio(member?.bio ?? '');
  }, [visible, member?.id]);

  // Let go of the keyboard BEFORE the sheet slides out — a TextInput here is
  // the Modal's first responder, and dismissing the two in the wrong order on
  // iOS leaves a layer behind that eats every touch underneath.
  useEffect(() => {
    if (!visible) Keyboard.dismiss();
  }, [visible]);

  const dirty = title.trim() !== (member?.title ?? '') || bio.trim() !== (member?.bio ?? '');

  const save = async () => {
    if (!member || saving || !dirty) return;
    setSaving(true);
    try {
      await updateTripStaffProfile(member.id, { title, bio });
      setSaving(false);
      onSaved();
      onClose();
    } catch (e) {
      setSaving(false);
      // The one refusal worth naming: a row revoked while the sheet was open.
      // Everything else is a network problem and reads better generically.
      showErrorAlert(
        'Could not save',
        e,
        'Could not save your details for this trip. Please try again.',
      );
    }
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {({ panHandlers }) => (
        <View
          style={[
            styles.surface,
            { maxHeight: maxSheetHeight, paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
        >
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Your details</Text>
            <Text style={styles.sub}>How you are introduced on this trip.</Text>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <View style={styles.field}>
              <Text style={styles.label}>What you do here</Text>
              <TextInput
                value={title}
                onChangeText={t => setTitle(t.slice(0, TITLE_MAX))}
                placeholder="Surf guide, photographer…"
                placeholderTextColor="#9A9A9A"
                style={styles.input}
              />
              {/* Chips are a shortcut for typing, not a set of values anything
                  branches on — `title` stays free text. Same list the operator
                  picks from, so the two surfaces agree. */}
              <View style={styles.chips}>
                {STAFF_PROFESSIONS.map(p => {
                  const on = title.trim().toLowerCase() === p.toLowerCase();
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setTitle(on ? '' : p)}
                      style={[styles.chipBox, on && styles.chipBoxOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{p}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>About you</Text>
                <Text style={styles.counter}>
                  {bio.length}/{BIO_MAX}
                </Text>
              </View>
              <TextInput
                value={bio}
                onChangeText={t => setBio(t.slice(0, BIO_MAX))}
                placeholder="A line or two travelers will read before they meet you."
                placeholderTextColor="#9A9A9A"
                multiline
                style={[styles.input, styles.inputTall]}
              />
              {/* The trip page cuts a bio at three lines, so the limit is not
                  arbitrary — anything longer is either a CV or a paste
                  accident, and both look broken there. */}
              <Text style={styles.hint}>
                The trip page shows the first few lines. Your operator can edit this too.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={save}
              disabled={!dirty || saving || !member}
              style={[styles.primaryBtn, (!dirty || saving || !member) && styles.btnDisabled]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 10, gap: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4', marginBottom: 4 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 18, fontWeight: '700', color: C.ink },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 12, color: C.muted },
  body: { borderTopWidth: 1, borderTopColor: C.line },
  bodyContent: { padding: 20, gap: 20 },
  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontFamily: ff('Inter', '600'), fontSize: 13, fontWeight: '600', color: C.ink },
  counter: { fontFamily: ff('Inter', '400'), fontSize: 11, color: C.muted },
  input: {
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: C.ink,
  },
  inputTall: { minHeight: 96, textAlignVertical: 'top' },
  hint: { fontFamily: ff('Inter', '400'), fontSize: 11.5, lineHeight: 16, color: C.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chipBox: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.chip,
  },
  chipBoxOn: { backgroundColor: C.chipOn },
  chipText: { fontFamily: ff('Inter', '500'), fontSize: 12, color: C.muted },
  chipTextOn: { color: C.chipOnText },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  primaryBtn: {
    backgroundColor: C.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  primaryBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default StaffSelfProfileSheet;
