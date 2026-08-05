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
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import Thumb from '../../Thumb';
import { Images } from '../../../assets/images';
import { ff } from '../../../theme/fonts';
import {
  fetchMedicalFlags,
  fetchTripMoney,
  fetchTravelerProfiles,
  buildSurfStats,
  type TripMoney,
} from '../../../services/trips/operatorDashboardService';
import { STRIPE_LIVEMODE } from '../../../services/trips/tripPaymentsService';
import { useConnectStatus } from '../../../hooks/trips/useConnectStatus';
import type { TravelerReview } from '../../../services/trips/tripDocumentsService';
import type { ReviewTraveler } from '../DocumentReviewScreen';
import { D } from './dashboardTheme';
import { formatUsd, plural } from './dashboardFormat';

export type TripDashboardTabProps = {
  tripId: string;
  /** Everyone on the trip except hosts, with names and avatars. */
  travelers: ReviewTraveler[];
  /** Per-traveler requirement state, from the screen's existing review query. */
  review: TravelerReview[];
  reviewLoading: boolean;
  /** Open the review flow. With a userId, straight into that person. */
  onOpenReview: (userId?: string) => void;
  /** Edit what this trip asks travelers for. Absent = this viewer may not. */
  onManageRequirements?: () => void;
};

export const TripDashboardTab: React.FC<TripDashboardTabProps> = ({
  tripId,
  travelers,
  review,
  reviewLoading,
  onOpenReview,
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

  return (
    <View style={styles.root}>
      {/* ── Mode notices ───────────────────────────────────────────────── */}
      <ModeNotices hiddenCount={money.data?.hiddenCount ?? 0} />

      {/* ── Payments not live yet ──────────────────────────────────────── */}
      <StripeBanner isOffline={money.data?.isOffline ?? true} loading={money.isPending} />

      {/* ── Needs review ───────────────────────────────────────────────── */}
      <ReviewBanner
        loading={reviewLoading}
        count={totalToReview}
        onPress={() => onOpenReview()}
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
        review={review}
        travelerCount={travelers.length}
        loading={reviewLoading}
        onPress={() => onOpenReview()}
        onManage={onManageRequirements}
      />

      {/* ── Medical flags ──────────────────────────────────────────────── */}
      <Section title="Medical flags" sub="Counts only. No names on this screen.">
        {medical.isPending ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : medical.isError ? (
          <Text style={styles.muted}>Could not load.</Text>
        ) : medical.data && medical.data.formsCompleted > 0 ? (
          <Text style={styles.body}>
            {plural(medical.data.injuriesReported, 'injury', 'injuries')} ·{' '}
            {plural(medical.data.allergiesReported, 'allergy', 'allergies')} ·{' '}
            {medical.data.dietaryReported} diet{' '}
            {medical.data.dietaryReported === 1 ? 'note' : 'notes'} ·{' '}
            {plural(medical.data.medicationsReported, 'medication')}
          </Text>
        ) : (
          <Text style={styles.muted}>Nobody has filled in the medical form yet.</Text>
        )}
      </Section>

      {/* ── Surf stats ─────────────────────────────────────────────────── */}
      <Section title="Surf stats">
        {profiles.isPending && userIds.length > 0 ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : (
          <SurfStatsBody profiles={[...(profiles.data?.values() ?? [])]} />
        )}
      </Section>

      {/* ── Travelers ──────────────────────────────────────────────────── */}
      <Section
        title="Travelers"
        sub="Tap someone to see everything about them."
        right={<Text style={styles.count}>{travelers.length}</Text>}
      >
        {travelers.length === 0 ? (
          <Text style={styles.muted}>Nobody has joined this trip yet.</Text>
        ) : (
          <View style={styles.list}>
            {[...travelers]
              // Alphabetical. This is the list you open to find one named
              // person; the review queue is where work-first ordering belongs.
              .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
              .map((t, i, arr) => (
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
    </View>
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
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        styles.bannerAccent,
        // Instant feedback. 0.97 is the app-wide press scale.
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name="time-outline" size={16} color="#FFFFFF" />
      <Text style={[styles.bannerText, { color: '#FFFFFF', flex: 1 }]}>
        {plural(count, 'document')} waiting for you
      </Text>
      <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
    </Pressable>
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
        <Text style={styles.muted}>That did not load.</Text>
        <Pressable onPress={onRetry} hitSlop={8} style={styles.retry}>
          <Text style={styles.link}>Try again</Text>
        </Pressable>
      </Section>
    );
  }
  // No pay steps and no price anywhere: this trip never charged for anything,
  // and an empty Money section is worse than none.
  if (!money || (money.steps.length === 0 && money.expectedUsd === 0)) return null;

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
 */
const DocumentsCard: React.FC<{
  review: TravelerReview[];
  travelerCount: number;
  loading: boolean;
  onPress: () => void;
  onManage?: () => void;
}> = ({ review, travelerCount, loading, onPress, onManage }) => {
  // Counts are derived from the review data the screen already holds, so this
  // costs no round trip. One pass, keyed by requirement.
  const rows = useMemo(() => {
    const out = new Map<
      string,
      { title: string; kind: string; received: number; approved: number }
    >();
    for (const t of review) {
      for (const item of t.items) {
        const row =
          out.get(item.requirementId) ??
          { title: item.title, kind: item.kind, received: 0, approved: 0 };
        // "Received" means the traveler has done their part — a submitted
        // upload, an agreed waiver, a completed medical form. Approved is a
        // subset of it, never the other way round.
        if (item.state === 'submitted' || item.state === 'approved') row.received += 1;
        if (item.state === 'approved') row.approved += 1;
        out.set(item.requirementId, row);
      }
    }
    return [...out.values()];
  }, [review]);

  const canManage = !!onManage;
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
        <Pressable
          onPress={onManage}
          style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color={D.accent} />
          <Text style={styles.emptyCtaText}>Ask for documents</Text>
        </Pressable>
      ) : (
        <View style={styles.list}>
          {rows.map((r, i) => (
            <Pressable
              key={`${r.title}-${i}`}
              onPress={onPress}
              style={({ pressed }) => [
                styles.row,
                i === rows.length - 1 && styles.rowLast,
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
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#C9C9C9" />
            </Pressable>
          ))}
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
      {docs && docs.toReview > 0 ? (
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

const styles = StyleSheet.create({
  root: { paddingTop: 8, gap: 0 },

  // ── banners ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  bannerText: { fontFamily: ff('Inter', '600'), fontSize: 13, lineHeight: 18, fontWeight: '600' },
  bannerAccent: { backgroundColor: D.accent },
  bannerOk: { backgroundColor: D.okBg },
  bannerWarn: { backgroundColor: D.warnBg },
  bannerDanger: { backgroundColor: D.dangerBg },
  bannerWait: { backgroundColor: D.waitBg },

  // ── section ──
  section: { paddingTop: 20, paddingBottom: 20, borderTopWidth: 1, borderTopColor: D.hairline },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  sectionHeadText: { flex: 1, gap: 4, paddingRight: 12 },
  sectionTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#333333',
  },
  sectionSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: '#6a7282' },
  count: { fontFamily: ff('Inter', '400'), fontSize: 13, color: D.muted },

  // ── text ──
  body: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 19, color: D.ink },
  muted: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 18, color: D.muted },
  spaced: { marginTop: 6 },
  link: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: D.accent },
  retry: { marginTop: 8 },

  // The one number the operator came here for. Big enough to read across a
  // table, which is where they will be standing.
  figure: {
    fontFamily: ff('Inter', '700'),
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: D.ink,
  },
  figureSub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: D.muted,
    marginTop: 2,
  },

  // ── rows ──
  list: { borderWidth: 1, borderColor: D.cardBorder, borderRadius: 16, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
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
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#333333',
  },
  rowSub: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 17, color: D.muted },
  counts: { fontFamily: ff('Inter', '400'), fontSize: 12, lineHeight: 17, color: D.muted },
  countsStrong: { fontFamily: ff('Inter', '600'), fontWeight: '600', color: '#333333' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFEFEF' },

  tagWait: { backgroundColor: D.waitBg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  tagWaitText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: D.wait,
  },

  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: D.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  emptyCtaText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    fontWeight: '600',
    color: '#333333',
  },

  pressed: { transform: [{ scale: 0.97 }] },
});

export default TripDashboardTab;
