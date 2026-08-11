/**
 * TravelerOnboardingScreen — the guided flow an approved traveler runs before
 * they are really on an operator trip.
 *
 * Spec:    docs/specs/operator-trips/traveler-onboarding.md
 * Screens: docs/traveler-onboarding-flow.html
 *
 * Approval on a type-C trip grants access to THIS and nothing else. The
 * traveler holds no seat, is absent from the participant count, and sees the
 * public trip page until every must-have requirement is satisfied. This screen
 * is the only way through.
 *
 * FIVE THINGS HERE ARE NOT STYLE CHOICES:
 *
 * 1. THIS IS A NAVIGATOR SCREEN, NEVER A MODAL. Three of its steps open OS
 *    pickers, and a picker launched while a Modal is tearing down hangs the
 *    main thread on PHPicker and the OS kills the app. RequirementUploadFlow's
 *    header documents the incident. A `presentation: 'modal'` route would
 *    reintroduce it — the route is registered as a card on purpose.
 *
 * 2. THIS SCREEN DOES NOT DECIDE WHO IS IN. It calls
 *    `activateTripMembership`, which re-derives every must-have from the
 *    evidence tables server-side. Nothing here can grant membership by getting
 *    its own arithmetic wrong.
 *
 * 3. IT NEVER CLAIMS A PAYMENT SUCCEEDED. Coming back from Stripe is not proof
 *    of payment (see startCheckout). The deposit step waits for the SERVER to
 *    say the requirement is settled, and when the webhook is slow it says
 *    "still confirming" rather than advancing on a lie.
 *
 * 4. EVERY STEP'S STATE ALREADY LIVES IN THE DATABASE. There is no local
 *    progress to lose: the plan is re-derived on mount and after every step, so
 *    killing the app mid-flow resumes exactly where it stopped. That is also
 *    why leaving is allowed — nothing is stranded by it.
 *
 * 5. THE TRIP CAN FILL UP WHILE THEY ARE IN HERE. Approval takes no seat, so an
 *    operator can approve more people than there are spots. `full` is a real,
 *    expected outcome of activation and gets its own screen — not an alert.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { WaiverStepInline } from '../../components/trips/WaiverStepInline';
import { MedicalFormSheet } from '../../components/trips/MedicalFormSheet';
// No PayAmountSheet here on purpose — the deposit is all-or-nothing during
// onboarding. See openSheet().
import { RequirementUploadFlow } from '../../components/trips/RequirementUploadFlow';
import { ff } from '../../theme/fonts';
import { hapticLight, hapticSuccess, hapticError } from '../../utils/haptics';
import { friendlyErrorMessage, showErrorAlert } from '../../utils/friendlyError';
import {
  REQUIREMENT_CATALOG,
  type RequirementKind,
} from '../../services/trips/tripDocumentsService';
import {
  fetchOnboardingPlan,
  activateTripMembership,
  devResetOnboarding,
  type OnboardingPlan,
  type OnboardingStep,
} from '../../services/trips/tripOnboardingService';
import {
  fetchTravelerPrices,
  fetchPaidByRequirement,
  amountOutstanding,
  startCheckout,
  type PayStep,
  type TravelerPrices,
} from '../../services/trips/tripPaymentsService';

/** The RPC already resolves `deadline_days_before` into a real date, so this
 *  only has to render it. Matches the "Feb 21" the Plan tab shows. */
const DUE_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${DUE_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Tokens — the Plan tab's palette, so a traveler who finishes onboarding and
// lands on the trip does not feel they changed apps.
const C = {
  accent: '#05BCD3',
  ink: '#212121',
  inkBody: '#222B30',
  muted: '#7B7B7B',
  faint: '#8A8A84',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  hairline: '#EFEFEF',
  border: '#E4E4E4',
  done: '#34C759',
  doneTint: '#E8F5EE',
  warnTint: '#FDF6E3',
  warn: '#C98A00',
} as const;

/** Long enough to cover a healthy Stripe webhook, short enough that a traveler
 *  does not sit watching a spinner wondering if it broke. Past this the step
 *  says so plainly instead of pretending. */
const PAYMENT_CONFIRM_ATTEMPTS = 6;
const PAYMENT_CONFIRM_INTERVAL_MS = 1600;

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  waiver: 'document-text-outline',
  medical: 'medkit-outline',
  deposit: 'card-outline',
  insurance: 'shield-checkmark-outline',
  flights: 'airplane-outline',
  visa: 'document-attach-outline',
};

// ---------------------------------------------------------------------------
// PressableScale — the same tactile 0.97 the Plan tab uses. A CTA that does not
// answer the finger reads as a dead button, and three of these open a sheet
// after a round trip, so the press feedback is the only immediate signal.
const PressableScale: React.FC<{
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
  children: React.ReactNode;
  accessibilityLabel?: string;
}> = ({ onPress, disabled, style, children, accessibilityLabel }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && animate(0.97)}
      onPressOut={() => animate(1)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
};

/** Fills left-to-right as steps complete. Native-driven scaleX rather than an
 *  animated width, so it never touches layout. */
const ProgressBar: React.FC<{ value: number; animate: boolean }> = ({ value, animate }) => {
  const progress = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    if (!animate) {
      progress.setValue(value);
      return;
    }
    Animated.timing(progress, {
      toValue: value,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [value, animate, progress]);
  return (
    <View style={styles.progressTrack}>
      <Animated.View
        style={[
          styles.progressFill,
          // scaleX from a full-width bar anchored left. transformOrigin has no
          // RN equivalent, so the -50%/+50% pair does the anchoring.
          {
            transform: [
              { translateX: -0.5 },
              { scaleX: progress },
              { translateX: 0.5 },
            ],
          },
        ]}
      />
    </View>
  );
};

const Row: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub?: string | null;
  pill?: { label: string; tone: 'must' | 'later' | 'done' };
  dim?: boolean;
}> = ({ icon, title, sub, pill, dim }) => (
  <View style={styles.row}>
    <View style={[styles.rowIcon, dim && styles.rowIconDone]}>
      <Ionicons name={icon} size={15} color={dim ? C.done : C.ink} />
    </View>
    <View style={styles.rowBody}>
      <Text style={[styles.rowTitle, dim && styles.rowTitleDim]} numberOfLines={1}>
        {title}
      </Text>
      {sub ? (
        <Text style={styles.rowSub} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </View>
    {pill ? (
      <View
        style={[
          styles.pill,
          pill.tone === 'later' && styles.pillLater,
          pill.tone === 'done' && styles.pillDone,
        ]}
      >
        <Text
          style={[
            styles.pillText,
            pill.tone === 'later' && styles.pillTextLater,
            pill.tone === 'done' && styles.pillTextDone,
          ]}
        >
          {pill.label}
        </Text>
      </View>
    ) : null}
  </View>
);

type Phase = 'loading' | 'intro' | 'step' | 'done' | 'full' | 'error';

export default function TravelerOnboardingScreen({
  tripId,
  userId,
  tripTitle,
  devMode = false,
  onClose,
  onFinished,
}: {
  tripId: string;
  userId: string;
  tripTitle?: string | null;
  /**
   * Launched from the dev menu — adds a Reset button to the header. Never set
   * on the real route: the flow a traveler runs has no way to undo itself, and
   * should not.
   */
  devMode?: boolean;
  /** Leave without finishing. The trip screen stays locked. */
  onClose: () => void;
  /** Every must-have is satisfied and the server agreed — they are a member.
   *  The caller refetches the trip and drops them into it. */
  onFinished: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('loading');
  const [plan, setPlan] = useState<OnboardingPlan | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Paid, but the webhook has not landed yet. Never advances the step. */
  const [confirming, setConfirming] = useState(false);
  const [paymentNote, setPaymentNote] = useState<string | null>(null);

  const [prices, setPrices] = useState<TravelerPrices | null>(null);
  const [paidByRequirement, setPaidByRequirement] = useState<Record<string, number>>({});

  // Which sheet is open. One at a time, by construction.
  // No 'pay' variant — the deposit has no sheet, it goes straight to Checkout.
  const [sheet, setSheet] = useState<'medical' | 'upload' | null>(null);

  // Guards a fetch that resolves after the screen is gone.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Which checkout run is the current one. The payment confirm loop in
   * runCheckout polls for up to PAYMENT_CONFIRM_ATTEMPTS × PAYMENT_CONFIRM_INTERVAL_MS
   * and `aliveRef` alone does not stop it — that only flips on unmount. So a
   * Reset pressed while a poll was still in flight WOULD clear the banner, and
   * then the orphaned loop would time out and set it straight back. Reset bumps
   * this; a loop whose epoch no longer matches drops everything it was going to
   * write.
   */
  const checkoutEpochRef = useRef(0);

  const loadPlan = useCallback(async (): Promise<OnboardingPlan | null> => {
    try {
      const [next, priceData, paid] = await Promise.all([
        fetchOnboardingPlan(tripId),
        fetchTravelerPrices(tripId, userId).catch(() => null),
        fetchPaidByRequirement(tripId, userId).catch(() => ({} as Record<string, number>)),
      ]);
      if (!aliveRef.current) return null;
      setPlan(next);
      if (priceData) setPrices(priceData);
      setPaidByRequirement(paid ?? {});
      return next;
    } catch (e) {
      if (!aliveRef.current) return null;
      setError(friendlyErrorMessage(e, 'We could not load your onboarding.'));
      setPhase('error');
      return null;
    }
  }, [tripId, userId]);

  // First load. A traveler who already finished everything (webhook landed
  // while the app was closed, say) is activated immediately rather than being
  // walked through a flow with nothing in it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await loadPlan();
      if (cancelled || !next || !aliveRef.current) return;
      // The one and only place the walk is set. See the note on `walk`.
      setWalk(next.remaining);
      if (next.remaining.length === 0) {
        setPhase('done');
        return;
      }
      setPhase('intro');
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlan]);

  /**
   * The steps the runner walks: everything outstanding when the screen opened.
   *
   * ⚠️ STATE, SET ONCE — never derived from `plan`. `plan` is refetched after
   * every completed step, and `remaining` shrinks each time. Deriving the walk
   * from it means the list gets shorter while `index` counts up, so the two
   * cross and every second step is silently skipped:
   *
   *   [Deposit, Medical, Insurance, Flights, Visa]  index 0 -> Deposit
   *   [Medical, Insurance, Flights, Visa]           index 1 -> Insurance (!)
   *   [Medical, Flights, Visa]                      index 2 -> Visa (!)
   *
   * That is not hypothetical — it shipped, and Medical and Flights never
   * opened. The walk must be fixed at the start and only `index` may move.
   */
  const [walk, setWalk] = useState<OnboardingStep[]>([]);
  const step: OnboardingStep | undefined = walk[index];
  const total = walk.length;
  const progress = total === 0 ? 1 : Math.min(index / total, 1);

  const catalog = step ? REQUIREMENT_CATALOG[step.kind] : null;

  // Delegated to the payments service rather than re-derived here. `balance` is
  // total minus deposit, not total — computing it inline is how the deposit
  // ends up being charged twice.
  const outstandingUsd = useMemo(() => {
    if (!step || step.action !== 'pay' || !prices) return 0;
    return amountOutstanding(
      step.kind as PayStep,
      prices,
      paidByRequirement[step.requirement.requirementId] ?? 0,
    );
  }, [step, prices, paidByRequirement]);

  /** Move on. The LAST step hands over to activation rather than a done screen,
   *  because "am I in?" is the server's answer, not ours. */
  const advance = useCallback(async () => {
    setPaymentNote(null);
    if (index + 1 < total) {
      setIndex(i => i + 1);
      return;
    }
    setPhase('done');
  }, [index, total]);

  /** A step reported success. Re-derive from the server before moving — a step
   *  that silently failed must not scroll past. */
  const completeStep = useCallback(async () => {
    setBusy(true);
    const next = await loadPlan();
    setBusy(false);
    if (!aliveRef.current) return;
    if (!next) return;
    hapticSuccess();
    await advance();
  }, [loadPlan, advance]);

  const skipStep = useCallback(() => {
    hapticLight();
    advance();
  }, [advance]);

  // ── The deposit ──────────────────────────────────────────────────────────
  const runCheckout = useCallback(
    async (amountUsd?: number) => {
      if (!step) return;
      // Anything this run is about to write is discarded once the epoch moves —
      // see checkoutEpochRef. Captured BEFORE the first await.
      const epoch = ++checkoutEpochRef.current;
      const stale = () => !aliveRef.current || checkoutEpochRef.current !== epoch;
      setSheet(null);
      setBusy(true);
      setPaymentNote(null);
      try {
        const outcome = await startCheckout(step.requirement.requirementId, amountUsd);
        if (stale()) return;

        // They pressed back inside Checkout. Nothing was charged and nothing is
        // in flight, so there is nothing to confirm and nothing to say.
        if (outcome === 'cancelled') {
          setBusy(false);
          return;
        }

        // Returning is NOT proof of payment. Ask the server, repeatedly, and
        // only move when IT says the requirement is settled.
        setBusy(false);
        setConfirming(true);
        for (let attempt = 0; attempt < PAYMENT_CONFIRM_ATTEMPTS; attempt++) {
          await new Promise(r => setTimeout(r, PAYMENT_CONFIRM_INTERVAL_MS));
          if (stale()) return;
          const next = await fetchOnboardingPlan(tripId).catch(() => null);
          if (stale()) return;
          const settled =
            next &&
            !next.remaining.some(
              s => s.requirement.requirementId === step.requirement.requirementId,
            );
          if (settled) {
            setConfirming(false);
            setPlan(next);
            hapticSuccess();
            await advance();
            return;
          }
        }

        // Still nothing. Do not advance and do not imply failure either — a
        // slow webhook is the common case and telling someone their payment
        // failed when it did not is worse than telling them to wait.
        setConfirming(false);
        setPaymentNote(
          "Your payment is still being confirmed. This usually takes a moment — you can close this and come back, nothing is lost.",
        );
      } catch (e) {
        if (stale()) return;
        setBusy(false);
        setConfirming(false);
        hapticError();
        setPaymentNote(
          friendlyErrorMessage(e, 'Something went wrong before you reached the payment page.'),
        );
      }
    },
    [step, tripId, advance],
  );

  // ── Activation ───────────────────────────────────────────────────────────
  const [activating, setActivating] = useState(false);
  const finish = useCallback(async () => {
    setActivating(true);
    const result = await activateTripMembership(tripId);
    if (!aliveRef.current) return;
    setActivating(false);

    if (result.status === 'active') {
      hapticSuccess();
      onFinished();
      return;
    }
    if (result.status === 'full') {
      hapticError();
      setPhase('full');
      return;
    }
    if (result.status === 'onboarding') {
      // The server disagrees that we are done. Reload and put them back on
      // whatever is outstanding rather than leaving them on a dead button.
      const next = await loadPlan();
      if (!aliveRef.current || !next) return;
      setIndex(0);
      setPhase(next.remaining.length > 0 ? 'step' : 'done');
      return;
    }
    setError(friendlyErrorMessage(result.error, 'We could not finish your onboarding.'));
    setPhase('error');
  }, [tripId, onFinished, loadPlan]);

  /**
   * Steps that open themselves.
   *
   * The medical form is here because its step screen would otherwise be a toll
   * booth: a title and a button that opens the thing they came for.
   *
   * The WAIVER is NOT here — it no longer has a sheet at all. The document
   * renders inside the step (WaiverStepInline), which is the same idea taken
   * one step further: nothing to open, because nothing is hidden.
   *
   * Uploads are deliberately excluded: their CTA ends in an OS picker, and a
   * picker that appears without being asked for is alarming rather than fast.
   * The deposit is excluded too — it leaves for Stripe, and money should never
   * move on a screen the traveler did not tap.
   */
  const AUTO_OPEN: Record<string, 'medical'> = {
    medical: 'medical',
  };
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'step' || !step) return;
    const target = AUTO_OPEN[step.action];
    if (!target) return;
    // Once per step. Without the guard, closing the sheet would immediately
    // re-open it and the traveler could never reach the Skip button or the ×.
    const token = `${step.requirement.requirementId}:${index}`;
    if (autoOpened.current === token) return;
    autoOpened.current = token;
    setSheet(target);
  }, [phase, step, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const enter = reduceMotion ? undefined : FadeIn.duration(220);
  const exit = reduceMotion ? undefined : FadeOut.duration(120);

  // ── Dev reset ────────────────────────────────────────────────────────────
  const [resetting, setResetting] = useState(false);
  const handleReset = useCallback(() => {
    // Destructive and irreversible, so it asks — even in a dev tool. The
    // wording names what actually disappears rather than saying "are you sure".
    Alert.alert(
      'Reset this onboarding?',
      'Deletes your waiver signature, medical form, uploaded documents and test payments on this trip, so the flow starts over. Live payments are never touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            // Orphan any checkout still polling. Without this the loop times
            // out ~20s later and paints the "still being confirmed" banner back
            // over a flow that was just reset.
            checkoutEpochRef.current++;
            setConfirming(false);
            setBusy(false);
            setResetting(true);
            try {
              const summary = await devResetOnboarding(tripId, userId);
              if (!aliveRef.current) return;
              // Rebuild the flow from scratch — the walk is set once, so it has
              // to be re-seeded here exactly as it is on first load.
              const next = await fetchOnboardingPlan(tripId);
              if (!aliveRef.current) return;
              setPlan(next);
              setWalk(next.remaining);
              setIndex(0);
              setPaymentNote(null);
              setPhase(next.remaining.length === 0 ? 'done' : 'intro');
              hapticSuccess();
              Alert.alert(
                'Reset done',
                `Cleared ${summary.documents ?? 0} document(s), ${summary.acknowledgements ?? 0} waiver signature(s), ${summary.medical ?? 0} medical form(s) and ${summary.payments ?? 0} test payment(s).`,
              );
            } catch (e) {
              if (!aliveRef.current) return;
              hapticError();
              showErrorAlert('Could not reset', e, 'Nothing was changed.');
            } finally {
              if (aliveRef.current) setResetting(false);
            }
          },
        },
      ],
    );
  }, [tripId, userId]);

  // ── Chrome ───────────────────────────────────────────────────────────────
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onClose}
          style={styles.close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close onboarding"
        >
          <Ionicons name="close" size={22} color={C.muted} />
        </Pressable>

        {/* Dev only. Deliberately quiet and on the far side of the header from
            the × — a destructive button should not sit under the thumb that is
            reaching for "close". */}
        {devMode ? (
          <Pressable
            onPress={handleReset}
            disabled={resetting}
            style={styles.resetBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Reset this onboarding"
          >
            {resetting ? (
              <ActivityIndicator size="small" color={C.warn} />
            ) : (
              <>
                <Ionicons name="refresh" size={13} color={C.warn} />
                <Text style={styles.resetText}>Reset</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
      {phase === 'step' || phase === 'done' ? (
        <ProgressBar value={phase === 'done' ? 1 : progress} animate={!reduceMotion} />
      ) : (
        <View style={styles.progressTrack} />
      )}
    </View>
  );

  const footerPad = { paddingBottom: Math.max(insets.bottom, 14) + 6 };

  // ── Loading / error ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.centre}>
          <ActivityIndicator color={C.accent} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.centre}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.sub}>{error}</Text>
        </View>
        <View style={[styles.footer, footerPad]}>
          <PressableScale style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>Close</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── The trip filled up while they were in here ───────────────────────────
  if (phase === 'full') {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.centre}>
          <View style={[styles.bigIcon, { backgroundColor: C.warnTint }]}>
            <Ionicons name="people-outline" size={26} color={C.warn} />
          </View>
          <Text style={styles.title}>This trip just filled up</Text>
          <Text style={styles.sub}>
            The last spots went while you were getting ready. Nothing you sent is lost, and you
            have not been charged for a place you cannot take.
          </Text>
          <Text style={[styles.sub, { marginTop: 10 }]}>
            Message the organiser — they may be able to make room, and they can sort out anything
            you already paid.
          </Text>
        </View>
        <View style={[styles.footer, footerPad]}>
          <PressableScale style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>Back to the trip</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    const musts = walk.filter(s => !s.skippable);
    const laters = walk.filter(s => s.skippable);
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Reanimated.View entering={enter}>
            <Text style={styles.eyebrow}>{tripTitle ?? 'Your trip'}</Text>
            <Text style={styles.title}>You're in. Now let's get you ready.</Text>
            <Text style={styles.sub}>
              {musts.length > 0
                ? `${musts.length} ${musts.length === 1 ? 'thing' : 'things'} the organiser needs${
                    laters.length > 0 ? `, and ${laters.length} you can do later.` : '.'
                  }`
                : 'A few optional things you can send whenever you have them.'}
            </Text>

            <View style={styles.list}>
              {musts.map(s => (
                <Row
                  key={s.requirement.requirementId}
                  icon={KIND_ICON[s.kind] ?? 'document-outline'}
                  title={REQUIREMENT_CATALOG[s.kind].title}
                  sub={REQUIREMENT_CATALOG[s.kind].helpText}
                  pill={{ label: 'Required', tone: 'must' }}
                />
              ))}
              {laters.map(s => (
                <Row
                  key={s.requirement.requirementId}
                  icon={KIND_ICON[s.kind] ?? 'document-outline'}
                  title={REQUIREMENT_CATALOG[s.kind].title}
                  sub={REQUIREMENT_CATALOG[s.kind].helpText}
                  pill={{ label: 'Optional', tone: 'later' }}
                />
              ))}
            </View>

            {musts.length > 0 ? (
              <Text style={styles.note}>
                You'll join the trip once the required ones are done.
              </Text>
            ) : null}
          </Reanimated.View>
        </ScrollView>
        <View style={[styles.footer, footerPad]}>
          <PressableScale
            style={[styles.btn, styles.btnAccent]}
            onPress={() => {
              hapticLight();
              setPhase('step');
            }}
          >
            <Text style={styles.btnText}>Start</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    // Straight off the FRESH plan, which is the server's own answer. The old
    // version compared `walk.includes(s)` — object identity against a list
    // rebuilt by every refetch, so it never matched anything.
    const settled = plan?.steps.filter(s => s.done) ?? [];
    const skipped = plan?.steps.filter(s => !s.done) ?? [];
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Reanimated.View entering={enter}>
            <View style={styles.centreTop}>
              <View style={[styles.bigIcon, { backgroundColor: C.doneTint }]}>
                <Ionicons name="checkmark" size={28} color={C.done} />
              </View>
              <Text style={styles.title}>You're all set</Text>
              <Text style={styles.sub}>
                The organiser has what they need to start planning around you.
              </Text>
            </View>

            <View style={styles.list}>
              {settled.map(s => (
                <Row
                  key={s.requirement.requirementId}
                  icon={KIND_ICON[s.kind] ?? 'document-outline'}
                  title={REQUIREMENT_CATALOG[s.kind].title}
                  pill={{ label: s.action === 'pay' ? 'Paid' : 'Done', tone: 'done' }}
                  dim
                />
              ))}
              {skipped.length > 0 ? (
                <Row
                  icon="time-outline"
                  title={`${skipped.length} ${skipped.length === 1 ? 'task' : 'tasks'} left`}
                  sub={skipped.map(s => REQUIREMENT_CATALOG[s.kind].title).join(', ')}
                  pill={{ label: 'Optional', tone: 'later' }}
                />
              ) : null}
            </View>

            {skipped.length > 0 ? (
              <Text style={styles.note}>
                You'll find these waiting in the trip's Plan tab, with their deadlines.
              </Text>
            ) : null}
          </Reanimated.View>
        </ScrollView>
        <View style={[styles.footer, footerPad]}>
          <PressableScale
            style={[styles.btn, styles.btnAccent, activating && styles.btnDisabled]}
            disabled={activating}
            onPress={finish}
          >
            {activating ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.btnText}>Go to the trip</Text>
            )}
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── A step ───────────────────────────────────────────────────────────────
  if (!step || !catalog) {
    // `walk` emptied under us (every step settled elsewhere). Hand over to the
    // done screen rather than rendering nothing.
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.centre}>
          <ActivityIndicator color={C.accent} />
        </View>
      </View>
    );
  }

  const deadline = step.skippable ? formatDue(step.requirement.dueDate) : null;
  const rejected = step.requirement.state === 'rejected';

  const openSheet = () => {
    hapticLight();
    // 'agree' never reaches here — the waiver step returns its own layout.
    if (step.action === 'medical') setSheet('medical');
    // Payment goes STRAIGHT to Checkout for the whole amount — no
    // pay-part-of-it sheet. Onboarding is the moment someone is buying their
    // place; a half-paid deposit does not hold a spot, so offering to split it
    // here would let them leave believing they are in when they are not.
    // Partial payments still exist for the BALANCE, in the Plan tab, which is
    // where paying over time actually makes sense.
    else if (step.action === 'pay') runCheckout();
    else setSheet('upload');
  };

  const ctaLabel =
    step.action === 'pay'
      ? outstandingUsd > 0
        ? `Pay $${outstandingUsd.toLocaleString('en-US')}`
        : 'Pay'
      // The medical form opens on its own, so its CTA is only ever a way BACK
      // in after closing the sheet. ('agree' is absent: the waiver step has its
      // own footer and returns before this is read.)
      : step.action === 'medical'
        ? 'Reopen the form'
        : rejected
            ? 'Send a new one'
            : 'Upload';

  // ── The waiver reads INSIDE this screen ──────────────────────────────────
  // Its own layout, because the document has to fill the space and scroll
  // itself: putting a PDF renderer inside the ScrollView below would nest two
  // scroll views and neither would work properly. It also owns its footer —
  // "I agree" belongs under the document, not in the generic step footer.
  if (step.action === 'agree') {
    return (
      <View style={styles.screen}>
        {header}
        <View style={[styles.body, styles.bodyFill]}>
          <Text style={styles.eyebrow}>
            Step {index + 1} of {total} · {step.skippable ? 'Optional' : 'Required'}
          </Text>
          <Text style={styles.title}>{catalog.title}</Text>
          <Text style={styles.sub}>{catalog.helpText}</Text>
          <WaiverStepInline
            tripId={tripId}
            requirementId={step.requirement.requirementId}
            agreed={step.requirement.state === 'approved'}
            onAgreed={completeStep}
          />
          <View style={{ height: Math.max(insets.bottom, 12) }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Keyed on the step so each one fades in as its own thing rather than
            the text swapping in place, which reads as a glitch. */}
        <Reanimated.View key={step.requirement.requirementId} entering={enter} exiting={exit}>
          <Text style={styles.eyebrow}>
            Step {index + 1} of {total} · {step.skippable ? 'Optional' : 'Required'}
          </Text>
          <Text style={styles.title}>{catalog.title}</Text>
          <Text style={styles.sub}>{catalog.helpText}</Text>

          {rejected && step.requirement.note ? (
            <View style={styles.calloutWarn}>
              <Ionicons name="alert-circle-outline" size={16} color={C.warn} />
              <Text style={styles.calloutWarnText}>{step.requirement.note}</Text>
            </View>
          ) : null}

          {step.action === 'pay' ? (
            <View style={styles.amountCard}>
              <Text style={styles.amountBig}>
                {outstandingUsd > 0 ? `$${outstandingUsd.toLocaleString('en-US')}` : '—'}
              </Text>
              {prices?.totalUsd != null && step.kind === 'deposit' ? (
                <Text style={styles.amountCap}>
                  of ${prices.totalUsd.toLocaleString('en-US')} total
                </Text>
              ) : null}
            </View>
          ) : AUTO_OPEN[step.action] ? (
            // This step opens its own sheet, so what is behind it is a backdrop
            // for a fraction of a second. A big dashed placeholder there was
            // pure flash — and the moment they close the sheet it became an
            // empty box explaining nothing. A quiet line and the CTA is all
            // this needs to be.
            <Text style={styles.backdropHint}>
              {step.action === 'medical'
                ? 'Only the organiser and the guides can see this.'
                : 'Take a minute to read it before you agree.'}
            </Text>
          ) : (
            <View style={styles.illustration}>
              <Ionicons
                name={KIND_ICON[step.kind] ?? 'document-outline'}
                size={30}
                color={C.faint}
              />
              <Text style={styles.illustrationText}>{catalog.operatorSub}</Text>
            </View>
          )}

          {deadline ? (
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={14} color={C.muted} />
              <Text style={styles.metaText}>Due {deadline}</Text>
            </View>
          ) : null}

          {paymentNote ? (
            <View style={styles.calloutWarn}>
              <Ionicons name="information-circle-outline" size={16} color={C.warn} />
              <Text style={styles.calloutWarnText}>{paymentNote}</Text>
            </View>
          ) : null}
        </Reanimated.View>
      </ScrollView>

      <View style={[styles.footer, footerPad]}>
        {confirming ? (
          <View style={styles.confirmRow}>
            <ActivityIndicator color={C.accent} size="small" />
            <Text style={styles.confirmText}>Confirming your payment…</Text>
          </View>
        ) : (
          <>
            <PressableScale
              style={[styles.btn, styles.btnAccent, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={openSheet}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.btnText}>{ctaLabel}</Text>
              )}
            </PressableScale>
            {step.skippable ? (
              // Full width, same height as the primary. Skipping is a valid
              // outcome, not a failure, and a small grey link would say the
              // opposite of what the flow means.
              <PressableScale style={styles.btnOutline} disabled={busy} onPress={skipStep}>
                <Text style={styles.btnOutlineText}>Skip — I'll do it later</Text>
              </PressableScale>
            ) : null}
          </>
        )}
      </View>

      {/* ── The step sheets. Each one already exists and is used identically by
          the Plan tab, so a traveler meets the same waiver sheet here and
          later. ─────────────────────────────────────────────────────────── */}
      {/* No waiver sheet — the waiver renders inside its own step and returns
          above, so nothing here is reachable for it. */}

      {step.action === 'medical' ? (
        <MedicalFormSheet
          visible={sheet === 'medical'}
          onClose={() => setSheet(null)}
          tripId={tripId}
          userId={userId}
          onSaved={() => {
            setSheet(null);
            completeStep();
          }}
        />
      ) : null}

      {/* No sheet for the pay step — see openSheet(). It goes straight to
          Stripe Checkout for the full outstanding amount. */}

      {/* Mounted ONLY while it is the live sheet, and unmounted from its own
          onClose — never from a button press. The flow has to outlive its own
          sheet so the queued picker hand-off has somewhere to run; see the
          header of RequirementUploadFlow. */}
      {step.action === 'upload' && sheet === 'upload' ? (
        <RequirementUploadFlow
          visible
          onClose={() => setSheet(null)}
          tripId={tripId}
          requirementId={step.requirement.requirementId}
          userId={userId}
          kind={step.kind as RequirementKind}
          rejectionNote={step.requirement.note}
          onUploaded={() => {
            setSheet(null);
            completeStep();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  close: { padding: 2 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: 99,
    backgroundColor: C.warnTint,
  },
  resetText: { fontFamily: ff('Inter', '700'), fontSize: 11.5, color: C.warn },
  progressTrack: {
    height: 3,
    borderRadius: 99,
    backgroundColor: '#EAEAE4',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '100%',
    borderRadius: 99,
    backgroundColor: C.accent,
  },

  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  /** The waiver step: a real flex container, not ScrollView content, so the
   *  document can take every pixel that is left and scroll itself. */
  bodyFill: { flex: 1, paddingBottom: 0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centreTop: { alignItems: 'center', marginBottom: 22 },

  eyebrow: {
    fontFamily: ff('Inter', '700'),
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: C.muted,
    marginBottom: 8,
  },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
    color: C.ink,
    marginBottom: 8,
    textAlign: 'left',
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 21,
    color: '#6F6F6A',
  },
  note: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12.5,
    lineHeight: 19,
    color: C.muted,
    marginTop: 14,
  },

  bigIcon: {
    width: 64,
    height: 64,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  list: { marginTop: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 99,
    backgroundColor: '#F0F0EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDone: { backgroundColor: C.doneTint },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: ff('Inter', '600'), fontSize: 14, color: C.ink },
  rowTitleDim: { color: C.faint },
  rowSub: { fontFamily: ff('Inter', '400'), fontSize: 11.5, color: C.faint, marginTop: 2 },

  pill: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#F0F0EC',
  },
  pillLater: { backgroundColor: C.warnTint },
  pillDone: { backgroundColor: C.doneTint },
  pillText: { fontFamily: ff('Inter', '700'), fontSize: 10, color: C.muted },
  pillTextLater: { color: C.warn },
  pillTextDone: { color: '#1F7A4D' },

  backdropHint: {
    marginTop: 18,
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 20,
    color: C.faint,
  },
  illustration: {
    marginTop: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D8D8D2',
    borderRadius: 14,
    backgroundColor: C.surface,
    paddingVertical: 30,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  illustrationText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12.5,
    lineHeight: 19,
    color: C.faint,
    textAlign: 'center',
  },

  amountCard: {
    marginTop: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 14,
    paddingVertical: 22,
    alignItems: 'center',
  },
  amountBig: {
    fontFamily: ff('Inter', '700'),
    fontSize: 34,
    letterSpacing: -0.8,
    color: C.ink,
  },
  amountCap: { fontFamily: ff('Inter', '400'), fontSize: 12, color: C.faint, marginTop: 4 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  metaText: { fontFamily: ff('Inter', '500'), fontSize: 12.5, color: C.muted },

  calloutWarn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: 16,
    backgroundColor: C.warnTint,
    borderRadius: 12,
    padding: 12,
  },
  calloutWarnText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12.5,
    lineHeight: 19,
    color: '#7A5A0A',
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.hairline,
    backgroundColor: C.bg,
  },
  btn: {
    height: 50,
    borderRadius: 99,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnAccent: { backgroundColor: C.accent },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: ff('Inter', '700'), fontSize: 15, color: '#FFFFFF' },
  btnOutline: {
    height: 50,
    borderRadius: 99,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  btnOutlineText: { fontFamily: ff('Inter', '600'), fontSize: 15, color: C.ink },

  confirmRow: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  confirmText: { fontFamily: ff('Inter', '500'), fontSize: 14, color: C.muted },
});
