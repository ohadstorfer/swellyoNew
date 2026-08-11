/**
 * The operator's default cancellation policy.
 *
 * Three ready-made policies and a custom one, because that is what every
 * platform that holds money does — Viator has exactly three, Airbnb has two
 * plus a fixed guest protection. Free text was the alternative and it cannot
 * become a line on a trip card or a sentence above the Pay button.
 *
 * TWO THINGS ARE NOT COSMETIC:
 *
 * 1. NOTHING SAVES UNTIL "Save". The rows are edited in local state and written
 *    in one go. A half-typed "6" in a days field must never reach the database
 *    as a real six-day policy.
 *
 * 2. THE COPY NEVER SAYS SWELLYO REFUNDS YOU. On an operator trip the money
 *    sits in the operator's own Stripe account and Swellyo has no refund path
 *    at all, so the policy is a promise the OPERATOR makes. Saying otherwise
 *    would commit us to something we cannot do.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  danger: '#E5484D',
};

const PRESETS: CancellationPreset[] = [
  'flexible',
  'standard',
  'non_refundable',
  'custom',
];

export const CancellationPolicySheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  value: CancellationPolicy;
  onSave: (next: CancellationPolicy) => Promise<void>;
}> = ({ visible, onClose, value, onSave }) => {
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
    <BottomSheetShell visible={visible} onClose={onClose}>
      {/* BottomSheetShell paints nothing — see PayAmountSheet's `surface`.
          Without this the sheet is transparent text over the screen behind. */}
      <View style={styles.surface}>
        <View style={styles.header}>
        <Text style={styles.title}>Cancellation policy</Text>
        <Text style={styles.sub}>
          Used as the starting point for every trip you create. Travelers see it
          before they pay.
        </Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {PRESETS.map(p => (
          <Pressable
            key={p}
            style={styles.row}
            onPress={() => setPreset(p)}
            accessibilityRole="radio"
            accessibilityState={{ selected: preset === p }}
          >
            <Ionicons
              name={preset === p ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={preset === p ? C.accent : '#C4C4C4'}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{PRESET_LABEL[p]}</Text>
              <Text style={styles.rowSub}>{PRESET_BLURB[p]}</Text>
            </View>
          </Pressable>
        ))}

        {preset === 'custom' && (
          <View style={styles.custom}>
            {rules.map((r, i) => (
              <View key={i} style={styles.ruleRow}>
                <TextInput
                  value={String(r.daysBefore)}
                  onChangeText={t => setRule(i, { daysBefore: Number(t.replace(/[^0-9]/g, '')) || 0 })}
                  keyboardType="number-pad"
                  style={styles.numInput}
                  accessibilityLabel="Days before the trip"
                />
                <Text style={styles.ruleText}>days before →</Text>
                <TextInput
                  value={String(r.refundPct)}
                  onChangeText={t => setRule(i, { refundPct: Number(t.replace(/[^0-9]/g, '')) || 0 })}
                  keyboardType="number-pad"
                  style={styles.numInput}
                  accessibilityLabel="Percent refunded"
                />
                <Text style={styles.ruleText}>% back</Text>
                {rules.length > 1 && (
                  <Pressable
                    onPress={() => setRules(prev => prev.filter((_, n) => n !== i))}
                    hitSlop={10}
                    accessibilityLabel="Remove this step"
                  >
                    <Ionicons name="close-circle" size={20} color="#C4C4C4" />
                  </Pressable>
                )}
              </View>
            ))}

            <Pressable onPress={addRule} style={styles.addBtn} accessibilityRole="button">
              <Ionicons name="add" size={16} color={C.accent} />
              <Text style={styles.addText}>Add a step</Text>
            </Pressable>
          </View>
        )}

        {/* What the traveler will read, rebuilt as they type. A policy is easy
            to get backwards, and seeing it in sentences catches that faster
            than any validation message. */}
        {problems.length === 0 && (
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Travelers will see</Text>
            {explain(draft).map((line, i) => (
              <Text key={i} style={styles.previewLine}>• {line}</Text>
            ))}
          </View>
        )}

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

        {problems.map((p, i) => (
          <Text key={i} style={styles.error}>{p}</Text>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={save}
          disabled={problems.length > 0 || saving}
          style={[styles.saveBtn, (problems.length > 0 || saving) && styles.saveDisabled]}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.saveText}>Save</Text>
          )}
        </Pressable>

        <Text style={styles.foot}>
          You refund travelers from your own Stripe account. Swellyo shows this
          policy but does not process refunds.
        </Text>
        </ScrollView>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // No horizontal padding — header and body already carry their own 20.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 12,
  },
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  title: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 18, lineHeight: 24, color: C.ink },
  sub: { marginTop: 4, fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: C.muted },

  body: { maxHeight: 460 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 16 },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: ff('Inter', '500'), fontWeight: '500', fontSize: 15, lineHeight: 20, color: C.ink },
  rowSub: { marginTop: 2, fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 16, color: C.muted },

  custom: { marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 10 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numInput: {
    width: 56,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    textAlign: 'center',
    fontFamily: ff('Inter', '500'),
    fontSize: 14,
    color: C.ink,
    paddingVertical: 0,
  },
  ruleText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: C.muted },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addText: { fontFamily: ff('Inter', '500'), fontSize: 13, color: C.accent },

  preview: {
    marginTop: 14,
    backgroundColor: '#F6F8F9',
    borderRadius: 10,
    padding: 12,
    gap: 3,
  },
  previewLabel: {
    fontFamily: ff('Inter', '600'),
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: C.muted,
    marginBottom: 3,
  },
  previewLine: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 19, color: C.ink },

  notesLabel: {
    marginTop: 18,
    marginBottom: 6,
    fontFamily: ff('Inter', '500'),
    fontSize: 13,
    color: C.ink,
  },
  notes: {
    minHeight: 74,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    textAlignVertical: 'top',
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: C.ink,
  },

  error: { marginTop: 10, fontFamily: ff('Inter', '400'), fontSize: 12.5, lineHeight: 18, color: C.danger },

  saveBtn: {
    marginTop: 18,
    height: 48,
    borderRadius: 99,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveDisabled: { opacity: 0.45 },
  saveText: { fontFamily: ff('Inter', '700'), fontWeight: '700', fontSize: 15, color: '#FFFFFF' },

  foot: {
    marginTop: 14,
    fontFamily: ff('Inter', '400'),
    fontSize: 11.5,
    lineHeight: 17,
    color: C.muted,
    textAlign: 'center',
  },
});
