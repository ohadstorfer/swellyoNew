/**
 * RemoveTravelerSheet — take one person off the trip, and decide their money first.
 *
 * Removing someone used to move no money at all: the banner posted, the chat
 * closed, the push went out, and whatever they had paid stayed with the
 * operator with nothing on any screen to say so.
 *
 * WHY THIS ASKS, WHEN CANCELLING DOES NOT. Cancelling a trip has one possible
 * reason — the operator called it off — so it refunds everyone in full and
 * offers no choice. Removing one person has several, and the money follows the
 * reason: a traveler who backed out is governed by the trip's frozen policy, an
 * operator clearing a spot owes the money back, someone dropped for never
 * finishing their documents is a judgement call. The app cannot tell these
 * apart. So it asks for the *amount* — the only part of the reason with
 * consequences — and pre-computes the policy's answer so the common case is one
 * tap rather than arithmetic.
 *
 * ⚠️ THE ORDER IS REFUND, THEN REMOVE. The operator decided the money while
 * looking at the person; reversing it means hunting for someone who is no
 * longer on the roster. But a refund that fails must NOT trap them: if Stripe
 * is short, the sheet says so and still offers to remove.
 */
import React, { useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { formatExactUsd } from './plan/PlanSections';
import { ff } from '../../theme/fonts';
import {
  explain,
  refundPctFor,
  suggestedRefundUsd,
  type CancellationPolicy,
} from '../../services/trips/cancellationPolicy';
import { refundTraveler, type CancelRefundOutcome } from '../../services/trips/groupTripsService';

const ACCENT = '#05BCD3';
const DANGER = '#B3261E';
const WARN = '#9A5E12';

type Choice = 'everything' | 'policy' | 'custom';

const RadioDot: React.FC<{ selected: boolean }> = ({ selected }) => (
  <View style={[styles.radioRing, selected && styles.radioRingOn]}>
    {selected ? <View style={styles.radioDot} /> : null}
  </View>
);

export const RemoveTravelerSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  tripId: string;
  userId: string;
  travelerName: string;
  /** What this person has paid, net of refunds already issued. 0 = nothing to
   *  decide, and the caller should not open this sheet at all. */
  paidUsd: number;
  /** The trip's frozen policy, or null when it has none. Null suppresses the
   *  policy option entirely — see below. */
  cancellation: CancellationPolicy | null;
  /** `group_trips.start_date`. Without it no window can be measured. */
  tripStartDate: string | null;
  /**
   * Does this viewer hold `money.manage`?
   *
   * A Manager can hold `travelers.remove` without it. They then cannot refund,
   * and removing a paid traveler would strand the money — so the sheet refuses
   * and names who can. The server enforces the same rule; this is the half that
   * explains it.
   */
  canRefund: boolean;
  /**
   * Does the actual removal. Called only after the refund step resolves.
   *
   * Receives what was ACTUALLY sent back — the sum of the refunds that
   * succeeded, not what was asked for — because that number goes into the
   * traveler's removal push and must not promise money that never moved.
   */
  onRemove: (refundedUsd: number) => Promise<void>;
  /** Fired when money moved, so the caller can refetch its ledger. */
  onRefunded?: () => void;
  inline?: boolean;
}> = ({
  visible,
  onClose,
  tripId,
  userId,
  travelerName,
  paidUsd,
  cancellation,
  tripStartDate,
  canRefund,
  onRemove,
  onRefunded,
  inline,
}) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const policyPct = useMemo(
    () => refundPctFor(cancellation, tripStartDate),
    [cancellation, tripStartDate],
  );
  const policyUsd = useMemo(
    () => suggestedRefundUsd({ policy: cancellation, tripStartDate, paidUsd }),
    [cancellation, tripStartDate, paidUsd],
  );
  /**
   * The policy option only exists when the policy gives a real answer.
   *
   * `null` means this trip never stated terms — true of every trip published
   * before the policy columns. Rendering "$0, per the policy" there would
   * invent a term the traveler never agreed to, so the option is simply absent
   * and "Everything" leads instead.
   */
  /**
   * Show the policy option only when it says something "Everything" does not.
   *
   * At 100% the two rows are the same amount, and offering the same number
   * twice makes the operator stop and work out what the difference is — there
   * isn't one. Null (no policy on the trip) suppresses it for a different
   * reason: see `refundPctFor`, null means the trip never stated terms and
   * rendering "$0, per the policy" would invent one.
   */
  const hasPolicy = policyUsd !== null && policyPct !== null && policyUsd !== paidUsd;

  const [choice, setChoice] = useState<Choice>(hasPolicy ? 'policy' : 'everything');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState<'refunding' | 'removing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the refund was refused but the removal is still on the table. */
  const [refundFailed, setRefundFailed] = useState<string | null>(null);
  /**
   * What DID go back when a refund only partly succeeded.
   *
   * A traveler whose deposit was refunded but whose balance was blocked has
   * still had money returned, and "Remove anyway" must tell them about it —
   * reporting 0 there would be a lie in the direction that costs us trust.
   */
  const [partialRefundUsd, setPartialRefundUsd] = useState(0);

  useEffect(() => {
    if (visible) {
      setChoice(hasPolicy ? 'policy' : 'everything');
      setCustom('');
      setBusy(null);
      setError(null);
      setRefundFailed(null);
      setPartialRefundUsd(0);
    }
  }, [visible, hasPolicy]);

  const typed = Number(custom);
  const typedValid = custom.trim() !== '' && Number.isFinite(typed) && typed >= 0 && typed <= paidUsd;

  const amount: number | null =
    choice === 'everything' ? paidUsd : choice === 'policy' ? policyUsd : typedValid ? typed : null;

  const canSubmit = !busy && amount !== null;

  const finishRemoval = async (refundedUsd = 0) => {
    setBusy('removing');
    try {
      await onRemove(refundedUsd);
      onClose();
    } catch (e: any) {
      setBusy(null);
      setError(e?.message ?? 'Could not remove them. Please try again.');
    }
  };

  const submit = async () => {
    if (!canSubmit || amount === null) return;
    setError(null);
    setRefundFailed(null);

    // Zero skips the refund call entirely — no rows, no Stripe, no audit noise.
    if (amount <= 0) {
      await finishRemoval();
      return;
    }

    setBusy('refunding');
    let result: { refunds: CancelRefundOutcome[]; unallocatedUsd: number; error?: string };
    try {
      result = await refundTraveler({ tripId, userId, amountUsd: amount });
    } catch (e: any) {
      setBusy(null);
      // The refund did not happen — but removing them may still be what the
      // operator needs today. Offer it rather than making them start over.
      setRefundFailed(e?.message ?? 'Could not issue the refund.');
      return;
    }

    onRefunded?.();

    // What actually went back, not what was asked for. The push quotes this
    // figure, so it has to be the money that really moved.
    const sentUsd = result.refunds
      .filter(r => r.status === 'succeeded')
      .reduce((sum, r) => sum + r.amountUsd, 0);

    const bad = result.refunds.filter(
      r => r.status === 'failed' || r.status === 'blocked_insufficient_balance',
    );
    if (result.error || bad.length > 0) {
      setBusy(null);
      setPartialRefundUsd(sentUsd);
      setRefundFailed(
        result.error ??
          bad[0]?.message ??
          'Part of the refund did not go through.',
      );
      return;
    }

    await finishRemoval(sentUsd);
  };

  // ── A Manager cannot do this ───────────────────────────────────────
  if (!canRefund) {
    return (
      <BottomSheetShell visible={visible} onClose={onClose} inline={inline}>
        <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabWrap}><View style={styles.grabber} /></View>
          <Text style={styles.heading}>{`Remove ${travelerName}?`}</Text>
          <Text style={styles.sub}>{`They have paid ${formatExactUsd(paidUsd)}.`}</Text>
          <View style={styles.blockBox}>
            <Text style={styles.blockText}>
              Only the trip's operator can remove a traveler who has paid, because only they can
              issue the refund. Ask them to do it, or message {travelerName} first.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.quiet, pressed && styles.pressedScale]}
            accessibilityRole="button"
          >
            <Text style={styles.quietText}>Close</Text>
          </Pressable>
        </View>
      </BottomSheetShell>
    );
  }

  return (
    <BottomSheetShell
      visible={visible}
      onClose={busy ? () => {} : onClose}
      inline={inline}
      avoidKeyboard
      // The body scrolls, so a whole-sheet swipe would fight the ScrollView for
      // the same vertical drag.
      swipeToDismiss={false}
    >
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}><View style={styles.grabber} /></View>

        <Text style={styles.heading}>{`Remove ${travelerName}?`}</Text>
        <Text style={styles.sub}>
          {`They have paid ${formatExactUsd(paidUsd)}. They lose access to the plan and the group chat.`}
        </Text>

        <ScrollView
          style={{ maxHeight: Math.max(180, height * 0.42) }}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
        {cancellation ? (
          <View style={styles.policyBox}>
            <Text style={styles.policyHead}>
              {policyPct !== null
                ? `THIS TRIP'S POLICY · ${policyPct}% AT TODAY'S DATE`
                : "THIS TRIP'S POLICY"}
            </Text>
            {explain(cancellation).map(line => (
              <Text key={line} style={styles.policyLine}>{`• ${line}`}</Text>
            ))}
          </View>
        ) : (
          <Text style={styles.note}>
            This trip never set a cancellation policy, so what you send back is entirely your call.
          </Text>
        )}

        <Pressable
          onPress={() => setChoice('everything')}
          style={({ pressed }) => [styles.option, choice === 'everything' && styles.optionOn, pressed && styles.pressedScale]}
          accessibilityRole="radio"
          accessibilityState={{ selected: choice === 'everything' }}
        >
          <RadioDot selected={choice === 'everything'} />
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>{`Everything · ${formatExactUsd(paidUsd)}`}</Text>
            <Text style={styles.optionSub}>You are removing them, not the other way round.</Text>
          </View>
        </Pressable>

        {hasPolicy && (
          <Pressable
            onPress={() => setChoice('policy')}
            style={({ pressed }) => [styles.option, choice === 'policy' && styles.optionOn, pressed && styles.pressedScale]}
            accessibilityRole="radio"
            accessibilityState={{ selected: choice === 'policy' }}
          >
            <RadioDot selected={choice === 'policy'} />
            <View style={styles.optionBody}>
              <Text style={styles.optionText}>
                {`What the policy gives · ${formatExactUsd(policyUsd!)}`}
              </Text>
              <Text style={styles.optionSub}>{`${policyPct}% at today's date.`}</Text>
            </View>
          </Pressable>
        )}

        <Pressable
          onPress={() => setChoice('custom')}
          style={({ pressed }) => [styles.option, choice === 'custom' && styles.optionOn, pressed && styles.pressedScale]}
          accessibilityRole="radio"
          accessibilityState={{ selected: choice === 'custom' }}
        >
          <RadioDot selected={choice === 'custom'} />
          <View style={styles.optionBody}>
            <Text style={styles.optionText}>Something else</Text>
            <Text style={styles.optionSub}>Any amount, or 0 to refund nothing.</Text>
          </View>
        </Pressable>

        {choice === 'custom' && (
          <>
            <View style={styles.inputWrap}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                style={styles.input}
                value={custom}
                onChangeText={setCustom}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#9A9A9A"
                autoFocus
                accessibilityLabel="Refund amount in dollars"
              />
            </View>
            {custom.trim() !== '' && !typedValid && (
              <Text style={styles.errorLine}>
                {`Enter an amount between $0 and ${formatExactUsd(paidUsd)}.`}
              </Text>
            )}
          </>
        )}
        </ScrollView>

        {refundFailed ? (
          <View style={styles.warnBox} accessibilityLiveRegion="polite">
            <Text style={styles.warnText}>{refundFailed}</Text>
            <Text style={styles.warnText}>
              You can still remove them and refund later from the money card — nothing is refunded twice.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {refundFailed ? (
          <Pressable
            // ⚠️ Wrapped, never passed bare. Pressable hands onPress a
            // GestureResponderEvent, which would arrive as `refundedUsd` and
            // end up quoted at the traveler as their refund amount.
            onPress={() => finishRemoval(partialRefundUsd)}
            disabled={!!busy}
            style={({ pressed }) => [styles.cta, !!busy && styles.ctaOff, pressed && !busy && styles.pressedScale]}
            accessibilityRole="button"
          >
            {busy === 'removing' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>
                {partialRefundUsd > 0
                  ? `Remove anyway (${formatExactUsd(partialRefundUsd)} already sent)`
                  : 'Remove anyway, without refunding'}
              </Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={({ pressed }) => [styles.cta, !canSubmit && styles.ctaOff, pressed && canSubmit && styles.pressedScale]}
            accessibilityRole="button"
          >
            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.ctaText}>
                  {busy === 'refunding' ? 'Refunding…' : 'Removing…'}
                </Text>
              </View>
            ) : (
              <Text style={styles.ctaText}>
                {amount !== null && amount > 0
                  ? `Refund ${formatExactUsd(amount)} and remove`
                  : 'Remove without refunding'}
              </Text>
            )}
          </Pressable>
        )}

        <Pressable
          onPress={busy ? undefined : onClose}
          disabled={!!busy}
          style={({ pressed }) => [styles.quiet, pressed && !busy && styles.pressedScale]}
          accessibilityRole="button"
        >
          <Text style={[styles.quietText, !!busy && styles.quietOff]}>
            {`Keep ${travelerName} on the trip`}
          </Text>
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // ⚠️ BottomSheetShell paints the BACKDROP ONLY — it is headless, and every
  // sheet supplies its own surface. Without these three lines the sheet renders
  // transparent and the screen behind it shows straight through the content.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 6,
    gap: 10,
  },
  // The policy can carry four rules, and with three options plus an amount
  // field the body outgrows a small screen. Only the middle scrolls: the
  // heading says who this is about and the CTA says what it costs, and neither
  // may scroll out of sight on a destructive action.
  scrollBody: { gap: 10 },
  grabWrap: { alignItems: 'center', paddingBottom: 6 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0' },

  heading: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 17, color: '#222B30' },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: -4, lineHeight: 18 },
  note: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', lineHeight: 18 },

  policyBox: {
    borderWidth: 1, borderColor: '#EEEEEE', backgroundColor: '#F6F8F9',
    borderRadius: 10, padding: 12, gap: 4,
  },
  policyHead: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 11, color: '#7B7B7B', letterSpacing: 0.3 },
  policyLine: { fontFamily: ff('Inter', '400'), fontSize: 12.5, color: '#222B30', lineHeight: 18 },

  option: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderColor: '#E4E4E4', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  optionOn: { borderColor: ACCENT, backgroundColor: '#F2FBFC' },
  optionBody: { flex: 1, minWidth: 0, gap: 2 },
  optionText: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 14, color: '#222B30' },
  optionSub: { fontFamily: ff('Inter', '400'), fontSize: 11.5, color: '#7B7B7B', lineHeight: 16 },
  pressedScale: { transform: [{ scale: 0.98 }] },

  radioRing: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#C9C9C9', alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  radioRingOn: { borderColor: ACCENT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderColor: '#E4E4E4', borderRadius: 12, paddingHorizontal: 14,
  },
  dollar: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 16, color: '#7B7B7B' },
  input: {
    fontFamily: ff('Inter', '500'), fontWeight: '500' as const, flex: 1,
    fontSize: 16, color: '#222B30', paddingVertical: 12, paddingLeft: 4,
  },

  blockBox: {
    borderWidth: 1, borderColor: '#EBDBC2', backgroundColor: '#F7EDDE',
    borderRadius: 10, padding: 12,
  },
  blockText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: WARN, lineHeight: 18 },

  warnBox: {
    borderWidth: 1, borderColor: '#EBDBC2', backgroundColor: '#F7EDDE',
    borderRadius: 10, padding: 11, gap: 6,
  },
  warnText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: WARN, lineHeight: 18 },

  errorLine: { fontFamily: ff('Inter', '400'), fontSize: 12, color: DANGER },
  errorBox: {
    borderWidth: 1, borderColor: DANGER, backgroundColor: '#FDECEA',
    borderRadius: 10, padding: 11,
  },
  errorText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: DANGER, lineHeight: 18 },

  cta: {
    backgroundColor: DANGER, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  ctaOff: { opacity: 0.45 },
  ctaText: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 15, color: '#FFFFFF' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  quiet: { alignItems: 'center', paddingVertical: 12 },
  quietText: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 14, color: '#7B7B7B' },
  quietOff: { opacity: 0.4 },
});
