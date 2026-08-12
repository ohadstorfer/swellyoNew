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
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { formatExactUsd } from './plan/PlanSections';
import { ff } from '../../theme/fonts';
import { approxPaymentNote, formatApproxLocal } from '../../utils/currency';
import { explain, summarise, type CancellationPolicy } from '../../services/trips/cancellationPolicy';
import { useViewer } from '../../hooks/useViewer';

const ACCENT = '#05BCD3';

// Same open/close feel as the Plan tab's update accordion (AdminUpdateUI): the
// iOS-drawer curve, one duration, close runs it in reverse so a tap mid-slide
// retargets instead of restarting.
const ACCORDION_MS = 260;
const ACCORDION_EASE = Easing.bezier(0.32, 0.72, 0, 1);

const RadioDot: React.FC<{ selected: boolean }> = ({ selected }) => (
  <View style={[styles.radioRing, selected && styles.radioRingOn]}>
    {selected ? <View style={styles.radioDot} /> : null}
  </View>
);

/**
 * The cancellation policy: one line always, every step behind a tap.
 *
 * The summary alone was not enough — "then less in 2 more steps" names the
 * steps without saying what they are, and this is the last screen before money
 * moves. The full list is not shown outright because the terms are longer than
 * the choice this sheet exists to make, and burying the Continue button under
 * them is how a payment sheet stops looking like one.
 *
 * ⚠️ Every word comes from `summarise()` / `explain()` over the trip's FROZEN
 * policy — the same functions the consent sheet records against
 * (`tripPolicyConsent.consentText`) and the same ones the operator's refund
 * sheet reads. This component must never phrase a rule of its own, or what a
 * traveler was shown and what we can prove we showed them drift apart.
 *
 * Height is animated (not native-driven, because height cannot be) off a
 * measured copy of the card: the sheet is bottom-anchored, so an unanimated
 * open makes the whole surface jump up the screen under the user's thumb.
 */
const CancellationDisclosure: React.FC<{
  policy: CancellationPolicy;
  open: boolean;
  onToggle: () => void;
}> = ({ policy, open, onToggle }) => {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [height, setHeight] = useState(0);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: ACCORDION_MS,
      easing: ACCORDION_EASE,
      useNativeDriver: false,
    }).start();
  }, [open, progress]);

  const notes = policy.notes?.trim() || null;
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View>
      {/* "Refunds come from the operator" is not padding: on an operator trip
          the money sits in their Stripe account and Swellyo has no refund path
          at all, so a traveler must not read this as our promise. */}
      <Text style={styles.policyNote}>
        {`Cancellation: ${summarise(policy)} Refunds come from the operator, not Swellyo.`}
      </Text>

      <Pressable
        onPress={onToggle}
        hitSlop={10}
        style={({ pressed }) => [styles.policyToggle, pressed && styles.pressedFade]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide the full cancellation policy' : 'See the full cancellation policy'}
      >
        <Text style={styles.policyToggleText}>{open ? 'Hide full policy' : 'See full policy'}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={14} color={ACCENT} />
        </Animated.View>
      </Pressable>

      {/* The measured copy is absolutely positioned so its natural height is
          independent of the clip that is animating around it. */}
      <Animated.View
        style={[styles.policyClip, { height: Animated.multiply(progress, height), opacity: progress }]}
      >
        <View
          style={styles.policyMeasure}
          onLayout={e => {
            const next = e.nativeEvent.layout.height;
            if (next && Math.abs(next - height) > 0.5) setHeight(next);
          }}
        >
          <View style={styles.policyCard}>
            {explain(policy).map(line => (
              <View key={line} style={styles.stepRow}>
                <View style={styles.bullet} />
                <Text style={styles.stepText}>{line}</Text>
              </View>
            ))}
            {notes ? <Text style={styles.stepNotes}>{notes}</Text> : null}
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

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
  /**
   * The trip's frozen cancellation policy, or null when it has none.
   *
   * Null is a real state — every trip published before the policy columns
   * existed has none — and it renders NOTHING rather than a default. Showing
   * "no refunds" for a trip that never said so would invent terms.
   */
  cancellation?: CancellationPolicy | null;
}> = ({
  visible,
  onClose,
  stepTitle,
  outstandingUsd,
  onPay,
  cancellation,
}) => {
  const insets = useSafeAreaInsets();
  const viewer = useViewer();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);

  // A fresh open starts from the default choice — a sheet that remembers last
  // week's half-typed number reads as a glitch, not a memory. The policy folds
  // back too: the sheet is about the amount, and it should open looking like it.
  useEffect(() => {
    if (visible) {
      setMode('full');
      setAmount('');
      setPolicyOpen(false);
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

        {/* One line by default, the whole step list one tap away. It has to
            stop a refund rule being a surprise AFTER paying — the Stripe page
            they are about to land on says nothing about the operator's terms. */}
        {cancellation ? (
          <CancellationDisclosure
            policy={cancellation}
            open={policyOpen}
            onToggle={() => setPolicyOpen(v => !v)}
          />
        ) : null}

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
  policyNote: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 16,
    color: '#717680',
    textAlign: 'center',
    marginTop: 10,
  },
  policyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  policyToggleText: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: ACCENT,
  },
  // Clips the measured card while its height animates. `overflow: hidden` is
  // what makes the steps slide out from under the toggle rather than pop in.
  policyClip: { overflow: 'hidden', width: '100%' },
  policyMeasure: { position: 'absolute', left: 0, right: 0, top: 0 },
  // Same clothes as the consent sheet's terms card: the steps a traveler
  // agreed to and the steps they can re-read must look like one document.
  policyCard: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // Aligned to the first line's cap height, not centred on the row: a step that
  // wraps to two lines would otherwise float its dot to the middle.
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#9A9A9A', marginTop: 7 },
  stepText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#414651',
  },
  stepNotes: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#414651',
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
  // A text link, not a button: scaling 13px type reads as a wobble, so the
  // press state is a dim instead.
  pressedFade: { opacity: 0.6 },
});
