/**
 * The operator's default cancellation policy.
 *
 * Three ready-made policies and a custom one, because that is what every
 * platform that holds money does — Viator has exactly three, Airbnb has two
 * plus a fixed guest protection. Free text was the alternative and it cannot
 * become a line on a trip card or a sentence above the Pay button.
 *
 * THREE THINGS ARE NOT COSMETIC:
 *
 * 1. NOTHING SAVES UNTIL "Save". The rows are edited in local state and written
 *    in one go. A half-typed "6" in a days field must never reach the database
 *    as a real six-day policy.
 *
 * 2. THE COPY NEVER SAYS SWELLYO REFUNDS YOU. On an operator trip the money
 *    sits in the operator's own Stripe account and Swellyo has no refund path
 *    at all, so the policy is a promise the OPERATOR makes. Saying otherwise
 *    would commit us to something we cannot do.
 *
 * 3. SAVE IS PINNED, NOT SCROLLED. On Custom with a few steps and a note the
 *    content is taller than the sheet, and a Save button that scrolls away is a
 *    policy nobody finishes setting. The ScrollView gives up height to the
 *    footer (`flexShrink`), the footer never gives up height to the ScrollView.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import {
  PRESET_BLURB,
  PRESET_LABEL,
  explain,
  validate,
  type CancellationPolicy,
  type CancellationPreset,
  type CancellationRule,
} from '../../services/trips/cancellationPolicy';

const C = {
  ink: '#222B30',
  muted: '#7B7B7B',
  line: '#EEEEEE',
  border: '#E4E4E4',
  accent: '#05BCD3',
  accentSoft: '#EBFAFC',
  danger: '#E5484D',
  surfaceMuted: '#F6F8F9',
};

const PRESETS: CancellationPreset[] = ['standard', 'non_refundable', 'custom'];

export const CancellationPolicySheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  value: CancellationPolicy;
  onSave: (next: CancellationPolicy) => Promise<void>;
}> = ({ visible, onClose, value, onSave }) => {
  const insets = useSafeAreaInsets();
  // The cap has to be a NUMBER. `maxHeight: '88%'` resolves against the parent,
  // and BottomSheetShell wraps children in auto-height views — so a percentage
  // is silently ignored and the sheet grows past the top of the screen. Same
  // fix as ManageRequirementsSheet. The old fixed `maxHeight: 460` on the body
  // was the other half of the problem: a phone-independent guess that wasted
  // half a Pro Max and clipped Save on an SE.
  const { height: windowHeight } = useWindowDimensions();
  const maxSheetHeight = Math.round(windowHeight * 0.88);

  const [preset, setPreset] = useState<CancellationPreset>(value.preset);
  const [rules, setRules] = useState<CancellationRule[]>(value.rules);
  const [notes, setNotes] = useState(value.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time it opens. Without this, closing without saving and
  // reopening would show the abandoned edits as if they had been kept.
  useEffect(() => {
    if (!visible) return;
    setPreset(value.preset);
    setRules(value.rules.length > 0 ? value.rules : [{ daysBefore: 60, refundPct: 100 }]);
    setNotes(value.notes ?? '');
    setError(null);
  }, [visible, value]);

  const draft: CancellationPolicy = { preset, rules, notes: notes.trim() || null };
  const problems = validate(draft);
  const blocked = problems.length > 0 || saving;

  const setRule = (i: number, patch: Partial<CancellationRule>) => {
    setRules(prev => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    const lowest = rules.reduce((m, r) => Math.min(m, r.daysBefore), Number.MAX_SAFE_INTEGER);
    const nextDays = Number.isFinite(lowest) && lowest > 7 ? Math.floor(lowest / 2) : 7;
    setRules(prev => [...prev, { daysBefore: nextDays, refundPct: 50 }]);
  };

  const save = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setSaving(false);
      onClose();
    } catch (e: any) {
      setSaving(false);
      setError(e?.message ?? 'Could not save. Please try again.');
    }
  };

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      // The notes field and the two number inputs sit near the bottom; without
      // this the keyboard covers whichever one you just tapped.
      avoidKeyboard
      // Render-prop form, so the pan lives on the grabber alone. Attached to the
      // whole sheet (the default) it fights the ScrollView — the shell's own
      // docs say so, and this sheet was ignoring it.
    >
      {({ panHandlers }) => (
        <View
          style={[
            styles.surface,
            {
              maxHeight: maxSheetHeight,
              // The home indicator sits on top of the Save button otherwise.
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View {...panHandlers} style={styles.grabWrap}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Cancellation policy</Text>
            <Text style={styles.sub}>
              The starting point for every trip you create. Travelers see it
              before they pay.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {PRESETS.map(p => {
              const on = preset === p;
              return (
                <Pressable
                  key={p}
                  style={({ pressed }) => [
                    styles.option,
                    on && styles.optionOn,
                    // Instant, not animated. This is a list of four rows tapped
                    // once each — an entrance animation here would be motion for
                    // its own sake, but no press feedback at all reads as a dead
                    // control on a slow render.
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => setPreset(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons
                    name={on ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={on ? C.accent : '#C4C4C4'}
                  />
                  <View style={styles.optionText}>
                    <Text style={[styles.optionTitle, on && styles.optionTitleOn]}>
                      {PRESET_LABEL[p]}
                    </Text>
                    <Text style={styles.optionSub}>{PRESET_BLURB[p]}</Text>
                  </View>
                </Pressable>
              );
            })}

            {preset === 'custom' && (
              <View style={styles.custom}>
                {rules.map((r, i) => (
                  <View key={i} style={styles.ruleRow}>
                    <TextInput
                      value={String(r.daysBefore)}
                      onChangeText={t => setRule(i, { daysBefore: Number(t.replace(/[^0-9]/g, '')) || 0 })}
                      keyboardType="number-pad"
                      style={styles.numInput}
                      selectTextOnFocus
                      accessibilityLabel="Days before the trip"
                    />
                    <Text style={styles.ruleText}>days before →</Text>
                    <TextInput
                      value={String(r.refundPct)}
                      onChangeText={t => setRule(i, { refundPct: Number(t.replace(/[^0-9]/g, '')) || 0 })}
                      keyboardType="number-pad"
                      style={styles.numInput}
                      selectTextOnFocus
                      accessibilityLabel="Percent refunded"
                    />
                    <Text style={styles.ruleText}>% back</Text>
                    <View style={styles.ruleSpacer} />
                    {rules.length > 1 && (
                      <Pressable
                        onPress={() => setRules(prev => prev.filter((_, n) => n !== i))}
                        hitSlop={12}
                        accessibilityLabel="Remove this step"
                      >
                        <Ionicons name="close-circle" size={22} color="#C4C4C4" />
                      </Pressable>
                    )}
                  </View>
                ))}

                <Pressable
                  onPress={addRule}
                  style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={16} color={C.accent} />
                  <Text style={styles.addText}>Add a step</Text>
                </Pressable>
              </View>
            )}

            {/* What the traveler will read, rebuilt as they type. A policy is
                easy to get backwards, and seeing it in sentences catches that
                faster than any validation message.

                Rendered even while the draft is invalid — it used to vanish, so
                every keystroke in a half-typed custom rule collapsed the block
                and jumped everything below it. The panel stays; only what is
                inside it changes. */}
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>Travelers will see</Text>
              {problems.length === 0 ? (
                explain(draft).map((line, i) => (
                  <View key={i} style={styles.previewRow}>
                    <Text style={styles.previewBullet}>•</Text>
                    <Text style={styles.previewLine}>{line}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.previewEmpty}>{problems[0]}</Text>
              )}
            </View>

            <Text style={styles.notesLabel}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything the steps above cannot say — for example, medical emergencies handled case by case."
              placeholderTextColor="#9A9A9A"
              multiline
              style={styles.notes}
              maxLength={2000}
            />

            <Text style={styles.foot}>
              You refund travelers from your own Stripe account. Swellyo shows
              this policy but does not process refunds.
            </Text>
          </ScrollView>

          {/* Pinned. See note 3 at the top of the file. */}
          <View style={styles.footer}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              onPress={save}
              disabled={blocked}
              style={({ pressed }) => [
                styles.saveBtn,
                blocked && styles.saveDisabled,
                pressed && !blocked && styles.savePressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: blocked }}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // maxHeight and paddingBottom are applied INLINE, in pixels — see
  // maxSheetHeight. BottomSheetShell paints nothing, so this surface is the
  // sheet: without it the rows are bare text over the screen behind.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },

  grabWrap: { alignItems: 'center', paddingTop: 10, paddingHorizontal: 20, paddingBottom: 14 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 12,
  },
  title: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 20,
    lineHeight: 26,
    color: C.ink,
  },
  sub: {
    marginTop: 4,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: C.muted,
    textAlign: 'center',
  },

  // flexShrink so the list gives up height to the pinned footer once the sheet
  // hits its cap. Without it the ScrollView keeps its full content height and
  // pushes Save off the bottom edge.
  scroll: { flexShrink: 1, borderTopWidth: 1, borderTopColor: C.line },
  scrollBody: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },

  // A card, not a bare row. Three choices that look identical until you find
  // the dot are three choices nobody reads — the selected one has to be
  // findable from across the sheet.
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
    // Still ~58px tall: the two lines of text drive the height, not the icon,
    // so trimming the padding stays clear of the 44pt minimum target that the
    // old `paddingVertical: 10` bare row missed.
  },
  optionOn: { backgroundColor: C.accentSoft, borderColor: C.accent },
  optionPressed: { backgroundColor: C.surfaceMuted },
  optionText: { flex: 1 },
  optionTitle: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 20,
    color: C.ink,
  },
  optionTitleOn: { fontFamily: ff('Inter', '600'), fontWeight: '600' },
  optionSub: {
    marginTop: 2,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12.5,
    lineHeight: 17,
    color: C.muted,
  },

  custom: {
    marginTop: 10,
    marginHorizontal: 2,
    padding: 12,
    borderRadius: 14,
    backgroundColor: C.surfaceMuted,
    gap: 10,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Pushes the remove button to the right edge so it lands in the same place on
  // every row, rather than wherever the text before it happens to end.
  ruleSpacer: { flex: 1 },
  numInput: {
    width: 58,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#FFFFFF',
    textAlign: 'center',
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 15,
    color: C.ink,
    paddingVertical: 0,
  },
  ruleText: { fontFamily: ff('Inter', '400'), fontWeight: '400', fontSize: 13, color: C.muted },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginLeft: -10,
    borderRadius: 10,
  },
  addBtnPressed: { backgroundColor: '#EDEFF0' },
  addText: { fontFamily: ff('Inter', '500'), fontWeight: '500', fontSize: 14, color: C.accent },

  preview: {
    marginTop: 16,
    marginHorizontal: 2,
    backgroundColor: C.surfaceMuted,
    borderRadius: 14,
    padding: 14,
  },
  previewLabel: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: C.muted,
    marginBottom: 8,
  },
  // Bullet in its own column so a wrapped line aligns under the text, not under
  // the dot.
  previewRow: { flexDirection: 'row', gap: 8 },
  previewBullet: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 21, color: C.muted },
  previewLine: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 21,
    color: C.ink,
  },
  previewEmpty: {
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 21,
    color: C.danger,
  },

  notesLabel: {
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: 2,
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 14,
    color: C.ink,
  },
  notes: {
    marginHorizontal: 2,
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    textAlignVertical: 'top',
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 20,
    color: C.ink,
  },

  foot: {
    marginTop: 16,
    marginHorizontal: 2,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 17,
    color: C.muted,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  error: {
    marginBottom: 10,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: C.danger,
    textAlign: 'center',
  },

  saveBtn: {
    height: 52,
    borderRadius: 99,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveDisabled: { opacity: 0.4 },
  // Answers the press. RN has no CSS transition, so this is a step rather than
  // a curve — at 0.98 over one frame that reads as firm, not janky.
  savePressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  saveText: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
