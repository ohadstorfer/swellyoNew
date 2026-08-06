/**
 * TripDashboardTab — the operator's third tab, beside Overview and Plan.
 *
 * This is the mobile port of `operator-dashboard/` (the web site Eyal runs a
 * trip from). Same sections, same numbers, same order — read the web project's
 * `docs/SPEC.md` §4.2 before changing what appears here, because the two are
 * meant to agree.
 *
 * WHO SEES IT: hosts of an operator (`hosting_style = 'C'`) trip, nobody else.
 * The tab is not rendered at all otherwise — the gate lives in TripDetailScreen
 * so a non-host never even gets the tab label.
 *
 * WHAT MOVED: the host's Documents summary used to sit in Plan. It lives here
 * now. Plan is the traveler's view, for everyone, including the operator when
 * they want to see what their travelers see.
 *
 * NOTHING HERE WRITES TO THE DATABASE, and nothing here needed a migration:
 * every read is one the host was already allowed to make. See
 * operatorDashboardService.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import Thumb from '../../Thumb';
import { PressableScale } from '../PressableScale';
import { Images } from '../../../assets/images';
import { ff } from '../../../theme/fonts';
import {
  fetchMedicalFlags,
  fetchTripMoney,
  fetchTravelerProfiles,
  buildSurfStats,
  type TripMoney,
  type MedicalFlags,
} from '../../../services/trips/operatorDashboardService';
import { STRIPE_LIVEMODE } from '../../../services/trips/tripPaymentsService';
import { useConnectStatus } from '../../../hooks/trips/useConnectStatus';
import { remindRequirement, type TravelerReview } from '../../../services/trips/tripDocumentsService';
import { showErrorAlert } from '../../../utils/friendlyError';
import type { ReviewTraveler } from '../DocumentReviewScreen';
import { D } from './dashboardTheme';
import { formatUsd, plural, medicalFlagLine, outstandingUsd } from './dashboardFormat';
import {
  countLate,
  isLate,
  lateForTraveler,
  sortTravelers,
  tripPhase,
  type SortMode,
} from './dashboardWork';

export type TripDashboardTabProps = {
  tripId: string;
  /** `group_trips.start_date`. Null on a trip still being planned — the status
   *  line then drops the countdown rather than inventing one. */
  startDateISO?: string | null;
  endDateISO?: string | null;
  /** Everyone on the trip except hosts, with names and avatars. */
  travelers: ReviewTraveler[];
  /** Per-traveler requirement state, from the screen's existing review query. */
  review: TravelerReview[];
  reviewLoading: boolean;
  /** Open the review flow. With a userId, straight into that person. */
  onOpenReview: (userId?: string) => void;
  /** Open the review flow on one document type — every traveler's passport. */
  onOpenRequirement: (requirementId: string) => void;
  /** Open the review flow on everything that needs a decision. */
  onOpenWaiting: () => void;
  /** Edit what this trip asks travelers for. Absent = this viewer may not. */
  onManageRequirements?: () => void;
};

export const TripDashboardTab: React.FC<TripDashboardTabProps> = ({
  tripId,
  startDateISO,
  endDateISO,
  travelers,
  review,
  reviewLoading,
  onOpenReview,
  onOpenRequirement,
  onOpenWaiting,
  onManageRequirements,
}) => {
  const money = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
  });
  const medical = useQuery({
    queryKey: ['operatorDashboard', 'medical', tripId],
    queryFn: () => fetchMedicalFlags(tripId),
  });

  const userIds = useMemo(() => travelers.map(t => t.userId).sort(), [travelers]);
  const profiles = useQuery({
    queryKey: ['operatorDashboard', 'profiles', userIds],
    queryFn: () => fetchTravelerProfiles(userIds),
    enabled: userIds.length > 0,
  });

  const byUser = useMemo(() => {
    const m = new Map<string, TravelerReview>();
    review.forEach(r => m.set(r.userId, r));
    return m;
  }, [review]);

  const totalToReview = review.reduce((n, r) => n + r.toReview, 0);
  const totalLate = useMemo(() => countLate(review), [review]);

  // Default: worst first. The A–Z case is real — finding one named person — but
  // it is the exception, and it was the only order this list had.
  const [sortMode, setSortMode] = useState<SortMode>('work');
  const sorted = useMemo(
    () => sortTravelers(travelers, byUser, sortMode),
    [travelers, byUser, sortMode],
  );

  return (
    <View style={styles.root}>
      {/* ── Are you on track ───────────────────────────────────────────── */}
      <TripStatusLine
        startDateISO={startDateISO}
        endDateISO={endDateISO}
        late={totalLate}
        loading={reviewLoading}
      />

      {/* ── Mode notices ───────────────────────────────────────────────── */}
      <ModeNotices hiddenCount={money.data?.hiddenCount ?? 0} />

      {/* ── Payments not live yet ──────────────────────────────────────── */}
      <StripeBanner isOffline={money.data?.isOffline ?? true} loading={money.isPending} />

      {/* ── Needs review ───────────────────────────────────────────────── */}
      <ReviewBanner
        loading={reviewLoading}
        count={totalToReview}
        // Straight to the documents it is counting — every one that needs a
        // decision, whoever sent it. Same destination as the web banner.
        onPress={onOpenWaiting}
      />

      {/* ── Money ──────────────────────────────────────────────────────── */}
      <MoneyCard
        money={money.data ?? null}
        loading={money.isPending}
        failed={money.isError}
        onRetry={() => void money.refetch()}
      />

      {/* ── Documents ──────────────────────────────────────────────────── */}
      <DocumentsCard
        tripId={tripId}
        review={review}
        travelerCount={travelers.length}
        loading={reviewLoading}
        onOpenRequirement={onOpenRequirement}
        onManage={onManageRequirements}
      />

      {/* ── Travelers ──────────────────────────────────────────────────── */}
      {/* Above "About this group" now. Medical counts and surf stats used to
          sit here, and neither can be tapped or acted on — so on a phone the
          operator scrolled past two dead ends to reach the one list they came
          for. Reference material goes after the work. */}
      <Section
        title="Travelers"
        sub={
          sortMode === 'work'
            ? 'Whoever needs chasing first.'
            : 'Tap someone to see everything about them.'
        }
        right={
          <View style={styles.sortRow}>
            <Text style={styles.count}>{travelers.length}</Text>
            {travelers.length > 1 && (
              // Labelled with what tapping GIVES you, not the current state —
              // it is a link, and a link says where it goes.
              <Pressable
                onPress={() => setSortMode((m: SortMode) => (m === 'work' ? 'alpha' : 'work'))}
                hitSlop={10}
              >
                <Text style={styles.link}>{sortMode === 'work' ? 'A–Z' : 'By urgency'}</Text>
              </Pressable>
            )}
          </View>
        }
      >
        {travelers.length === 0 ? (
          <Text style={styles.muted}>Nobody has joined this trip yet.</Text>
        ) : (
          <View style={styles.list}>
            {sorted.map((t, i, arr) => (
              <TravelerRow
                key={t.userId}
                traveler={t}
                docs={byUser.get(t.userId) ?? null}
                money={money.data?.travelers.find(m => m.userId === t.userId) ?? null}
                isOffline={money.data?.isOffline ?? false}
                hasMoney={(money.data?.steps.length ?? 0) > 0}
                last={i === arr.length - 1}
                onPress={() => onOpenReview(t.userId)}
              />
            ))}
          </View>
        )}
      </Section>

      {/* ── About this group ───────────────────────────────────────────── */}
      {/* Two blocks that were two full sections. Both are read-only reference —
          neither leads anywhere — so they are one section with sub-headings
          rather than two headings competing with Money and Documents.
          Medical first: it changes how the trip is run. */}
      <Section title="About this group">
        <Text style={styles.aboutLabel}>Medical flags</Text>
        <Text style={styles.aboutSub}>Counts only. No names on this screen.</Text>
        {medical.isPending ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : medical.isError ? (
          <SectionError onRetry={() => void medical.refetch()} />
        ) : medical.data && medical.data.formsCompleted > 0 ? (
          <MedicalBody flags={medical.data} travelerCount={travelers.length} />
        ) : (
          <Text style={styles.muted}>Nobody has filled in the medical form yet.</Text>
        )}

        <Text style={[styles.aboutLabel, styles.aboutLabelNext]}>Surf</Text>
        {/* isError FIRST. Without it a failed fetch falls through to
            SurfStatsBody with an empty list, which renders "No travelers yet."
            on a trip with fifteen travelers — the screen stating something
            false and offering no way to find out otherwise. */}
        {profiles.isError ? (
          <SectionError onRetry={() => void profiles.refetch()} />
        ) : profiles.isPending && userIds.length > 0 ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : (
          <SurfStatsBody profiles={[...(profiles.data?.values() ?? [])]} />
        )}
      </Section>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Are you on track
// ---------------------------------------------------------------------------

/**
 * The one line that answers the question the operator actually came with.
 *
 * Before this, the tab had no idea when the trip was. "7/15 in" read exactly
 * the same three months out and three days out, and nothing was ever marked
 * late — so the operator held the trip date in their head and did the maths
 * themselves, every single time they opened the screen.
 *
 * NOTHING IS RENDERED WHILE THE REVIEW IS LOADING. A line that says "nothing
 * late" and flips to "2 late" a second later is worse than a beat of nothing:
 * the operator reads the first one and relaxes. Same reasoning as
 * StripeBanner's silence on `not_started`.
 */
const TripStatusLine: React.FC<{
  startDateISO?: string | null;
  endDateISO?: string | null;
  late: number;
  loading: boolean;
}> = ({ startDateISO, endDateISO, late, loading }) => {
  if (loading) return null;

  const phase = tripPhase(startDateISO, endDateISO);
  // Chasing is over once the trip has ended, so the late count stops being
  // something to act on and starts being a reproach.
  if (phase.kind === 'ended') {
    return (
      <View style={styles.statusLine}>
        <Text style={styles.statusText}>Trip ended</Text>
      </View>
    );
  }

  const when =
    phase.kind === 'upcoming'
      ? `${plural(phase.days, 'day')} to go`
      : phase.kind === 'today'
        ? 'Leaves today'
        : phase.kind === 'under_way'
          ? 'Under way'
          : null; // no start date — a trip still being planned

  return (
    <View style={styles.statusLine}>
      {when ? <Text style={styles.statusText}>{when}</Text> : null}
      {when ? <Text style={styles.statusDot}>·</Text> : null}
      <Text style={late > 0 ? styles.statusLate : styles.statusText}>
        {late > 0 ? `${plural(late, 'document')} late` : 'nothing late'}
      </Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Shared failure state
// ---------------------------------------------------------------------------

/**
 * One failure state for every section on this tab.
 *
 * There used to be three: Money offered a retry, Medical said "Could not load."
 * and left you there, and Surf stats said "No travelers yet." — which on a
 * fifteen-person trip was simply untrue, because a failed fetch falls through
 * to an empty list and an empty list means an empty trip.
 *
 * An operator cannot tell a network blip from an empty trip, so the screen has
 * to. Always say it did not load, and always offer the way out.
 */
const SectionError: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <>
    <Text style={styles.muted}>That did not load.</Text>
    <Pressable onPress={onRetry} hitSlop={8} style={styles.retry}>
      <Text style={styles.link}>Try again</Text>
    </Pressable>
  </>
);

// ---------------------------------------------------------------------------
// Medical
// ---------------------------------------------------------------------------

/**
 * Counts, with the denominator that makes them mean anything.
 *
 * "1 allergy" on its own is unusable: one of the two people who answered, or
 * one of fifteen? The first is a note to self, the second means the operator
 * still does not know what most of the group can eat. `formsCompleted` was
 * being fetched and used only as a `> 0` gate — the number was in hand and
 * never shown.
 *
 * Zeros are dropped rather than printed. "0 medications" is not information,
 * it is four words of noise sitting next to the counts that are.
 */
const MedicalBody: React.FC<{ flags: MedicalFlags; travelerCount: number }> = ({
  flags,
  travelerCount,
}) => {
  const line = medicalFlagLine(flags);
  return (
    <>
      <Text style={styles.body}>
        {flags.formsCompleted} of {travelerCount} filled in the medical form
      </Text>
      <Text style={[styles.muted, styles.spaced]}>{line || 'Nothing flagged.'}</Text>
    </>
  );
};

// ---------------------------------------------------------------------------
// Mode notices
// ---------------------------------------------------------------------------

/**
 * Test mode, and a mode mismatch.
 *
 * EXPO_PUBLIC_STRIPE_LIVEMODE has to flip together with the database setting
 * and the web dashboard's own flag. Three flags is three chances to forget one,
 * and forgetting is otherwise silent — the totals would simply be wrong with
 * nothing on screen to say so.
 */
const ModeNotices: React.FC<{ hiddenCount: number }> = ({ hiddenCount }) => (
  <>
    {!STRIPE_LIVEMODE && (
      <View style={[styles.banner, styles.bannerWarn]}>
        <Ionicons name="flask-outline" size={16} color={D.warn} />
        <Text style={[styles.bannerText, { color: D.warn }]}>
          Test mode — these are sandbox payments, not real money.
        </Text>
      </View>
    )}
    {hiddenCount > 0 && (
      <View style={[styles.banner, styles.bannerDanger]}>
        <Ionicons name="alert-circle-outline" size={16} color={D.danger} />
        <Text style={[styles.bannerText, { color: D.danger }]}>
          {plural(hiddenCount, 'payment is', 'payments are')} hidden. They come from the other
          Stripe mode — this app's setting may not match the database.
        </Text>
      </View>
    )}
  </>
);

// ---------------------------------------------------------------------------
// Payments not live yet
// ---------------------------------------------------------------------------

/**
 * The gap between "this trip collects payment" and "a traveler can pay today".
 *
 * That gap exists on purpose. Until 2026-08-05 an operator could not publish a
 * managed trip at all until Stripe had approved them, which meant the person
 * who had just filled in every form correctly was held at a button that said
 * "Connect Stripe" for as long as Stripe's review took. Now they publish, and
 * this banner is what keeps that honest: the trip is live, the money is not.
 *
 * Reads the SAME shared query as ConnectStripeCard (`useConnectStatus`), so an
 * approval that arrives while this screen is open updates both at once.
 */
const StripeBanner: React.FC<{ isOffline: boolean; loading: boolean }> = ({
  isOffline,
  loading,
}) => {
  // Offline trips are paid outside Swellyo and have no Stripe account to wait
  // on. `enabled` also keeps every operator running an offline trip from
  // making a Stripe round trip just by opening their dashboard.
  const managed = !loading && !isOffline;
  const { state, isLive } = useConnectStatus({ enabled: managed });

  if (!managed || isLive) return null;

  // Silence while we do not know yet. A banner that says "travelers cannot pay"
  // and then disappears a second later is worse than a beat of nothing.
  if (state === 'not_started') return null;

  // `wait` is this theme's "the operator's own backlog, not an error" colour,
  // and that is exactly what a review in progress is. Reaching for the warning
  // tint here would tell an operator something is wrong when nothing is.
  const tone =
    state === 'under_review'
      ? { bg: styles.bannerWait, fg: D.wait }
      : state === 'blocked'
        ? { bg: styles.bannerDanger, fg: D.danger }
        : { bg: styles.bannerWarn, fg: D.warn };

  const text =
    state === 'under_review'
      ? "Stripe is still checking your details. Travelers can join, but they can't pay yet — we'll let you know the moment they can."
      : state === 'blocked'
        ? 'Stripe turned down your payout account, so nobody can pay for this trip. Contact Stripe support.'
        : "Travelers can't pay yet. Finish connecting Stripe in Edit trip → Getting paid.";

  return (
    <View style={[styles.banner, tone.bg]}>
      {state === 'under_review' ? (
        // Motion says "elsewhere, something is happening" better than any
        // static icon, and this is the one state where nothing is wrong.
        <ActivityIndicator size="small" color={tone.fg} />
      ) : (
        <Ionicons name="alert-circle-outline" size={16} color={tone.fg} />
      )}
      <Text style={[styles.bannerText, { flex: 1, color: tone.fg }]}>{text}</Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Needs review
// ---------------------------------------------------------------------------

const ReviewBanner: React.FC<{
  loading: boolean;
  count: number;
  onPress: () => void;
}> = ({ loading, count, onPress }) => {
  if (loading) return null;

  // Nothing waiting is worth saying out loud — an operator checking in wants to
  // know they are clear, not to find an absence of banner and have to infer it.
  if (count === 0) {
    return (
      <View style={[styles.banner, styles.bannerOk]}>
        <Ionicons name="checkmark-circle-outline" size={16} color={D.ok} />
        <Text style={[styles.bannerText, { color: D.ok }]}>Nothing waiting for review</Text>
      </View>
    );
  }

  return (
    // 0.97 is the app-wide press scale, sprung rather than snapped — see
    // PressableScale. A static transform on a banner this wide reads as a
    // rendering glitch, not as a button answering you.
    <PressableScale
      onPress={onPress}
      style={[styles.banner, styles.bannerAccent]}
      accessibilityLabel={`${plural(count, 'document')} waiting for you`}
    >
      <Ionicons name="time-outline" size={16} color="#FFFFFF" />
      <Text style={[styles.bannerText, { color: '#FFFFFF', flex: 1 }]}>
        {plural(count, 'document')} waiting for you
      </Text>
      <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
    </PressableScale>
  );
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const MoneyCard: React.FC<{
  money: TripMoney | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}> = ({ money, loading, failed, onRetry }) => {
  if (loading) {
    return (
      <Section title="Money">
        <ActivityIndicator />
      </Section>
    );
  }
  if (failed) {
    return (
      <Section title="Money">
        <SectionError onRetry={onRetry} />
      </Section>
    );
  }
  // No pay steps and no price anywhere: this trip never charged for anything,
  // and an empty Money section is worse than none.
  if (!money || (money.steps.length === 0 && money.expectedUsd === 0)) return null;

  // Not shown on an offline trip: Swellyo does not know what arrived there, so
  // any "still owed" figure would be invented. The offline branch below never
  // reads this.
  const owedUsd = outstandingUsd(money.expectedUsd, money.collectedUsd);

  return (
    <Section title="Money">
      {money.isOffline ? (
        <>
          <Text style={styles.figure}>{formatUsd(money.expectedUsd)}</Text>
          <Text style={styles.figureSub}>expected in total</Text>
          <Text style={[styles.muted, styles.spaced]}>
            Payments for this trip happen outside Swellyo. Swellyo does not know what has
            arrived.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.figure}>{formatUsd(money.collectedUsd)}</Text>
          <Text style={styles.figureSub}>collected of {formatUsd(money.expectedUsd)}</Text>
          {/* Nobody running a trip thinks in "collected". They think in who
              still owes them, and until now the screen made them do the
              subtraction to reach the number they actually came for.

              Hidden at zero rather than shown as "$0 still owed": a collected
              figure that equals the expected one already says everyone has
              paid, and a zero here reads as a balance to chase. Clamped
              because an over-refund would otherwise print a negative. */}
          {owedUsd > 0 && <Text style={styles.owed}>{formatUsd(owedUsd)} still owed</Text>}
          <Text style={[styles.muted, styles.spaced]}>
            {money.steps
              .map(
                s =>
                  `${money.paidCountByKind[s.kind]} of ${money.travelers.length} paid the ${
                    s.kind === 'deposit' ? 'deposit' : 'balance'
                  }`,
              )
              .join(' · ') || 'This trip has no payment steps.'}
          </Text>
        </>
      )}
      {money.noPriceCount > 0 && (
        <Text style={[styles.muted, styles.spaced]}>
          {plural(money.noPriceCount, 'traveler has', 'travelers have')} no price set.
        </Text>
      )}
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * One line per requirement, showing RECEIVED and APPROVED.
 *
 * Both numbers, always. The gap between them is the operator's own backlog, and
 * showing only "approved" would make it read as a traveler problem.
 *
 * A row opens THAT requirement across every traveler. It used to open the
 * generic review queue — the same destination whichever row you tapped, which
 * made the seven rows and their chevrons a lie (Ohad, 5 Aug).
 */
const DocumentsCard: React.FC<{
  tripId: string;
  review: TravelerReview[];
  travelerCount: number;
  loading: boolean;
  onOpenRequirement: (requirementId: string) => void;
  onManage?: () => void;
}> = ({ tripId, review, travelerCount, loading, onOpenRequirement, onManage }) => {
  // Which row is mid-send, and what the last send reported. Keyed by
  // requirement so two rows cannot overwrite each other's message.
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  // Counts are derived from the review data the screen already holds, so this
  // costs no round trip. One pass, keyed by requirement.
  const rows = useMemo(() => {
    const out = new Map<
      string,
      {
        id: string;
        title: string;
        kind: string;
        reqType: string;
        received: number;
        approved: number;
        late: number;
      }
    >();
    for (const t of review) {
      for (const item of t.items) {
        const row =
          out.get(item.requirementId) ??
          {
            id: item.requirementId,
            title: item.title,
            kind: item.kind,
            reqType: item.reqType,
            received: 0,
            approved: 0,
            late: 0,
          };
        // "Received" means the traveler has done their part — a submitted
        // upload, an agreed waiver, a completed medical form. Approved is a
        // subset of it, never the other way round.
        if (item.state === 'submitted' || item.state === 'approved') row.received += 1;
        if (item.state === 'approved') row.approved += 1;
        // Late is NOT the complement of received: a rejected upload past its
        // deadline counts here and in neither of the two above. See
        // dashboardWork.isLate.
        if (isLate(item)) row.late += 1;
        out.set(item.requirementId, row);
      }
    }
    return [...out.values()];
  }, [review]);

  const canManage = !!onManage;

  /**
   * Chase everyone who still owes this one.
   *
   * Confirmed first, always. This sends a real push to real phones, and it is
   * one tap away from a row whose only other job is navigation — an accidental
   * brush must not notify fifteen people.
   */
  const remind = useCallback(
    (requirementId: string, title: string, owed: number) => {
      Alert.alert(
        `Remind ${plural(owed, 'person', 'people')}?`,
        `Everyone who has not sent “${title}” gets a notification. Anyone already reminded about it today is skipped.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send',
            onPress: async () => {
              setSending(requirementId);
              try {
                const n = await remindRequirement(tripId, requirementId);
                setSent(s => ({
                  ...s,
                  // The honest number. `n` is what the server actually sent —
                  // the cooldown may have dropped some — and an operator who is
                  // told "reminded 8" then hears nothing back needs to know
                  // whether the message went out at all.
                  [requirementId]:
                    n === 0
                      ? 'Everyone was already reminded today'
                      : n < owed
                        ? `Reminded ${n} · ${owed - n} already reminded today`
                        : `Reminded ${plural(n, 'person', 'people')}`,
                }));
              } catch (e) {
                showErrorAlert('Could not send reminders', e, 'Please try again.');
              } finally {
                setSending(null);
              }
            },
          },
        ],
      );
    },
    [tripId],
  );

  if (rows.length === 0 && !canManage && !loading) return null;

  return (
    <Section
      title="Documents"
      sub="What travelers need to send you"
      right={
        canManage && rows.length > 0 ? (
          <Pressable onPress={onManage} hitSlop={10}>
            <Text style={styles.link}>Edit</Text>
          </Pressable>
        ) : undefined
      }
    >
      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : rows.length === 0 ? (
        <PressableScale onPress={onManage} style={styles.emptyCta}>
          <Ionicons name="add" size={18} color={D.accent} />
          <Text style={styles.emptyCtaText}>Ask for documents</Text>
        </PressableScale>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => {
            const owed = Math.max(0, travelerCount - r.received);
            // Pay rows never get a Remind button: fetchTripReview hardcodes them
            // to `not_started`, so `owed` would read as everybody — including
            // the people who have already paid. The RPC refuses them too, so
            // the two sides agree rather than one being quietly wrong. (D3.)
            const canRemind = owed > 0 && r.reqType !== 'pay';
            const last = i === rows.length - 1;
            const message = sent[r.id];
            return (
              <View key={r.id}>
                <Pressable
                  onPress={() => onOpenRequirement(r.id)}
                  style={({ pressed }) => [
                    styles.row,
                    // The remind line below carries the divider when there is
                    // one, so the two never draw a rule between themselves.
                    (canRemind || message) && styles.rowLast,
                    last && !canRemind && !message && styles.rowLast,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={styles.counts}>
                    <Text style={styles.countsStrong}>
                      {r.received}/{travelerCount} in
                    </Text>
                    <Text style={styles.muted}>
                      {' '}
                      · {r.approved}/{travelerCount} ok
                    </Text>
                    {r.late > 0 && <Text style={styles.countsLate}> · {r.late} late</Text>}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#C9C9C9" />
                </Pressable>

                {message ? (
                  <View style={[styles.remindRow, last && styles.rowLast]}>
                    <Ionicons name="checkmark-circle-outline" size={15} color={D.ok} />
                    <Text style={styles.remindDone}>{message}</Text>
                  </View>
                ) : canRemind ? (
                  <Pressable
                    onPress={() => remind(r.id, r.title, owed)}
                    disabled={sending === r.id}
                    style={({ pressed }) => [
                      styles.remindRow,
                      last && styles.rowLast,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    {sending === r.id ? (
                      <ActivityIndicator size="small" color={D.accent} />
                    ) : (
                      <Ionicons name="notifications-outline" size={15} color={D.accent} />
                    )}
                    <Text style={styles.remindText}>
                      Remind {plural(owed, 'person', 'people')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Section>
  );
};

// ---------------------------------------------------------------------------
// Surf stats
// ---------------------------------------------------------------------------

const SurfStatsBody: React.FC<{
  profiles: { surfLevel: string | null; boardType: string | null; age: number | null; countryFrom: string | null }[];
}> = ({ profiles }) => {
  if (profiles.length === 0) return <Text style={styles.muted}>No travelers yet.</Text>;

  const s = buildSurfStats(profiles);
  const pretty = (k: string) => k.replace(/_/g, ' ');
  const list = (pairs: [string, number][]) =>
    pairs.map(([k, n]) => `${n} ${pretty(k)}`).join(' · ');

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.body}>{s.levels.length ? list(s.levels) : 'Surf level not set'}</Text>
      <Text style={styles.muted}>{s.boards.length ? list(s.boards) : 'Board type not set'}</Text>
      <Text style={styles.muted}>
        {s.ageMin !== null && `Ages ${s.ageMin}–${s.ageMax}`}
        {s.ageMin !== null && s.countryCount > 0 && ' · '}
        {s.countryCount > 0 && plural(s.countryCount, 'country', 'countries')}
      </Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Travelers
// ---------------------------------------------------------------------------

const TravelerRow: React.FC<{
  traveler: ReviewTraveler;
  docs: TravelerReview | null;
  money: { totalUsd: number | null; paidUsd: number } | null;
  isOffline: boolean;
  hasMoney: boolean;
  last: boolean;
  onPress: () => void;
}> = ({ traveler, docs, money, isOffline, hasMoney, last, onPress }) => {
  const late = lateForTraveler(docs);
  const detail =
    [
      docs ? `${docs.done}/${docs.total} approved` : null,
      hasMoney && money ? moneyLine(money, isOffline) : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'No details yet';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.rowPressed]}
    >
      {/* Same pattern as the review screen: Thumb serves the small square
          variant, and the default avatar stands in when there is no photo. */}
      {traveler.avatarUrl ? (
        <Thumb
          uri={traveler.avatarUrl}
          size={96}
          style={styles.avatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {traveler.name ?? 'Traveler'}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {/* At most one tag — two pills plus a chevron crowds a 36px row. Late
          wins: it is the worse fact, and "waiting" is already counted in the
          banner at the top of the tab. */}
      {late > 0 ? (
        <View style={styles.tagLate}>
          <Text style={styles.tagLateText}>{late} late</Text>
        </View>
      ) : docs && docs.toReview > 0 ? (
        <View style={styles.tagWait}>
          <Text style={styles.tagWaitText}>{docs.toReview} waiting</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color="#C9C9C9" />
    </Pressable>
  );
};

/**
 * One traveler's money, short enough for a list row.
 *
 * Both numbers, always — "paid in full" would need a threshold rule, and a list
 * row is not where money rules get invented. On an offline trip Swellyo has no
 * idea what arrived, so quoting a paid figure there would be a lie.
 */
function moneyLine(m: { totalUsd: number | null; paidUsd: number }, isOffline: boolean): string {
  if (m.totalUsd === null) return 'no price set';
  if (isOffline) return `${formatUsd(m.totalUsd)} · paid outside Swellyo`;
  return `${formatUsd(m.paidUsd)} of ${formatUsd(m.totalUsd)} paid`;
}

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

export const Section: React.FC<{
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, sub, right, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
    {children}
  </View>
);

// This tab is a peer of Plan and Overview, not of DocumentReviewScreen, so it
// is on the FIGMA type scale — 10 / 12 / 14 / 16 / 20 / 24 — and matches
// PlanSections value for value. The operator-documents screens it opens into
// run their own 12 / 13 / 14 / 15 / 17 scale; TravelerExtras renders inside one
// of them and stays there. See §2 of
// `docs/specs/operator-trips/dashboard-tab-design.md`.
const styles = StyleSheet.create({
  // 20, like `planSection`. Was 8, which started this tab a dozen pixels higher
  // than every other section on the screen.
  root: { paddingTop: 20, gap: 0 },

  // ── status line ──
  // Deliberately NOT a banner. It is a caption on the whole tab, not another
  // thing shouting at the operator from a coloured box — there are already up
  // to four of those directly beneath it.
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14 },
  statusText: { fontFamily: ff('Inter', '600'), fontSize: 14, lineHeight: 20, fontWeight: '600', color: D.muted },
  statusDot: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 20, color: D.muted },
  statusLate: { fontFamily: ff('Inter', '700'), fontSize: 14, lineHeight: 20, fontWeight: '700', color: D.danger },

  // ── banners ──
  // Radius 16 and a 16 gutter: banners are SURFACES, and every surface in Plan
  // is 16 (`ygCard`, `updatesCard`). Radius 12 is reserved for buttons there —
  // the commit pill — which is why these used to look like a different family.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 12,
  },
  bannerText: { fontFamily: ff('Inter', '600'), fontSize: 14, lineHeight: 20, fontWeight: '600' },
  bannerAccent: { backgroundColor: D.accent },
  bannerOk: { backgroundColor: D.okBg },
  bannerWarn: { backgroundColor: D.warnBg },
  bannerDanger: { backgroundColor: D.dangerBg },
  bannerWait: { backgroundColor: D.waitBg },

  // ── section ──
  section: { paddingTop: 20, paddingBottom: 20, borderTopWidth: 1, borderTopColor: D.hairline },
  // 16, the header gap PlanSections uses in all three of its own headers
  // (`sectionHeader`, `ygHeader`, and the screen's `planSectionHeading`).
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  sectionHeadText: { flex: 1, gap: 4, paddingRight: 12 },
  sectionTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#333333',
  },
  sectionSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#6a7282' },
  count: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: D.muted },

  // ── "About this group" sub-headings ──
  // 14/700 is PlanSections' sub-section heading (`sectionTitle`, non-large),
  // one step under this tab's own 16/700 section titles. Same relationship
  // Group Gear and Your Gear have to Packing & Gear over there.
  aboutLabel: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: D.ink,
    marginBottom: 6,
  },
  aboutSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: '#6a7282',
    marginTop: -4,
    marginBottom: 6,
  },
  // 20 between the two blocks — the same air a section gets, since these were
  // sections until they moved in together.
  aboutLabelNext: { marginTop: 20 },

  // ── text ──
  body: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 20, color: D.ink },
  muted: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: D.muted },
  spaced: { marginTop: 6 },
  // 14, like `ygViewAll` — this is the same "Edit" / "View all" affordance.
  link: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: D.accent },
  retry: { marginTop: 8 },

  // The one number the operator came here for. Big enough to read across a
  // table, which is where they will be standing — but capped at 24, which is
  // the trip title's size and the largest text anywhere in Trips. At 28 it was
  // bigger than the name of the trip it belongs to.
  figure: {
    fontFamily: ff('Inter', '700'),
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: D.ink,
  },
  figureSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: D.muted,
    marginTop: 2,
  },
  // The number the operator actually came for. Weighted above the muted
  // caption above it, below the collected figure — it is the answer to a
  // question, not the headline.
  owed: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: D.ink,
    marginTop: 6,
  },

  // ── rows ──
  list: { borderWidth: 1, borderColor: D.cardBorder, borderRadius: 16, overflow: 'hidden' },
  // 16 / 12 splits the difference between the two neighbours on purpose: the
  // gutter matches Plan's `ygRow` (16), the gap matches DocumentReviewScreen's
  // `row` (12), which is the screen a traveler row opens. The old 14 / 10
  // matched neither.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: D.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: '#F4F4F2' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#333333',
  },
  rowSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: D.muted },
  counts: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: D.muted },
  countsStrong: { fontFamily: ff('Inter', '600'), fontWeight: '600', color: '#333333' },
  // 36, the size DocumentReviewScreen draws the same faces at. Two pixels is
  // invisible on either screen alone and obvious one tap apart.
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFEFEF' },

  countsLate: { fontFamily: ff('Inter', '600'), fontWeight: '600', color: D.danger },

  // The chase action, as its own line under the row it belongs to. Indented to
  // the row's gutter and quieter than the title — it is an action ON that row,
  // not a sibling of it.
  remindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: D.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  remindText: { fontFamily: ff('Inter', '600'), fontSize: 13, lineHeight: 18, fontWeight: '600', color: D.accent },
  remindDone: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: D.ok },
  // Sort toggle sits beside the count, both right-aligned in the header.
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  tagLate: { backgroundColor: D.dangerBg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  tagLateText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: D.danger,
  },
  tagWait: { backgroundColor: D.waitBg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  tagWaitText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: D.wait,
  },

  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  emptyCtaText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#333333',
  },
});

export default TripDashboardTab;
