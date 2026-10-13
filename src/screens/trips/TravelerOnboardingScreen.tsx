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
  Image,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { WaiverStepInline } from '../../components/trips/WaiverStepInline';
import { MedicalFormBody, useMedicalForm } from '../../components/trips/MedicalFormSheet';
// No PayAmountSheet here on purpose — the deposit is all-or-nothing during
// onboarding. See openSheet().
import { RequirementUploadFlow } from '../../components/trips/RequirementUploadFlow';
import { ff } from '../../theme/fonts';
import { textStyle, textStyles } from '../../theme/typography';
import { TripIcon, type TripIconName } from '../../components/trips/tripIcons';
import { isExpoGo } from '../../utils/keyboardAvoidingView';
import { getTripById, type GroupTrip } from '../../services/trips/groupTripsService';
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
  fetchInFlightByRequirement,
  amountOutstanding,
  amountDue,
  isPayingInFull,
  startCheckout,
  type PayStep,
  type TravelerPrices,
} from '../../services/trips/tripPaymentsService';
import { TripPolicyConsentSheet } from '../../components/trips/TripPolicyConsentSheet';
import { useTripPolicyConsent } from '../../hooks/useTripPolicyConsent';

/** The RPC already resolves `deadline_days_before` into a real date, so this
 *  only has to render it. Matches the "Feb 21" the Plan tab shows. */
const DUE_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${DUE_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** 'YYYY-MM-DD' as LOCAL midnight. `new Date(s)` reads it as UTC and moves
 *  the day for anyone west of Greenwich. */
function parseDay(iso: string | null | undefined): Date | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Jun 15 - 22, 2026", "Jun 28 - Jul 3, 2026", "Dec 28, 2026 - Jan 3, 2027". */
function formatTripRange(startIso: string | null, endIso: string | null): string | null {
  const a = parseDay(startIso);
  if (!a) return null;
  const b = parseDay(endIso);
  const md = (d: Date) => `${DUE_MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (!b) return `${md(a)}, ${a.getFullYear()}`;
  if (a.getFullYear() !== b.getFullYear()) {
    return `${md(a)}, ${a.getFullYear()} - ${md(b)}, ${b.getFullYear()}`;
  }
  const end = a.getMonth() === b.getMonth() ? `${b.getDate()}` : md(b);
  return `${md(a)} - ${end}, ${b.getFullYear()}`;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Keyboard-aware on dev/prod builds; the plain ScrollView in Expo Go, where
 *  react-native-keyboard-controller's native module is absent. */
const FormScroll: React.ComponentType<any> = isExpoGo
  ? ScrollView
  : require('react-native-keyboard-controller').KeyboardAwareScrollView;

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

// The Figma set (17114:26904) — Untitled-UI icons, drawn as TripIcons.
const KIND_ICON: Record<string, TripIconName> = {
  waiver: 'file-05',
  medical: 'medical-cross',
  deposit: 'currency-dollar-circle',
  balance: 'currency-dollar-circle',
  insurance: 'shield-tick',
  passport: 'passport',
  flights: 'plane',
  visa: 'file-05',
};
const kindIcon = (kind: string): TripIconName => KIND_ICON[kind] ?? 'file-05';

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
          // scaleX from a full-width bar anchored at its left edge.
          { transformOrigin: 'left', transform: [{ scaleX: progress }] },
        ]}
      />
    </View>
  );
};

/** The trip at a glance — photo, name, place, dates. Figma 17306:27884 (intro)
 *  and 17115:27201 (deposit); the caller picks the surface. */
const TripSummaryCard: React.FC<{
  imageUrl?: string | null;
  name: string;
  place?: string | null;
  range?: string | null;
  style?: StyleProp<ViewStyle>;
}> = ({ imageUrl, name, place, range, style }) => (
  <View style={[styles.tripCardBox, style]}>
    {imageUrl ? (
      <Image source={{ uri: imageUrl }} style={styles.tripCardImg} resizeMode="cover" />
    ) : null}
    <View style={styles.tripCardBody}>
      <View>
        <Text style={styles.tripCardTitle} numberOfLines={1}>
          {name}
        </Text>
        {place ? (
          <Text style={styles.tripCardMeta} numberOfLines={1}>
            {place}
          </Text>
        ) : null}
      </View>
      {range ? (
        <View style={styles.tripCardDates}>
          <TripIcon name="calendar" size={16} color="#7B7B7B" />
          <Text style={styles.tripCardMeta}>{range}</Text>
        </View>
      ) : null}
    </View>
  </View>
);

/** One requirement card — Figma 17114:26905: grey icon box, title + one line,
 *  and a pill on the right only when there is something to say. */
const Row: React.FC<{
  icon: TripIconName;
  title: string;
  sub?: string | null;
  pill?: { label: string; tone: 'must' | 'later' | 'done' };
  dim?: boolean;
}> = ({ icon, title, sub, pill, dim }) => (
  <View style={styles.row}>
    <View style={[styles.rowIcon, dim && styles.rowIconDone]}>
      <TripIcon name={icon} size={18} color={dim ? C.done : '#333333'} />
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

/**
 * The medical form as a step of its own ("Personal Info", Figma 17134:25594) —
 * the form IS the step, not a sheet over an empty one. A separate component
 * because `useMedicalForm` is a hook and the step screen renders it only on
 * this one step.
 */
const MedicalStepInline: React.FC<{
  tripId: string;
  userId: string;
  header: React.ReactNode;
  bottomInset: number;
  skippable: boolean;
  onSkip: () => void;
  onSaved: () => void;
}> = ({ tripId, userId, header, bottomInset, skippable, onSkip, onSaved }) => {
  const { form, setForm, loading, saving, complete, hint, save } = useMedicalForm(
    tripId,
    userId,
    true,
    onSaved,
  );
  return (
    <View style={styles.screen}>
      {header}
      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <FormScroll
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          {...(isExpoGo ? {} : { bottomOffset: 24 })}
        >
          <Text style={styles.title}>Personal Info</Text>
          <Text style={[styles.sub, { marginBottom: 16 }]}>
            Only you and your trip organiser can see this.
          </Text>
          <MedicalFormBody form={form} setForm={setForm} />
        </FormScroll>
      )}
      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <PressableScale
          style={[styles.btn, (!complete || saving || loading) && styles.btnDisabled]}
          disabled={!complete || saving || loading}
          onPress={save}
          accessibilityLabel="Save and continue"
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.btnText}>Save and continue</Text>
          )}
        </PressableScale>
        {hint && !loading ? <Text style={styles.hint}>{hint}</Text> : null}
        {skippable ? (
          <PressableScale style={styles.btnOutline} disabled={saving} onPress={onSkip}>
            <Text style={styles.btnOutlineText}>Skip — I'll do it later</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
};

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

  // Which sheet is open. Only uploads have one now — the waiver and medical
  // render inside their step, and the deposit goes straight to Checkout.
  const [sheet, setSheet] = useState<'upload' | null>(null);

  // The cancellation-policy tick. This screen is where it matters most: the
  // deposit is the first and largest payment, and it never opens an amount
  // sheet, so without a gate here the biggest charge on Swellyo is the one
  // nobody agrees to any terms for. Always enabled — this screen only ever
  // runs on an operator trip, which is the only kind that takes money.
  const { ensureConsent: ensurePolicyConsent, sheetProps: policyConsentSheetProps } =
    useTripPolicyConsent(tripId, userId, true);

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

  // The trip itself — its photo, place and dates dress the intro card and the
  // deposit step (Figma 17114:27162, 17115:27361). Decoration only: nothing
  // waits on it, and a failed read just leaves those cards out.
  const [trip, setTrip] = useState<GroupTrip | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    getTripById(tripId, ac.signal)
      .then(t => {
        if (aliveRef.current && t) setTrip(t);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [tripId]);
  const tripName = trip?.title || tripTitle || 'Your trip';
  const tripRange = formatTripRange(trip?.start_date ?? null, trip?.end_date ?? null);
  const tripPlace =
    trip?.destination?.short_label || trip?.destination?.name || null;

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
  const progress = total === 0 ? 1 : Math.min((index + 1) / total, 1);

  const catalog = step ? REQUIREMENT_CATALOG[step.kind] : null;

  /**
   * This traveler pays the whole price here, in one go — either the operator
   * asks for no deposit, or they joined on or after the full-payment deadline
   * and `freeze_traveler_price()` froze their deposit at the full cost (see
   * `20260817000000_full_payment_after_deadline.sql`).
   *
   * COPY ONLY. The amount comes from `outstandingUsd` below either way, and
   * the charge itself is the server's. But the catalog calls this step
   * "Deposit", and a screen that says "Deposit" over the full trip price —
   * on a trip whose page advertises a smaller one — reads as a bug and stops
   * people from paying.
   */
  const payingInFull = isPayingInFull(prices);

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
      // The policy tick, before anything else in this run. Ahead of `setBusy`
      // on purpose: the traveler is being asked a question, not waiting on us,
      // and a spinner behind the sheet reads as the step already running.
      // Dismissing it leaves the step exactly as it was.
      if (!(await ensurePolicyConsent())) return;
      if (stale()) return;
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

        // A BANK payment is the one case where this is the expected outcome
        // (ACH, ach-bank-payments.md): the ledger carries a 'processing'
        // marker and the money is in transit for up to 4 business days. Say that,
        // with the amount and the timescale, instead of "a moment" — the
        // generic line below promises something that will not happen today.
        // Non-fatal: a failed read falls through to the generic copy.
        const inFlight = await fetchInFlightByRequirement(tripId, userId).catch(() => null);
        if (stale()) return;
        const clearing = inFlight?.[step.requirement.requirementId];
        if (clearing) {
          const usd = clearing.amountUsd > 0 ? `$${Math.round(clearing.amountUsd).toLocaleString('en-US')} ` : '';
          setPaymentNote(
            `Your ${usd}bank payment is on its way. Bank transfers take up to 4 business days — this step will complete itself when it lands, and we'll send you a message. There's nothing to do now; please don't pay again.`,
          );
          return;
        }

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
    [step, tripId, advance, ensurePolicyConsent],
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

  // Nothing opens itself any more. The waiver and the medical form both render
  // INSIDE their step (WaiverStepInline, MedicalStepInline), so there is no
  // sheet to auto-open. Uploads end in an OS picker — one that appears without
  // being asked for is alarming rather than fast — and the deposit leaves for
  // Stripe, which must never happen on a screen the traveler did not tap.

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
  // Dev only. Deliberately quiet and on the far side of the header from the
  // back arrow — a destructive button should not sit under the thumb that is
  // reaching for "leave".
  const resetButton = devMode ? (
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
  ) : null;

  // Figma "Step Process" (17115:27593): back arrow, "Required - 1/7" in the
  // middle, and a short bar under it. The arrow LEAVES the flow rather than
  // stepping back — every step's state is on the server, so leaving strands
  // nothing, while walking back onto a paid deposit would offer to pay again.
  const stepLabel =
    phase === 'step' && step
      ? `${step.skippable ? 'Optional' : 'Required'} - ${index + 1}/${total}`
      : phase === 'done'
        ? 'All done'
        : '';
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerSide}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Leave onboarding"
          >
            <Ionicons name="arrow-back" size={24} color="#333333" />
          </Pressable>
        </View>
        <Text style={styles.headerLabel} numberOfLines={1}>
          {stepLabel}
        </Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>{resetButton}</View>
      </View>
      {phase === 'step' || phase === 'done' ? (
        <ProgressBar value={phase === 'done' ? 1 : progress} animate={!reduceMotion} />
      ) : null}
    </View>
  );

  const footerPad = { paddingBottom: Math.max(insets.bottom, 16) + 8 };

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
  // Figma 17306:27733: a white trip card (photo, name, place, dates), then
  // the checklist.
  if (phase === 'intro') {
    const musts = walk.filter(s => !s.skippable);
    const laters = walk.filter(s => s.skippable);
    return (
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.introBar, { marginTop: insets.top + 8 }]}>
            <Pressable
              onPress={onClose}
              style={styles.introBackBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Leave onboarding"
            >
              <Ionicons name="arrow-back" size={22} color="#333333" />
            </Pressable>
            {resetButton}
          </View>
          <TripSummaryCard
            imageUrl={trip?.hero_image_url}
            name={tripName}
            place={tripPlace}
            range={tripRange}
            style={styles.introCard}
          />

          <Reanimated.View entering={enter} style={styles.introBody}>
            <Text style={styles.title}>You’re in. Now let’s get you ready.</Text>

            <View style={styles.list}>
              {musts.map(s => (
                <Row
                  key={s.requirement.requirementId}
                  icon={kindIcon(s.kind)}
                  title={REQUIREMENT_CATALOG[s.kind].title}
                  sub={REQUIREMENT_CATALOG[s.kind].helpText}
                  pill={{ label: 'Required', tone: 'must' }}
                />
              ))}
              {/* Optional ones carry no pill — the absence of "Required" is
                  the message (Figma 17114:26908). */}
              {laters.map(s => (
                <Row
                  key={s.requirement.requirementId}
                  icon={kindIcon(s.kind)}
                  title={REQUIREMENT_CATALOG[s.kind].title}
                  sub={REQUIREMENT_CATALOG[s.kind].helpText}
                />
              ))}
            </View>

            <Text style={styles.note}>
              {musts.length > 0
                ? 'You’ll join the trip once the required ones are done'
                : 'All optional — send them whenever you have them'}
            </Text>
          </Reanimated.View>
        </ScrollView>
        <View style={[styles.footer, footerPad]}>
          <PressableScale
            style={styles.btn}
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
                  icon={kindIcon(s.kind)}
                  title={REQUIREMENT_CATALOG[s.kind].title}
                  pill={{ label: s.action === 'pay' ? 'Paid' : 'Done', tone: 'done' }}
                  dim
                />
              ))}
              {skipped.length > 0 ? (
                <Row
                  icon="clock"
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
            style={[styles.btn, activating && styles.btnDisabled]}
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
    // 'agree' and 'medical' never reach here — both return their own layout.
    // Payment goes STRAIGHT to Checkout for the whole amount — no
    // pay-part-of-it sheet. Onboarding is the moment someone is buying their
    // place; a half-paid deposit does not hold a spot, so offering to split it
    // here would let them leave believing they are in when they are not.
    // Partial payments still exist for the BALANCE, in the Plan tab, which is
    // where paying over time actually makes sense.
    if (step.action === 'pay') runCheckout();
    else setSheet('upload');
  };

  // ('agree' and 'medical' are absent: both steps own their footer and return
  // before this is read.)
  const ctaLabel =
    step.action === 'pay'
      ? outstandingUsd > 0
        ? `Review & pay ${usd(outstandingUsd)}`
        : 'Pay'
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

  // ── Personal info renders INSIDE this screen too ─────────────────────────
  if (step.action === 'medical') {
    return (
      <MedicalStepInline
        key={step.requirement.requirementId}
        tripId={tripId}
        userId={userId}
        header={header}
        bottomInset={footerPad.paddingBottom}
        skippable={step.skippable}
        onSkip={skipStep}
        onSaved={completeStep}
      />
    );
  }

  // Deposit copy (Figma 17115:27201). "Secure your spot" is only true of the
  // deposit — the payment that buys the place.
  const isDeposit = step.kind === 'deposit';
  const stepTitle =
    isDeposit && payingInFull ? 'Full payment' : isDeposit ? 'Secure your spot' : catalog.title;
  const stepSub =
    isDeposit && payingInFull
      ? 'This trip is one payment. Pay the full cost to confirm your place.'
      : isDeposit
        ? 'Pay your deposit to confirm your place on this trip.'
        : catalog.helpText;
  const remainingAfterDeposit =
    isDeposit && !payingInFull && prices ? amountDue('balance', prices) : null;

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Keyed on the step so each one fades in as its own thing rather than
            the text swapping in place, which reads as a glitch. */}
        <Reanimated.View key={step.requirement.requirementId} entering={enter} exiting={exit}>
          <Text style={styles.title}>{stepTitle}</Text>
          <Text style={styles.sub}>{stepSub}</Text>

          {rejected && step.requirement.note ? (
            <View style={styles.calloutWarn}>
              <Ionicons name="alert-circle-outline" size={16} color={C.warn} />
              <Text style={styles.calloutWarnText}>{step.requirement.note}</Text>
            </View>
          ) : null}

          {step.action === 'pay' ? (
            <>
              {/* The trip being paid for — photo, name, place, dates. */}
              {trip ? (
                <TripSummaryCard
                  imageUrl={trip.hero_image_url}
                  name={tripName}
                  place={tripPlace}
                  range={tripRange}
                  style={styles.tripCard}
                />
              ) : null}

              <View style={styles.amountCard}>
                <Text style={styles.amountLabel}>
                  {isDeposit ? (payingInFull ? 'Full payment' : 'Deposit') : catalog.title}
                </Text>
                <Text style={styles.amountBig}>
                  {outstandingUsd > 0 ? usd(outstandingUsd) : '—'}
                </Text>
                {/* Suppressed when the deposit IS the total: "$3,000 / Trip
                    total $3,000" is a line that answers nothing and invites a
                    second look for the difference. */}
                {prices?.totalUsd != null && remainingAfterDeposit != null ? (
                  <>
                    <View style={styles.amountDivider} />
                    <View style={styles.amountRow}>
                      <Text style={styles.amountRowLabel}>Trip total</Text>
                      <Text style={styles.amountRowValue}>{usd(prices.totalUsd)}</Text>
                    </View>
                    <View style={styles.amountRow}>
                      <Text style={styles.amountRowLabel}>Remaining after deposit</Text>
                      <Text style={styles.amountRowValue}>{usd(remainingAfterDeposit)}</Text>
                    </View>
                  </>
                ) : null}
              </View>
            </>
          ) : (
            <View style={styles.illustration}>
              <TripIcon name={kindIcon(step.kind)} size={30} color={C.faint} />
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
              style={[styles.btn, busy && styles.btnDisabled]}
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

      {/* No sheet for the pay step — see openSheet(). It goes straight to
          Stripe Checkout for the full outstanding amount.

          One thing does come between: the cancellation policy, asked once per
          trip by the same hook the Plan tab uses, so the deposit and the
          balance are agreed in identical words. Not gated on the pay step the
          way the sheets above are gated on theirs: `step` advances the moment
          a payment lands, and unmounting a Modal mid-dismiss is the iOS
          stranded-touch-layer bug. */}
      <TripPolicyConsentSheet {...policyConsentSheetProps} />

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

// Sizes are the Figma MOBILE mode, read with get_variable_defs — the export's
// bold numbers are the desktop mode (bold 18 there is MB2 14 here).
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  // ── Step header (Figma "Step Process", 17115:27593) ──
  header: { paddingHorizontal: 16, paddingBottom: 16, alignItems: 'center', gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', height: 24, alignSelf: 'stretch' },
  headerSide: { width: 60, justifyContent: 'center' },
  headerSideRight: { alignItems: 'flex-end' },
  headerLabel: {
    flex: 1,
    ...textStyle('MB2', '700'),
    color: '#333333',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
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
    width: 237,
    height: 4,
    borderRadius: 8,
    backgroundColor: '#CFCFCF',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '100%',
    borderRadius: 8,
    backgroundColor: '#212121',
  },

  // ── Intro (Figma 17306:27733) ──
  introBar: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  introBackBtn: { padding: 8, borderRadius: 48 },
  // Card Shadow: 0 0 24 #00000017.
  introCard: {
    marginTop: 24,
    marginHorizontal: 16,
    backgroundColor: C.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.09,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  introBody: { paddingHorizontal: 16, paddingTop: 32 },

  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  /** The waiver step: a real flex container, not ScrollView content, so the
   *  document can take every pixel that is left and scroll itself. */
  bodyFill: { flex: 1, paddingBottom: 0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centreTop: { alignItems: 'center', marginBottom: 22 },

  // Headings/M H-5 (Montserrat 18/24) + Body/M B-2 — Figma 17115:27598/27600.
  title: { ...textStyles.MH5, color: '#333333', marginBottom: 4, textAlign: 'left' },
  sub: { ...textStyles.MB2, color: '#7B7B7B' },
  note: { ...textStyles.B3, color: '#333333', textAlign: 'center', marginTop: 12 },
  hint: { ...textStyles.B4, color: '#9A9A9A', textAlign: 'center', marginTop: 8 },

  bigIcon: {
    width: 64,
    height: 64,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  // ── Requirement cards (Figma 17114:26905) ──
  list: { marginTop: 24, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  rowIcon: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDone: { backgroundColor: C.doneTint },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...textStyle('MB2', '700'), color: '#333333' },
  rowTitleDim: { color: C.faint },
  rowSub: { ...textStyles.B3, color: '#333333' },

  pill: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#EEEEEE',
  },
  pillLater: { backgroundColor: C.warnTint, borderColor: C.warnTint },
  pillDone: { backgroundColor: C.doneTint, borderColor: C.doneTint },
  pillText: { ...textStyles.B4, color: '#333333' },
  pillTextLater: { color: C.warn },
  pillTextDone: { color: '#1F7A4D' },

  illustration: {
    marginTop: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D8D8D2',
    borderRadius: 16,
    backgroundColor: C.surface,
    paddingVertical: 30,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  illustrationText: { ...textStyles.B3, color: C.faint, textAlign: 'center' },

  // ── Deposit (Figma 17115:27201) ──
  tripCard: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FAFAFC',
  },
  tripCardBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 6,
    borderRadius: 16,
  },
  tripCardImg: { width: 112, height: 80, borderRadius: 8, backgroundColor: '#EEEEEE' },
  tripCardBody: { flex: 1, gap: 4 },
  tripCardTitle: { ...textStyle('MB2', '700'), color: '#333333' },
  tripCardMeta: { ...textStyles.B3, color: '#7B7B7B' },
  tripCardDates: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  amountCard: {
    marginTop: 24,
    padding: 12,
    gap: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: C.surface,
  },
  amountLabel: { ...textStyle('MB2', '700'), color: '#7B7B7B' },
  // Size/4xl 32 bold, -1 tracking (Figma 17115:27470).
  amountBig: {
    fontFamily: ff('Inter', '700'),
    fontSize: 32,
    letterSpacing: -1,
    color: '#333333',
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 24,
  },
  amountDivider: { height: 1, backgroundColor: '#EEEEEE', marginTop: -15 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -7 },
  amountRowLabel: { ...textStyles.MB2, color: '#7B7B7B' },
  amountRowValue: { ...textStyles.MB2, color: '#212121' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  metaText: { ...textStyles.B3, color: C.muted },

  calloutWarn: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: 16,
    backgroundColor: C.warnTint,
    borderRadius: 12,
    padding: 12,
  },
  calloutWarnText: { flex: 1, ...textStyles.B3, color: '#7A5A0A' },

  // ── Footer + buttons — the app's one primary CTA (Figma "Main Button"). ──
  footer: { paddingHorizontal: 30, paddingTop: 10, backgroundColor: C.bg },
  btn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#FFFFFF' },
  btnOutline: {
    height: 56,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  btnOutlineText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#333333' },

  confirmRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  confirmText: { ...textStyles.MB2, color: C.muted },
});
