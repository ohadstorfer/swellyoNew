/**
 * Step 3 — the default cancellation policy (Figma 15244-21648, 15251-57869,
 * 15251-58020).
 *
 * Same three presets and the same `validate()` as CancellationPolicySheet in
 * Settings, so the two can never disagree about what a valid policy is. The
 * rows under a selected preset are drawn from its RULES, not typed copy — the
 * words once drifted from the rules and promised a refund nobody got (see
 * PRESET_LABEL in cancellationPolicy.ts).
 *
 * Custom steps are edited as strings. A number field that snaps "" to 0 turns
 * a cleared box into a real "0 days" step while the operator is still typing.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { saveOperatorSettings } from '../../../../services/trips/operatorSettingsService';
import {
  PRESET_RULES,
  validate,
  type CancellationPolicy,
  type CancellationPreset,
  type CancellationRule,
} from '../../../../services/trips/cancellationPolicy';
import { showErrorAlert } from '../../../../utils/friendlyError';
import { TripIcon } from '../../../../components/trips/tripIcons';
import { textStyle, textStyles } from '../../../../theme/typography';
import { useWizard } from '../OperatorSetupWizard';
import {
  C,
  CheckBadge,
  FOOTER_SPACE,
  SelectCard,
  StepHeading,
  useWizardFooter,
} from '../setupUi';

const PRESETS: { key: CancellationPreset; title: string; blurb: string }[] = [
  { key: 'standard', title: 'Standard', blurb: 'Full refund up to 60 days before the trip.\nNo refund after that.' },
  { key: 'non_refundable', title: 'No Refunds', blurb: 'Payments are non-refundable.' },
  { key: 'custom', title: 'Custom', blurb: 'Create your own refund schedule.' },
];

interface DraftRule {
  days: string;
  pct: string;
}

const toDraft = (r: CancellationRule): DraftRule => ({
  days: String(r.daysBefore),
  pct: String(r.refundPct),
});

// Empty → NaN, which validate() reports, instead of a silent 0.
const toRule = (d: DraftRule): CancellationRule => ({
  daysBefore: d.days.trim() === '' ? NaN : Number(d.days),
  refundPct: d.pct.trim() === '' ? NaN : Number(d.pct),
});

function refundLabel(pct: number): { text: string; color: string } {
  if (pct >= 100) return { text: 'Full refund', color: C.ok };
  if (pct <= 0) return { text: 'No refund', color: C.danger };
  return { text: `${pct}% refund`, color: C.ink };
}

/** The table under a selected preset, straight from its rules. */
function ruleRows(rules: CancellationRule[]): { when: string; pct: number }[] {
  if (rules.length === 0) return [{ when: 'Any cancellation', pct: 0 }];
  const sorted = [...rules].sort((a, b) => b.daysBefore - a.daysBefore);
  const rows = sorted.map(r => ({ when: `${r.daysBefore}+ days before`, pct: r.refundPct }));
  const last = sorted[sorted.length - 1];
  if (last.daysBefore > 0) rows.push({ when: `Under ${last.daysBefore} days`, pct: 0 });
  return rows;
}

export const PolicyStep: React.FC = () => {
  const { settings, reload, next } = useWizard();
  const [preset, setPreset] = useState<CancellationPreset>(settings.policy.preset);
  const [rules, setRules] = useState<DraftRule[]>(() =>
    settings.policy.rules.length > 0
      ? settings.policy.rules.map(toDraft)
      : [{ days: '60', pct: '100' }],
  );
  const [busy, setBusy] = useState(false);

  const draft: CancellationPolicy = {
    preset,
    rules: preset === 'custom' ? rules.map(toRule) : [],
    // Notes are edited in Settings; carried through untouched here.
    notes: settings.policy.notes,
  };
  const problems = validate(draft);

  const save = async (): Promise<boolean> => {
    if (problems.length > 0) return false;
    setBusy(true);
    try {
      await saveOperatorSettings({ policy: draft, confirmPolicy: true });
      await reload();
      return true;
    } catch (e) {
      showErrorAlert('Could not save', e, 'That did not save. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  useWizardFooter({
    label: 'Continue',
    busy,
    disabled: problems.length > 0,
    onPress: async () => {
      if (await save()) next();
    },
    onSaveExit: async () => (problems.length > 0 ? true : save()),
  });

  const setRule = (i: number, patch: Partial<DraftRule>) =>
    setRules(prev => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const addRule = () =>
    setRules(prev => {
      const lowest = Math.min(...prev.map(r => Number(r.days)).filter(Number.isFinite));
      const days = Number.isFinite(lowest) && lowest > 7 ? Math.floor(lowest / 2) : 7;
      return [...prev, { days: String(days), pct: '50' }];
    });

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={FOOTER_SPACE}
      showsVerticalScrollIndicator={false}
    >
      <StepHeading
        title="Set your cancellation policy"
        sub="Choose the default cancellation policy for new trips. You can change it for a specific trip before travelers join."
      />

      <View style={s.list} accessibilityRole="radiogroup">
        {PRESETS.map(p => {
          const on = preset === p.key;
          return (
            <SelectCard
              key={p.key}
              selected={on}
              onPress={on ? undefined : () => setPreset(p.key)}
              accessibilityLabel={`${p.title}. ${p.blurb}`}
            >
              <View style={s.head}>
                <View style={s.headText}>
                  <Text style={s.title}>{p.title}</Text>
                  <Text style={s.blurb}>{p.blurb}</Text>
                </View>
                {on ? <CheckBadge /> : null}
              </View>

              {on && p.key !== 'custom' ? (
                <View style={s.rules}>
                  {ruleRows(PRESET_RULES[p.key as Exclude<CancellationPreset, 'custom'>]).map(r => {
                    const label = refundLabel(r.pct);
                    return (
                      <View key={r.when} style={s.ruleRow}>
                        <Text style={s.when}>{r.when}</Text>
                        <Text style={[s.refund, { color: label.color }]}>{label.text}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {on && p.key === 'custom' ? (
                <View style={[s.rules, s.customRules]}>
                  {rules.map((r, i) => (
                    <View key={i} style={s.editRow}>
                      <View style={s.field}>
                        <Text style={s.fieldLabel}>DAYS BEFORE TRIP</Text>
                        <TextInput
                          value={r.days}
                          onChangeText={t => setRule(i, { days: t.replace(/[^0-9]/g, '').slice(0, 4) })}
                          keyboardType="number-pad"
                          style={s.input}
                          accessibilityLabel={`Step ${i + 1}, days before the trip`}
                        />
                      </View>
                      <View style={s.field}>
                        <Text style={s.fieldLabel}>REFUND %</Text>
                        <TextInput
                          value={r.pct}
                          onChangeText={t => setRule(i, { pct: t.replace(/[^0-9]/g, '').slice(0, 3) })}
                          keyboardType="number-pad"
                          style={s.input}
                          accessibilityLabel={`Step ${i + 1}, percent refunded`}
                        />
                      </View>
                      <Pressable
                        onPress={() => setRules(prev => prev.filter((_, n) => n !== i))}
                        disabled={rules.length === 1}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove step ${i + 1}`}
                        style={({ pressed }) => [
                          s.trash,
                          rules.length === 1 && s.trashOff,
                          pressed && s.pressed,
                        ]}
                      >
                        <TripIcon name="trash-03" size={22} color={C.danger} strokeWidth={1.09} />
                      </Pressable>
                    </View>
                  ))}

                  <Pressable
                    onPress={addRule}
                    accessibilityRole="button"
                    style={({ pressed }) => [s.add, pressed && s.pressed]}
                  >
                    <Text style={s.addText}>+ Add step</Text>
                  </Pressable>

                  {problems[0] ? <Text style={s.error}>{problems[0]}</Text> : null}
                </View>
              ) : null}
            </SelectCard>
          );
        })}
      </View>
    </KeyboardAwareScrollView>
  );
};

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 35 },
  list: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headText: { flex: 1, gap: 2 },
  title: { ...textStyle('MB1', '700'), color: C.ink },
  blurb: { ...textStyles.B3, color: C.ink },

  rules: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.divider, gap: 8 },
  customRules: { gap: 16 },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  when: { ...textStyles.B3, color: C.ink },
  refund: { ...textStyle('B3', '700') },

  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 15 },
  field: { flex: 1 },
  fieldLabel: { ...textStyle('B4', '700'), color: C.muted, height: 24, lineHeight: 24 },
  input: {
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 0,
    ...textStyles.MB2,
    color: C.ink,
  },
  trash: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashOff: { opacity: 0.35 },
  add: {
    height: 54,
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { ...textStyle('MB2', '700'), color: C.ink },
  error: { ...textStyles.B3, color: C.danger },
  pressed: { transform: [{ scale: 0.97 }] },
});
