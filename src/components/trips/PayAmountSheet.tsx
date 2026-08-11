/**
 * PayAmountSheet — how much of what's left do you want to pay?
 *
 * Opens from the Plan tab's Payment section. Two choices, defaulting to the
 * full amount because that is what most travelers came to do:
 *
 *  • Full — everything still owed on the current payment step.
 *  • Part of it — a typed USD amount. The server clamps whatever is sent to
 *    what is actually outstanding (payments-checkout), so this input is a
 *    request, never an authority; validation here exists to keep honest people
 *    from a round trip, not to enforce anything.
 *
 * ⚠️ NEVER opened for a `deposit` step. A deposit is all-or-nothing — it is
 * the threshold that makes the booking real, so part-paying it commits the
 * traveler to nothing while holding a seat. TripDetailScreen sends a deposit
 * straight to Checkout instead, and payments-checkout rejects a short
 * `amountUsd` on a deposit outright. Only the balance is freely part-payable.
 *
 * ⚠️ It deliberately explains NOTHING about how the trip's total is split.
 * The first version did — "Pay the deposit · $500 · $2,000 later" — and on
 * device that read as the deposit arriving out of nowhere, because the card
 * behind it only ever talked about the trip total. The split now lives in
 * PaymentSection, stated once, where the two figures can sit next to each
 * other; this sheet just names the step and the number it will charge. If you
 * find yourself adding a sentence here, add it there instead.
 *
 * The sheet only CHOOSES the amount. The caller closes it and runs the same
 * checkout path the task rows use (gates against double payment included) —
 * nothing here talks to Stripe.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { formatExactUsd } from './plan/PlanSections';
import { ff } from '../../theme/fonts';
import { approxPaymentNote, formatApproxLocal } from '../../utils/currency';
import { useViewer } from '../../hooks/useViewer';

const ACCENT = '#05BCD3';

const RadioDot: React.FC<{ selected: boolean }> = ({ selected }) => (
  <View style={[styles.radioRing, selected && styles.radioRingOn]}>
    {selected ? <View style={styles.radioDot} /> : null}
  </View>
);

export const PayAmountSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** The step this payment goes against — "Deposit" / "Final payment". Names
   *  what the money is for, same reason PaymentStatusSheet carries a title. */
  stepTitle: string;
  /** Still owed on this step, canonical USD. */
  outstandingUsd: number;
  /** Called with the chosen amount; `undefined` means the full outstanding
   *  amount. The caller owns closing + the checkout flow. */
  onPay: (amountUsd?: number) => void;
}> = ({
  visible,
  onClose,
  stepTitle,
  outstandingUsd,
  onPay,
}) => {
  const insets = useSafeAreaInsets();
  const viewer = useViewer();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');

  // A fresh open starts from the default choice — a sheet that remembers last
  // week's half-typed number reads as a glitch, not a memory.
  useEffect(() => {
    if (visible) {
      setMode('full');
      setAmount('');
    }
  }, [visible]);

  // The hint is an ESTIMATE at TODAY's rate, never the trip's frozen one: the
  // charge is in USD and the traveler's bank will convert it at whatever the
  // rate is on the day, not at one frozen when the operator set the price.
  const approx = (usd: number) => formatApproxLocal(usd, viewer);
  const currencyNote = approxPaymentNote(viewer);

  const typed = parseInt(amount, 10);
  const typedValid = Number.isFinite(typed) && typed >= 1;
  // More than what's left simply becomes "everything" — refusing the tap over
  // an amount the server would clamp anyway is friction with no payoff. The
  // caption under the input says so the moment it happens.
  const typedIsFull = typedValid && typed >= outstandingUsd;
  const canContinue = mode === 'full' || typedValid;

  // The literal figure, not "Pay the deposit". On a step that has been part-
  // paid the two are different numbers ($500 left of a $1,000 deposit), and
  // naming the step here was read as "this button charges the whole deposit".
  // The step and its size are already stated above and in the Payment card.
  const approxFull = approx(outstandingUsd);
  const approxTyped = typedValid && !typedIsFull ? approx(typed) : null;

  const handleContinue = () => {
    if (!canContinue) return;
    if (mode === 'full' || typedIsFull) onPay(undefined);
    else onPay(typed);
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}>
          <View style={styles.grabber} />
        </View>

        <Text style={styles.heading}>Pay now</Text>
        <Text style={styles.sub}>{`${stepTitle} · ${formatExactUsd(outstandingUsd)} left`}</Text>

        <Pressable
          onPress={() => setMode('full')}
          style={({ pressed }) => [
            styles.option,
            mode === 'full' && styles.optionOn,
            pressed && styles.pressedScale,
          ]}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'full' }}
        >
          <RadioDot selected={mode === 'full'} />
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>{`Pay ${formatExactUsd(outstandingUsd)}`}</Text>
            {approxFull ? <Text style={styles.optionSub}>{`About ${approxFull}`}</Text> : null}
          </View>
        </Pressable>

        <Pressable
          onPress={() => setMode('partial')}
          style={({ pressed }) => [
            styles.option,
            mode === 'partial' && styles.optionOn,
            pressed && styles.pressedScale,
          ]}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'partial' }}
        >
          <RadioDot selected={mode === 'partial'} />
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Pay part of it</Text>
            <Text style={styles.optionSub}>Choose how much</Text>
          </View>
        </Pressable>

        {mode === 'partial' ? (
          <View style={styles.amountWrap}>
            <Text style={styles.amountLabel}>Amount · USD</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={t => setAmount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              placeholder={String(Math.floor(outstandingUsd / 2) || 1)}
              placeholderTextColor="#9A9A9A"
            />
            <Text style={styles.amountHint}>
              {typedIsFull
                ? `That's the whole ${formatExactUsd(outstandingUsd)}`
                : approxTyped
                  ? `About ${approxTyped}`
                  : `Up to ${formatExactUsd(outstandingUsd)}`}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleContinue}
          disabled={!canContinue}
          style={({ pressed }) => [
            styles.continueBtn,
            pressed && canContinue && styles.pressedScale,
            !canContinue && styles.continueDisabled,
          ]}
        >
          <Text style={styles.continueText}>Continue to payment</Text>
        </Pressable>

        {/* Repeated here, not just on the Plan tab: this sheet covers that
            note, and this button is the last thing tapped before Checkout. */}
        {currencyNote ? <Text style={styles.currencyNote}>{currencyNote}</Text> : null}
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // BottomSheetShell is headless — every consumer paints its own surface.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
  },
  currencyNote: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 16,
    color: '#717680',
    textAlign: 'center',
    marginTop: 10,
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  heading: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    color: '#181D27',
    marginTop: 8,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#535862',
    marginTop: 4,
    marginBottom: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  optionOn: { borderColor: ACCENT, backgroundColor: '#F4FCFD' },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 15, color: '#181D27' },
  optionSub: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: '#535862' },
  radioRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioRingOn: { borderColor: ACCENT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },
  amountWrap: { marginTop: 2, marginBottom: 6 },
  amountLabel: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 13,
    color: '#535862',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    color: '#181D27',
  },
  amountHint: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 16,
    color: '#9A9A9A',
    marginTop: 6,
  },
  // The app's one primary CTA (same clothes as TravelerPriceSheet's Save).
  continueBtn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  continueDisabled: { opacity: 0.5 },
  continueText: {
    fontFamily: ff('Montserrat', '600'),
    fontWeight: '600',
    fontSize: 16,
    color: '#FFFFFF',
  },
  pressedScale: { transform: [{ scale: 0.98 }] },
});
