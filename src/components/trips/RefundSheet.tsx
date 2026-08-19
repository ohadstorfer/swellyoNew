/**
 * RefundSheet — the operator sends money back.
 *
 * Opens from a traveler's Money card on the Dashboard tab. Mirrors
 * `operator-dashboard/src/components/RefundDialog.tsx`; the two apps share no
 * code, so a change to how a refund is decided belongs in both.
 *
 * Three things this insists on, because money is not undoable:
 *
 * 1. **The frozen policy is shown, not linked.** The operator is applying terms
 *    the traveler already agreed to. Making them tap to read those terms means
 *    they won't. A trip with no policy says so — that is information, not an
 *    empty state.
 * 2. **Partial is a first-class choice.** Most real refunds are partial (the
 *    policy keeps a share), so it sits next to Full, not behind a toggle.
 * 3. **A blocked refund shows both numbers.** "Refund failed" sends the
 *    operator to support; "needs $600, you have $240" tells them to wait for a
 *    payout. Only the server knows the balance, so that message comes from it.
 *
 * The sheet owns the whole action, unlike PayAmountSheet which only picks an
 * amount: a refund has no second step, and its failure modes are things the
 * operator must read right here rather than in an alert that replaces the form.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { formatExactUsd } from './plan/PlanSections';
import { ff } from '../../theme/fonts';
import { explain, type CancellationPolicy } from '../../services/trips/cancellationPolicy';
import { issueRefund } from '../../services/trips/refundsService';

const ACCENT = '#05BCD3';
const DANGER = '#B3261E';

const RadioDot: React.FC<{ selected: boolean }> = ({ selected }) => (
  <View style={[styles.radioRing, selected && styles.radioRingOn]}>
    {selected ? <View style={styles.radioDot} /> : null}
  </View>
);

export const RefundSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  travelerName: string;
  /** The payment being reversed. A refund is always against ONE payment. */
  paymentEventId: string;
  /** What that payment was, canonical USD. The refund cannot exceed it. */
  paidUsd: number;
  /**
   * The trip's frozen cancellation policy, or null when it has none.
   *
   * Null is a real state — every trip published before the policy columns
   * existed has none — and it renders a sentence saying so rather than a
   * default. Showing "no refunds" for a trip that never said so invents terms.
   */
  cancellation?: CancellationPolicy | null;
  /**
   * Fired after a refund actually succeeded, so the caller can refetch — and
   * with the amount Stripe really returned, so it can SAY SO.
   *
   * The ledger row is written by `stripe-webhook` a second or two later, not by
   * us. For that gap the sheet simply closing was indistinguishable from a
   * button that did nothing, on the one action in this app that cannot be
   * undone. It is the server's figure, never the typed one: a full refund
   * reverses whatever is actually left, which can be less than was asked for.
   */
  onRefunded: (amountUsd: number) => void;
  /**
   * Render as a LAYER inside an already-presented Modal instead of its own.
   *
   * ⚠️ Required when this opens from the document-review screen. A sheet
   * mounted as a sibling of a presented Modal is resolved by RN to the root
   * view controller — which is already presenting — so UIKit refuses and the
   * sheet only surfaces once the operator backs out of the traveler.
   */
  inline?: boolean;
}> = ({
  visible,
  onClose,
  travelerName,
  paymentEventId,
  paidUsd,
  cancellation,
  onRefunded,
  inline,
}) => {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh open starts clean. A sheet still showing last week's error, or a
  // half-typed amount, reads as a glitch rather than a memory.
  useEffect(() => {
    if (visible) {
      setMode('full');
      setAmount('');
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const typed = Number(amount);
  const typedValid = Number.isFinite(typed) && typed > 0 && typed <= paidUsd;
  const canSubmit = !busy && (mode === 'full' || typedValid);

  const policyLines = cancellation ? explain(cancellation) : [];

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const result = await issueRefund({
      paymentEventId,
      // Send nothing for a full refund: the server then reverses whatever is
      // actually left, which stays correct even if someone issued a partial
      // refund from the Stripe dashboard since this screen loaded.
      ...(mode === 'full' ? {} : { amountUsd: typed }),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });

    setBusy(false);
    if (result.ok) {
      onRefunded(result.amountUsd);
      onClose();
      return;
    }
    setError(result.error);
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard inline={inline}>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}>
          <View style={styles.grabber} />
        </View>

        <Text style={styles.heading}>Refund {travelerName}</Text>
        <Text style={styles.sub}>{`${formatExactUsd(paidUsd)} paid`}</Text>

        <Text style={styles.note}>
          This comes out of your Stripe balance. Swellyo's commission comes back to you in
          proportion. It cannot be undone.
        </Text>

        <View style={styles.policyBox}>
          <Text style={styles.policyHead}>This trip's cancellation policy</Text>
          {policyLines.length ? (
            policyLines.map(line => (
              <Text key={line} style={styles.policyLine}>
                {`• ${line}`}
              </Text>
            ))
          ) : (
            <Text style={styles.policyLine}>
              No policy was set on this trip. What you refund here is your call.
            </Text>
          )}
        </View>

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
          <Text style={styles.optionText}>{`Everything · ${formatExactUsd(paidUsd)}`}</Text>
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
          <Text style={styles.optionText}>Part of it</Text>
        </Pressable>

        {mode === 'partial' && (
          <View style={styles.inputWrap}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#9A9A9A"
              autoFocus
              accessibilityLabel="Refund amount in dollars"
            />
          </View>
        )}
        {mode === 'partial' && amount.trim() !== '' && !typedValid && (
          <Text style={styles.errorLine}>
            {`Enter an amount between $0.01 and ${formatExactUsd(paidUsd)}.`}
          </Text>
        )}

        <TextInput
          style={styles.reason}
          value={reason}
          onChangeText={setReason}
          placeholder="Reason (optional — for your records)"
          placeholderTextColor="#9A9A9A"
          multiline
          maxLength={500}
          accessibilityLabel="Reason for the refund"
        />

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.cta,
            !canSubmit && styles.ctaOff,
            pressed && canSubmit && styles.pressedScale,
          ]}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaText}>
              {mode === 'full'
                ? `Refund ${formatExactUsd(paidUsd)}`
                : typedValid
                  ? `Refund ${formatExactUsd(typed)}`
                  : 'Refund'}
            </Text>
          )}
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // ⚠️ BottomSheetShell paints the BACKDROP ONLY — it is headless, and every
  // sheet supplies its own surface. Without these three lines the sheet renders
  // transparent and the screen behind it shows straight through the content.
  // Was missing here since this sheet was written; caught 2026-08-19 when a
  // sheet copied from it shipped the same hole.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 6,
    gap: 10,
  },
  grabWrap: { alignItems: 'center', paddingBottom: 6 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0' },

  heading: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 17, color: '#222B30' },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: -4 },
  note: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', lineHeight: 18 },

  policyBox: {
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#F6F8F9',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  policyHead: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 12, color: '#7B7B7B' },
  policyLine: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#222B30', lineHeight: 18 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  optionOn: { borderColor: ACCENT, backgroundColor: '#F2FBFC' },
  optionText: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 14, color: '#222B30' },
  // Instant feedback that the sheet heard the tap. Subtle on purpose — a big
  // scale on a full-width row reads as the whole sheet moving.
  pressedScale: { transform: [{ scale: 0.98 }] },

  radioRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#C9C9C9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioRingOn: { borderColor: ACCENT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  dollar: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 16, color: '#7B7B7B' },
  input: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500' as const,
    flex: 1,
    fontSize: 16,
    color: '#222B30',
    paddingVertical: 12,
    paddingLeft: 4,
  },

  reason: {
    fontFamily: ff('Inter', '400'),
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#222B30',
    minHeight: 60,
    textAlignVertical: 'top',
  },

  errorLine: { fontFamily: ff('Inter', '400'), fontSize: 12, color: DANGER },
  errorBox: {
    borderWidth: 1,
    borderColor: DANGER,
    backgroundColor: '#FDECEA',
    borderRadius: 10,
    padding: 11,
  },
  errorText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: DANGER, lineHeight: 18 },

  cta: {
    backgroundColor: DANGER,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ctaOff: { opacity: 0.45 },
  ctaText: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 15, color: '#FFFFFF' },
});
