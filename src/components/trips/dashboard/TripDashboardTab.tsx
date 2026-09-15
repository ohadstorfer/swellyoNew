/**
 * TripDashboardTab — the top of the operator's Dashboard tab.
 *
 * Figma 14980-65921. The Dashboard and the Plan tab were merged: whoever runs an
 * operator trip now has Dashboard + Overview, and Plan's sections (members,
 * admin updates, staff, gear) render under this component in TripDetailScreen,
 * because they are driven by that screen's own state and sheets.
 *
 * This component owns the part that needs the money query:
 *   1. Warnings that stop a real mistake — test mode, a Stripe mode mismatch,
 *      Stripe not live yet. Kept on purpose (Ohad, 14 Sep); everything else the
 *      old tab carried (status line, Money card, Documents list, Travelers list,
 *      medical + surf stats) was dropped to match the design.
 *   2. Trip summary — Payments collected · Fully paid · Travelers.
 *   3. Action — Join requests · Documents · Payments, each a count and a way in.
 *
 * WHO SEES IT: the gate lives in TripDetailScreen (`canSeeDashboard`). Each
 * card below also gates on its own capability, because staff reach this tab
 * with only some of them.
 *
 * NOTHING HERE WRITES TO THE DATABASE. See operatorDashboardService.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { PressableScale } from '../PressableScale';
import { TripIcon, type TripIconName } from '../tripIcons';
import { ff } from '../../../theme/fonts';
import { fetchTripMoney, type TripMoney } from '../../../services/trips/operatorDashboardService';
import { STRIPE_LIVEMODE } from '../../../services/trips/tripPaymentsService';
import { useConnectStatus } from '../../../hooks/trips/useConnectStatus';
import { type TravelerReview } from '../../../services/trips/tripDocumentsService';
import { D } from './dashboardTheme';
import { formatUsd, plural } from './dashboardFormat';
import { tripSummary } from './dashboardWork';

export type TripDashboardTabProps = {
  tripId: string;
  /**
   * Per-card gates, from the viewer's capability set (useTripCapabilities).
   * UX only — every read is enforced again by RLS, so a wrong `true` shows an
   * empty card, never data. The money query is also disabled without it.
   */
  canViewMoney: boolean;
  canViewDocs: boolean;
  /** Per-traveler requirement state, from the screen's existing review query. */
  review: TravelerReview[];
  reviewLoading: boolean;
  /** Open the Documents list (Figma 14980-66552). */
  onOpenReview: () => void;
  /** How full the trip is, from `travelerCounts()` on the screen's own roster. */
  counts: { going: number; onboarding: number; capacity: number | null };
  /** Open the full payments ledger. Absent when this viewer may not see it. */
  onOpenPayments?: () => void;
  /** Pending join requests. */
  pendingRequestCount: number;
  /** Open the Members screen, where requests are decided. Absent = this viewer
   *  may not decide them, and the card is not drawn. */
  onOpenJoinRequests?: () => void;
};

export const TripDashboardTab: React.FC<TripDashboardTabProps> = ({
  tripId,
  canViewMoney,
  canViewDocs,
  review,
  reviewLoading,
  onOpenReview,
  counts,
  onOpenPayments,
  pendingRequestCount,
  onOpenJoinRequests,
}) => {
  const money = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
    enabled: canViewMoney,
  });

  const summary = useMemo(() => (money.data ? tripSummary(money.data) : null), [money.data]);
  const totalToReview = review.reduce((n, r) => n + r.toReview, 0);

  return (
    <View style={styles.root}>
      {canViewMoney && (
        <>
          <ModeNotices hiddenCount={money.data?.hiddenCount ?? 0} />
          <StripeBanner isOffline={money.data?.isOffline ?? true} loading={money.isPending} />
        </>
      )}

      {/* ── Trip summary ───────────────────────────────────────────────── */}
      <View style={styles.block}>
        <Text style={styles.sectionTitle}>Trip summary</Text>
        <SummaryTiles
          money={money.data ?? null}
          summary={summary}
          moneyLoading={money.isPending}
          canViewMoney={canViewMoney}
          counts={counts}
          onOpenPayments={onOpenPayments}
        />
      </View>

      {/* ── Action ─────────────────────────────────────────────────────── */}
      {(onOpenJoinRequests || canViewDocs || canViewMoney) && (
        <View style={[styles.block, styles.blockNext]}>
          <Text style={styles.sectionTitle}>Action</Text>
          <View style={styles.actionRow}>
            {onOpenJoinRequests ? (
              <ActionCard
                icon="user-plus-01"
                title="Join Request"
                sub={pendingRequestCount > 0 ? `${pendingRequestCount} pending` : 'None pending'}
                count={pendingRequestCount}
                onPress={onOpenJoinRequests}
              />
            ) : (
              <View style={styles.actionSlot} />
            )}
            {canViewDocs ? (
              <ActionCard
                icon="file-check-01"
                title="Document"
                sub={
                  reviewLoading
                    ? 'Loading…'
                    : totalToReview > 0
                      ? `${totalToReview} to review`
                      : 'Nothing to review'
                }
                count={reviewLoading ? 0 : totalToReview}
                // Always the Documents list; the badge says how much is waiting
                // inside it (Figma 14980-66552).
                onPress={onOpenReview}
              />
            ) : (
              <View style={styles.actionSlot} />
            )}
            {canViewMoney ? (
              <PaymentsActionCard
                money={money.data ?? null}
                loading={money.isPending}
                stillOwe={summary ? summary.priced - summary.fullyPaid : 0}
                onPress={onOpenPayments}
              />
            ) : (
              <View style={styles.actionSlot} />
            )}
          </View>
        </View>
      )}
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
 * An operator can publish before Stripe approves them, so the trip is live and
 * the money is not. Reads the SAME shared query as ConnectStripeCard
 * (`useConnectStatus`), so an approval that arrives while this screen is open
 * updates both at once.
 */
const StripeBanner: React.FC<{ isOffline: boolean; loading: boolean }> = ({
  isOffline,
  loading,
}) => {
  // Offline trips are paid outside Swellyo and have no Stripe account to wait
  // on. `enabled` also keeps them from making a Stripe round trip at all.
  const managed = !loading && !isOffline;
  const { state, isLive } = useConnectStatus({ enabled: managed });

  if (!managed || isLive) return null;

  // Silence while we do not know yet. A banner that says "travelers cannot pay"
  // and then disappears a second later is worse than a beat of nothing.
  if (state === 'not_started') return null;

  // `wait` is this theme's "the operator's own backlog, not an error" colour —
  // a review in progress is not something wrong.
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
        <ActivityIndicator size="small" color={tone.fg} />
      ) : (
        <Ionicons name="alert-circle-outline" size={16} color={tone.fg} />
      )}
      <Text style={[styles.bannerText, { flex: 1, color: tone.fg }]}>{text}</Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Trip summary
// ---------------------------------------------------------------------------

/**
 * Payments collected · Fully paid · Travelers.
 *
 * "Collected" gets the wide tile and the other two share a row: the money is
 * one number the operator watches move, the other two are ratios they check.
 *
 * The travelers tile counts seats, and says the onboarding group out loud
 * underneath rather than swallowing it — `participant_count` cannot see anyone
 * still onboarding. See `travelerCounts`.
 */
const SummaryTiles: React.FC<{
  money: TripMoney | null;
  summary: ReturnType<typeof tripSummary> | null;
  moneyLoading: boolean;
  canViewMoney: boolean;
  counts: { going: number; onboarding: number; capacity: number | null };
  onOpenPayments?: () => void;
}> = ({ money, summary, moneyLoading, canViewMoney, counts, onOpenPayments }) => {
  // An offline trip collects nothing through Swellyo, so a "collected" figure
  // would be invented. It keeps the expected total and loses the bar.
  const isOffline = money?.isOffline ?? false;
  const pct =
    summary && summary.expectedUsd > 0
      ? Math.min(1, Math.max(0, summary.collectedUsd / summary.expectedUsd))
      : 0;
  const paidPct = summary && summary.priced > 0 ? summary.fullyPaid / summary.priced : 0;
  const seatPct =
    counts.capacity && counts.capacity > 0 ? Math.min(1, counts.going / counts.capacity) : 0;

  return (
    <View style={styles.tiles}>
      {canViewMoney && (
        <PressableScale
          onPress={onOpenPayments}
          disabled={!onOpenPayments}
          style={styles.tile}
          accessibilityLabel={onOpenPayments ? 'Open every payment on this trip' : undefined}
        >
          <TileHead icon="wallet-03" label={isOffline ? 'Expected in total' : 'Payments collected'} />
          {moneyLoading ? (
            <ActivityIndicator style={styles.tileSpinner} />
          ) : (
            <View style={styles.tileBody}>
              <View style={styles.tileFigureRow}>
                <Text style={styles.tileFigure} numberOfLines={1}>
                  {formatUsd(isOffline ? summary?.expectedUsd : summary?.collectedUsd)}
                </Text>
                {!isOffline && summary ? (
                  <Text style={styles.tileSub}>Of {formatUsd(summary.expectedUsd)}</Text>
                ) : null}
              </View>
              {!isOffline ? <Meter pct={pct} /> : null}
            </View>
          )}
        </PressableScale>
      )}

      <View style={styles.tileRow}>
        {canViewMoney && (
          <View style={[styles.tile, styles.tileHalf]}>
            <TileHead icon="wallet-03" label="Fully paid" />
            {moneyLoading ? (
              <ActivityIndicator style={styles.tileSpinner} />
            ) : (
              <View style={styles.tileBody}>
                <View style={styles.tileFigureRow}>
                  <Text style={styles.tileFigure} numberOfLines={1}>
                    {summary ? `${summary.fullyPaid}/${summary.priced}` : '—'}
                  </Text>
                  <Text style={styles.tileSub} numberOfLines={1}>
                    {summary && summary.fullyPaid > 0
                      ? `${formatUsd(summary.fullyPaidUsd)} total`
                      : 'Nobody yet'}
                  </Text>
                </View>
                <Meter pct={paidPct} />
              </View>
            )}
          </View>
        )}

        <View style={[styles.tile, styles.tileHalf]}>
          <TileHead icon="users-02" label="Travelers" />
          <View style={styles.tileBody}>
            <View style={styles.tileFigureRow}>
              <Text style={styles.tileFigure} numberOfLines={1}>
                {counts.capacity ? `${counts.going}/${counts.capacity}` : `${counts.going}`}
              </Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {counts.onboarding > 0 ? `+${counts.onboarding} joining` : 'Travelers'}
              </Text>
            </View>
            {counts.capacity ? <Meter pct={seatPct} /> : null}
          </View>
        </View>
      </View>
    </View>
  );
};

const TileHead: React.FC<{ icon: TripIconName; label: string }> = ({ icon, label }) => (
  <View style={styles.tileHead}>
    <TripIcon name={icon} size={16} color={D.muted} />
    <Text style={styles.tileLabel} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

/** The progress rule under a tile's figure. Never animated: this is a status
 *  readout, and a bar that grows on every refetch reads as activity. */
const Meter: React.FC<{ pct: number }> = ({ pct }) => (
  <View style={styles.meter}>
    <View style={[styles.meterFill, { width: `${Math.round(pct * 100)}%` }]} />
  </View>
);

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/** One way into the work. The red count is what needs doing; zero hides it. */
const ActionCard: React.FC<{
  icon: TripIconName;
  title: string;
  sub: string;
  count: number;
  onPress?: () => void;
}> = ({ icon, title, sub, count, onPress }) => (
  // The column is the wrapper, not the card: PressableScale puts `style` on an
  // inner view, so `flex: 1` there left each card only as wide as its text.
  <View style={styles.actionSlot}>
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      style={styles.actionCard}
      accessibilityLabel={`${title}, ${sub}`}
    >
      <View style={styles.actionTop}>
        <View style={styles.actionIcon}>
          <TripIcon name={icon} size={18} color="#222B30" />
        </View>
        {count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
        ) : null}
      </View>
      <View>
        <Text style={styles.actionTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {title}
        </Text>
        <Text style={styles.actionSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </PressableScale>
  </View>
);

/**
 * Payments — how many travelers still owe money (Ohad, 14 Sep). Same "fully
 * paid" rule as the summary tile, so the two can never disagree.
 *
 * No count on an offline trip: Swellyo does not know what arrived there, so
 * "3 still owe" would be invented.
 */
const PaymentsActionCard: React.FC<{
  money: TripMoney | null;
  loading: boolean;
  stillOwe: number;
  onPress?: () => void;
}> = ({ money, loading, stillOwe, onPress }) => {
  const isOffline = money?.isOffline ?? false;
  const sub = loading
    ? 'Loading…'
    : isOffline
      ? 'Paid outside Swellyo'
      : !money || money.travelers.length === 0
        ? 'No travelers yet'
        : stillOwe > 0
          ? `${stillOwe} still owe`
          : 'All paid';
  return (
    <ActionCard
      icon="wallet-03"
      title="Payments"
      sub={sub}
      count={loading || isOffline ? 0 : stillOwe}
      onPress={onPress}
    />
  );
};

// Figma 14980-65921, sizes read with get_variable_defs per node: section
// titles and tile figures Size/lg 16/24; action card titles Size/s 12/18;
// labels Size/s 12/18; captions Size/xs 10/17. The bold ones come out of the
// code export 4px too big (20 / 16) — never size text from that export.
const styles = StyleSheet.create({
  root: { paddingTop: 20 },
  block: { gap: 16 },
  blockNext: { marginTop: 32 },
  sectionTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#333333',
  },

  // ── banners ──
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
  bannerWarn: { backgroundColor: D.warnBg },
  bannerDanger: { backgroundColor: D.dangerBg },
  bannerWait: { backgroundColor: D.waitBg },

  // ── Trip summary tiles ──
  tiles: { gap: 8 },
  tileRow: { flexDirection: 'row', gap: 8 },
  tile: {
    borderWidth: 1,
    borderColor: D.cardBorder,
    borderRadius: 16,
    backgroundColor: D.surface,
    padding: 16,
    gap: 12,
  },
  tileHalf: { flex: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tileLabel: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: D.muted,
  },
  tileSpinner: { alignSelf: 'flex-start', marginVertical: 6 },
  tileBody: { gap: 4 },
  tileFigureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  tileFigure: {
    flex: 1,
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#333333',
  },
  tileSub: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: D.muted },
  meter: { height: 6, borderRadius: 8, backgroundColor: '#E4E4E4', overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 8, backgroundColor: '#05BCD3' },

  // ── Action cards ──
  actionRow: { flexDirection: 'row', gap: 8 },
  // Keeps three columns when a card is gated off, so the rest do not stretch.
  actionSlot: { flex: 1 },
  actionCard: {
    borderWidth: 1,
    borderColor: D.cardBorder,
    borderRadius: 16,
    backgroundColor: D.surface,
    padding: 8,
    gap: 8,
  },
  actionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  actionIcon: { backgroundColor: '#F7F7F7', borderRadius: 8, padding: 10 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: '#FF5367',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 10,
    lineHeight: 17,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  actionTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#333333',
  },
  actionSub: { fontFamily: ff('Inter', '400'), fontSize: 10, lineHeight: 17, color: '#A0A0A0' },
});

export default TripDashboardTab;
