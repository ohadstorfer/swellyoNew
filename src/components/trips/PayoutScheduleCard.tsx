import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// ff() picks the real weighted family file. A bare `fontFamily: 'Inter'` plus
// `fontWeight: '600'` renders Regular on iOS — see ConnectStripeCard.
import { ff } from '../../theme/fonts';
import {
  INTERVALS,
  INTERVAL_BLURB,
  INTERVAL_LABEL,
  WEEKDAYS,
  amountIn,
  canPayOutNow,
  describeClearing,
  describeNothingToPayOut,
  describeSweep,
  firstPayoutCaveat,
  formatMoney,
  type PayoutInterval,
  type PayoutStatus,
} from '../../services/trips/payoutSchedule';
import {
  fetchPayoutStatus,
  payOutNow,
  savePayoutSchedule,
} from '../../services/trips/payoutsService';

/**
 * Keep a typed day-number inside its range as it is typed.
 *
 * `maxLength={2}` is not a range check — it happily accepts 42. Clamping in the
 * change handler is what actually makes an invalid value unreachable, so the
 * operator never gets a rejection for something the form should not have taken.
 *
 * Empty stays empty so the field can be cleared and retyped.
 */
function clampDay(raw: string, min: number, max: number): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits === '') return '';
  return String(Math.min(max, Math.max(min, Number(digits))));
}

/**
 * When the operator's money reaches their bank, and how to change it.
 *
 * Mirrors `PayoutScheduleCard` in the operator dashboard — same two clocks,
 * same rule about the Pay out button. The two codebases share nothing on
 * purpose (CLAUDE.md); change both.
 *
 * The two clocks are shown SEPARATELY and in order (clear, then sweep) because
 * an operator asking "where is my money" has to be able to tell which one is
 * holding it. See the header of `services/trips/payoutSchedule.ts`.
 *
 * The Pay out button appears ONLY on a manual schedule. On an automatic one the
 * available balance is swept the moment it clears, so the button would read
 * "Pay out $0.00" almost always — which reads as money gone missing, not as a
 * healthy account. Stripe's own Express Dashboard hides it for the same reason.
 */
export const PayoutScheduleCard: React.FC = () => {
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [noAccount, setNoAccount] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Seeded from the server and re-seeded after every save: Stripe may not store
  // what we sent — it clamps `delay_days` to the account's country minimum — so
  // the form must show what is true, not what was asked for.
  const [mode, setMode] = useState<PayoutInterval>('daily');
  const [weekly, setWeekly] = useState('friday');
  const [monthly, setMonthly] = useState('1');
  const [delay, setDelay] = useState('');

  const seed = useCallback((s: PayoutStatus) => {
    setStatus(s);
    setMode(s.schedule.interval ?? 'daily');
    setWeekly(s.schedule.weeklyAnchor ?? 'friday');
    setMonthly(s.schedule.monthlyAnchor === null ? '1' : String(s.schedule.monthlyAnchor));
    setDelay(s.schedule.delayDays === null ? '' : String(s.schedule.delayDays));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetchPayoutStatus();
    if (!res.ok) {
      // Not connected is not an error worth showing here — the Connect card
      // directly above already explains it. Hide this card entirely.
      if (res.code === 'no_account') setNoAccount(true);
      else setErr(res.error);
    } else {
      seed(res.status);
    }
    setLoading(false);
  }, [seed]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!status) return;
    setSaving(true);
    setErr(null);
    setNote(null);
    const parsedDelay = Number(delay);
    const parsedMonthly = Number(monthly);
    const res = await savePayoutSchedule({
      interval: mode,
      // Sent only when applicable AND actually different. Echoing the value
      // back on every save turns a display into a write, and Stripe rejects the
      // field outright on a manual schedule.
      ...(mode !== 'manual' &&
      delay.trim() !== '' &&
      Number.isInteger(parsedDelay) &&
      parsedDelay !== status.schedule.delayDays
        ? { delayDays: parsedDelay }
        : {}),
      ...(mode === 'weekly' ? { weeklyAnchor: weekly } : {}),
      ...(mode === 'monthly' && Number.isInteger(parsedMonthly)
        ? { monthlyAnchor: parsedMonthly }
        : {}),
    });
    setSaving(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setNote('Saved.');
    await load();
  }, [status, mode, weekly, monthly, delay, load]);

  const payNow = useCallback(async () => {
    setPaying(true);
    setErr(null);
    setNote(null);
    const res = await payOutNow();
    setPaying(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setNote(`${res.formatted} is on its way to your bank.`);
    await load();
  }, [load]);

  if (noAccount) return null;

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color="#7B7B7B" />
      </View>
    );
  }

  if (!status) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Payouts</Text>
        <Text style={styles.error}>{err ?? 'Could not load your payout settings.'}</Text>
      </View>
    );
  }

  // An emptied number box parses as 0. Sending that earns a Stripe rejection
  // the operator cannot act on, so an invalid anchor blocks the save instead.
  const monthlyOk =
    Number.isInteger(Number(monthly)) && Number(monthly) >= 1 && Number(monthly) <= 31;

  const dirty =
    (mode !== 'monthly' || monthlyOk) &&
    (mode !== (status.schedule.interval ?? 'daily') ||
    (mode === 'weekly' && weekly !== (status.schedule.weeklyAnchor ?? 'friday')) ||
    (mode === 'monthly' && Number(monthly) !== (status.schedule.monthlyAnchor ?? 1)) ||
      (mode !== 'manual' && delay.trim() !== '' && Number(delay) !== status.schedule.delayDays));

  const editable = status.payoutsEnabled && !saving;
  const clearing = describeClearing(status.schedule);
  const caveat = firstPayoutCaveat(status.hasEverPaidOut);
  const availableNow = amountIn(status.available, status.currency);
  const currency = status.currency ?? 'usd';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Payouts</Text>

      <Text style={styles.muted}>
        {clearing ?? 'Stripe has not told us how long money takes to clear on this account yet.'}
      </Text>
      <Text style={[styles.muted, { marginBottom: caveat ? 8 : 16 }]}>
        {describeSweep(status.schedule)}
      </Text>

      {caveat ? <Text style={styles.caveat}>{caveat}</Text> : null}

      {!status.payoutsEnabled ? (
        <Text style={styles.error}>
          Stripe is not paying out to this account yet, so the schedule cannot be changed.
        </Text>
      ) : null}

      {INTERVALS.map(i => {
        const on = mode === i;
        return (
          <Pressable
            key={i}
            onPress={() => { if (editable) { setMode(i); setNote(null); } }}
            disabled={!editable}
            style={({ pressed }) => [
              styles.option,
              !editable && styles.disabled,
              // Press feedback: the row must feel like it heard the tap.
              pressed && editable && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.radio, on && styles.radioOn]}>
              {on ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>{INTERVAL_LABEL[i]}</Text>
              <Text style={styles.optionBlurb}>{INTERVAL_BLURB[i]}</Text>
            </View>
          </Pressable>
        );
      })}

      {mode === 'weekly' ? (
        <View style={styles.inlineRow}>
          <Text style={styles.inlineLabel}>Send on</Text>
          <View style={styles.chips}>
            {WEEKDAYS.map(d => (
              <Pressable
                key={d}
                onPress={() => { if (editable) { setWeekly(d); setNote(null); } }}
                disabled={!editable}
                style={({ pressed }) => [
                  styles.chip,
                  weekly === d && styles.chipOn,
                  pressed && editable && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.chipText, weekly === d && styles.chipTextOn]}>
                  {d.slice(0, 3).toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {mode === 'monthly' ? (
        <View style={styles.inlineRow}>
          <Text style={styles.inlineLabel}>Send on day</Text>
          <TextInput
            value={monthly}
            onChangeText={t => { setMonthly(clampDay(t, 1, 31)); setNote(null); }}
            keyboardType="number-pad"
            editable={editable}
            style={styles.numInput}
            maxLength={2}
            accessibilityLabel="Day of the month, 1 to 31"
          />
          <Text style={styles.inlineHint}>of each month, 1–31 (29–31 becomes the last day)</Text>
        </View>
      ) : null}

      {mode !== 'manual' ? (
        <View style={styles.inlineRow}>
          <Text style={styles.inlineLabel}>Hold money for</Text>
          <TextInput
            value={delay}
            onChangeText={t => { setDelay(clampDay(t, 1, 31)); setNote(null); }}
            keyboardType="number-pad"
            editable={editable}
            style={styles.numInput}
            maxLength={2}
            accessibilityLabel="Days before money becomes available, 1 to 31"
          />
          {/* The range is stated because it is not guessable. Stripe also
              enforces its own country floor on top of this and returns a
              precise message; we do not duplicate that rule here, we just stop
              the values that are never valid. */}
          <Text style={styles.inlineHint}>days after a traveler pays (1–31)</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => void save()}
        disabled={!dirty || !editable}
        style={({ pressed }) => [
          styles.primaryBtn,
          (!dirty || !editable) && styles.disabled,
          pressed && dirty && editable && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save schedule'}</Text>
      </Pressable>

      {status.schedule.interval === 'manual' ? (
        <View style={styles.payoutBlock}>
          {canPayOutNow(status) ? (
            <>
              <Text style={styles.readyLine}>
                {formatMoney(availableNow, currency)} is cleared and ready to send.
              </Text>
              <Pressable
                onPress={() => void payNow()}
                disabled={paying}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  paying && styles.disabled,
                  pressed && !paying && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.secondaryBtnText}>
                  {paying ? 'Sending…' : `Pay out ${formatMoney(availableNow, currency)} now`}
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.muted}>{describeNothingToPayOut(status)}</Text>
          )}
        </View>
      ) : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}
      {err ? <Text style={styles.error}>{err}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E3E3',
    padding: 14,
  },
  title: {
    fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    fontSize: 15,
    color: '#222B30',
    marginBottom: 6,
  },
  muted: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#7B7B7B',
  },
  caveat: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#222B30',
    marginBottom: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  optionText: { flex: 1 },
  optionLabel: {
    fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    fontSize: 14,
    color: '#222B30',
    lineHeight: 18,
  },
  optionBlurb: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#7B7B7B',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#C9C9C9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioOn: { borderColor: '#0788B0' },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#0788B0',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    marginBottom: 6,
  },
  inlineLabel: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#7B7B7B',
  },
  inlineHint: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#7B7B7B',
    flexShrink: 1,
  },
  numInput: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#222B30',
    borderWidth: 1,
    borderColor: '#E3E3E3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    minWidth: 56,
    textAlign: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E3E3E3',
  },
  chipOn: { borderColor: '#0788B0', backgroundColor: '#E8F5FA' },
  chipText: { fontFamily: ff('Inter', '500'),
    ...(Platform.OS === 'web' ? { fontWeight: '500' as const } : null), fontSize: 11, color: '#7B7B7B' },
  chipTextOn: { color: '#0788B0' },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: '#0788B0',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null), fontSize: 14, color: '#FFFFFF' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#0788B0',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnText: { fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null), fontSize: 14, color: '#0788B0' },
  payoutBlock: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E3E3E3',
  },
  readyLine: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#222B30',
    marginBottom: 10,
  },
  disabled: { opacity: 0.5 },
  note: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#2E7D32',
    marginTop: 10,
  },
  error: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: '#E5484D',
    marginTop: 10,
  },
});

export default PayoutScheduleCard;
