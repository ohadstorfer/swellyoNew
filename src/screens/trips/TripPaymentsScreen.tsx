/**
 * TripPaymentsScreen — every payment on one trip, newest first.
 *
 * Product Specs §"Trip operator view": "Payments page — view all transactions,
 * amounts, profiles, times, export options."
 *
 * Layout is Figma node 17776:48624: a "Payment Summary" block, then the ledger.
 *
 * ── What this screen is NOT ────────────────────────────────────────────────
 * It derives no figure of its own. Every number in the summary comes from
 * `tripSummary` / `payStatusCounts` in dashboardWork — the same functions the
 * Dashboard tiles use — because a second derivation here is how two screens
 * come to disagree about the same trip. The ledger below is a list, a filter
 * and an export.
 *
 * ── Why failed attempts are here, and off by default ───────────────────────
 * `TripMoney.events` drops them, correctly: they moved no money, so they must
 * not reach a total. But "she says she paid and it didn't work" is the single
 * most common thing an operator brings to this screen, and the answer is a
 * failed row with a timestamp. So the ledger holds them and a toggle reveals
 * them — never counted, always findable.
 *
 * The same is true of the other Stripe mode. `is_livemode` rows from the mode
 * this build does not count are shown with the toggle and marked, rather than
 * silently missing from a page that claims to show everything.
 *
 * Gated on `payments.view_status`, the same capability the Money card uses.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SectionList,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Thumb from '../../components/Thumb';
import { Image } from 'expo-image';
import { Images } from '../../assets/images';
import { textStyle, textStyles } from '../../theme/typography';
import { PressableScale } from '../../components/trips/PressableScale';
import { TripIcon } from '../../components/trips/tripIcons';
import { D } from '../../components/trips/dashboard/dashboardTheme';
import { formatUsd } from '../../components/trips/dashboard/dashboardFormat';
import { payStatusCounts, tripSummary } from '../../components/trips/dashboard/dashboardWork';
import { useOnboarding } from '../../context/OnboardingContext';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import {
  fetchPaymentLedger,
  fetchTripMoney,
  ledgerToCsv,
  type LedgerEvent,
  type TripMoney,
} from '../../services/trips/operatorDashboardService';
import { STRIPE_LIVEMODE } from '../../services/trips/tripPaymentsService';
import { showErrorAlert } from '../../utils/friendlyError';
import { shareTextAsFile } from '../../services/trips/exportService';

// Neutrals mirror the sibling "view all" screens (TripMembers / TripUpdates).
// The three status colours are the Figma ones, shared with the Guests payments
// list so a bar segment and a pill are always the same colour.
const T = {
  ink: '#212121',
  title: '#333333',
  count: '#7B7B7B',
  faint: '#A0A0A0',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  cardBorder: '#EEEEEE',
  track: '#E4E4E4',
  collected: '#B72DF2',
  full: '#2BCCBD',
  deposit: '#FFB443',
  awaiting: '#CFCFCF',
} as const;

const KIND_COPY: Record<string, { label: string; tone: 'paid' | 'refund' | 'failed' }> = {
  paid: { label: 'Payment', tone: 'paid' },
  refunded: { label: 'Refund', tone: 'refund' },
  failed: { label: 'Failed', tone: 'failed' },
};

export const TripPaymentsScreen: React.FC<{
  tripId: string;
  tripTitle?: string | null;
  onBack: () => void;
  /** Names and faces, from the roster the caller already holds — this screen
   *  fetches no profiles of its own. */
  travelers: { userId: string; name: string | null; avatarUrl: string | null }[];
  /** Open the per-traveler status list — the "Total Guests Payments" tile. */
  onOpenGuestPayments?: () => void;
}> = ({ tripId, tripTitle, onBack, travelers, onOpenGuestPayments }) => {
  const insets = useSafeAreaInsets();
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  const ledger = useQuery({
    queryKey: ['operatorDashboard', 'ledger', tripId],
    queryFn: () => fetchPaymentLedger(tripId),
  });
  // The step titles ("Deposit" beside an amount) and the summary block. The
  // Dashboard has already made this query and cached it under this exact key.
  const money = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
  });

  // Only for the trip's base price. Hits the cache TripDetail seeded.
  const trip = useTripCore(tripId, currentUserId).data?.trip ?? null;

  const names = useMemo(() => {
    const m = new Map<string, string>();
    travelers.forEach(t => m.set(t.userId, t.name ?? 'Traveler'));
    return m;
  }, [travelers]);
  const avatars = useMemo(() => {
    const m = new Map<string, string | null>();
    travelers.forEach(t => m.set(t.userId, t.avatarUrl));
    return m;
  }, [travelers]);
  const stepTitles = useMemo(() => {
    const m = new Map<string, string>();
    (money.data?.steps ?? []).forEach(s => m.set(s.requirementId, s.title));
    return m;
  }, [money.data?.steps]);

  const rows = ledger.data ?? [];
  const hidden = rows.filter(r => !visibleAlways(r)).length;
  const shown = showAll ? rows : rows.filter(visibleAlways);

  // Grouped by day. A ledger read on a phone is scrolled, not scanned, and a
  // date heading is what stops "three payments" from reading as one event.
  const sections = useMemo(() => {
    const byDay = new Map<string, LedgerEvent[]>();
    for (const r of shown) {
      const key = (r.createdAt ?? '').slice(0, 10) || 'unknown';
      const list = byDay.get(key) ?? [];
      list.push(r);
      byDay.set(key, list);
    }
    return [...byDay.entries()].map(([day, data]) => ({ title: dayLabel(day), data }));
  }, [shown]);

  const exportCsv = async () => {
    if (exporting || rows.length === 0) return;
    setExporting(true);
    try {
      // The EXPORT always carries everything, whatever the toggle says. A
      // filtered spreadsheet is a spreadsheet that quietly lies to whoever
      // opens it next, and the mode column is right there to filter on.
      const csv = ledgerToCsv(rows, names, stepTitles);
      const safe = (tripTitle ?? 'trip').replace(/[^\w\-]+/g, '-').slice(0, 40);
      await shareTextAsFile(csv, `payments-${safe}.csv`, 'text/csv');
    } catch (e) {
      showErrorAlert('Could not export', e, 'Could not build the payments file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Payments
        </Text>
        <PressableScale
          onPress={exportCsv}
          disabled={exporting || rows.length === 0}
          style={[styles.exportBtn, rows.length === 0 && styles.exportOff]}
          accessibilityLabel="Export every payment as a spreadsheet"
        >
          <Text style={styles.exportText}>Export</Text>
          {exporting ? (
            <ActivityIndicator size="small" color="#FFFFFF" style={styles.exportIcon} />
          ) : (
            <Ionicons name="share-outline" size={18} color="#FFFFFF" />
          )}
        </PressableScale>
      </View>

      {/* The summary is the list's header, so it shows whatever the ledger is
          doing — loading, failed or empty all render under it. */}
      <SectionList
        style={styles.body}
        sections={ledger.isSuccess ? sections : []}
        keyExtractor={r => r.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            <Summary
              money={money.data ?? null}
              loading={money.isPending}
              basePriceUsd={trip?.cost_per_person ?? null}
              travelers={travelers}
              onOpenGuestPayments={onOpenGuestPayments}
            />
            {hidden > 0 ? (
              <PressableScale onPress={() => setShowAll(v => !v)} style={styles.toggle}>
                <Ionicons
                  name={showAll ? 'eye-off-outline' : 'eye-outline'}
                  size={15}
                  color={D.wait}
                />
                <Text style={styles.toggleText}>
                  {showAll
                    ? 'Hide failed attempts and other-mode rows'
                    : `Show ${hidden} failed ${hidden === 1 ? 'attempt' : 'attempts'} and test rows`}
                </Text>
              </PressableScale>
            ) : null}
          </>
        }
        ListEmptyComponent={
          ledger.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : ledger.isError ? (
            <View style={styles.center}>
              <Text style={styles.muted}>That did not load.</Text>
              <Pressable onPress={() => void ledger.refetch()} hitSlop={8}>
                <Text style={styles.link}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.muted}>Nobody has paid for this trip yet.</Text>
            </View>
          )
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHead}>{section.title}</Text>
        )}
        renderItem={({ item, index, section }) => (
          <Row
            row={item}
            name={names.get(item.userId) ?? 'Traveler'}
            avatarUrl={avatars.get(item.userId) ?? null}
            what={item.requirementId ? stepTitles.get(item.requirementId) ?? null : null}
            first={index === 0}
            last={index === section.data.length - 1}
          />
        )}
      />
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// Payment Summary
// ---------------------------------------------------------------------------

const Summary: React.FC<{
  money: TripMoney | null;
  loading: boolean;
  basePriceUsd: number | null;
  travelers: { userId: string; avatarUrl: string | null }[];
  onOpenGuestPayments?: () => void;
}> = ({ money, loading, basePriceUsd, travelers, onOpenGuestPayments }) => {
  const summary = money ? tripSummary(money) : null;
  const counts = money ? payStatusCounts(money.travelers) : null;
  // An offline trip collects nothing through Swellyo, so a "collected" figure
  // or a count of who has paid would be invented — same call TripDashboardTab
  // makes. It keeps the expected total and loses the bars and the legend.
  const isOffline = money?.isOffline ?? false;
  const pct =
    summary && summary.expectedUsd > 0
      ? Math.min(1, Math.max(0, summary.collectedUsd / summary.expectedUsd))
      : 0;
  const faces = travelers.slice(0, 3);

  return (
    <View style={styles.summary}>
      <Text style={styles.summaryTitle}>Payment Summary</Text>

      <View style={styles.tileRow}>
        <View style={[styles.tile, styles.tileHalf]}>
          <Text style={styles.tileLabel}>Base trip price</Text>
          <View>
            <Text style={styles.tileFigure} numberOfLines={1}>
              {formatUsd(basePriceUsd)}
            </Text>
            <Text style={styles.tileSub} numberOfLines={1}>
              before adjustments
            </Text>
          </View>
        </View>

        <View style={[styles.tile, styles.tileHalf]}>
          <Text style={styles.tileLabel}>{isOffline ? 'Expected in total' : 'Total collected'}</Text>
          {loading ? (
            <ActivityIndicator style={styles.tileSpinner} />
          ) : (
            <View style={styles.tileBody}>
              <Text style={styles.tileFigure} numberOfLines={1}>
                {formatUsd(isOffline ? summary?.expectedUsd : summary?.collectedUsd)}
              </Text>
              {!isOffline ? (
                <View style={styles.bar}>
                  {pct > 0 ? (
                    <View style={[styles.barFill, { flex: pct, backgroundColor: T.collected }]} />
                  ) : null}
                  {pct < 1 ? (
                    <View style={[styles.barFill, { flex: 1 - pct, backgroundColor: T.track }]} />
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <PressableScale
        onPress={onOpenGuestPayments}
        disabled={!onOpenGuestPayments}
        style={styles.tile}
        accessibilityLabel={onOpenGuestPayments ? 'Open what each guest has paid' : undefined}
      >
        <View style={styles.tileHead}>
          <View style={styles.tileHeadLeft}>
            <TripIcon name="users-02" size={18} color={T.title} />
            <Text style={styles.tileLabel}>Total Guests Payments</Text>
          </View>
          {onOpenGuestPayments ? <TripIcon name="chevron-right" size={24} color={T.title} /> : null}
        </View>
        {loading ? (
          <ActivityIndicator style={styles.tileSpinner} />
        ) : (
          <View style={styles.tileBody}>
            <View style={styles.guestsRow}>
              {/* Fully paid over priced — the Dashboard's "Fully paid" figure. */}
              <Text style={styles.tileFigure} numberOfLines={1}>
                {isOffline
                  ? `${money?.travelers.length ?? 0}`
                  : summary
                    ? `${summary.fullyPaid}/${summary.priced}`
                    : '—'}
              </Text>
              <View style={styles.faces}>
                {faces.map((t, i) =>
                  t.avatarUrl ? (
                    <Thumb
                      key={t.userId}
                      uri={t.avatarUrl}
                      size={84}
                      style={[styles.face, i > 0 && styles.faceOverlap, { zIndex: faces.length - i }]}
                      contentFit="cover"
                    />
                  ) : (
                    <Image
                      key={t.userId}
                      source={Images.defaultAvatar}
                      style={[styles.face, i > 0 && styles.faceOverlap, { zIndex: faces.length - i }]}
                      contentFit="cover"
                    />
                  ),
                )}
              </View>
            </View>
            {isOffline ? (
              <Text style={styles.tileSub}>Paid outside Swellyo</Text>
            ) : (
              <View style={styles.bar}>
                {counts && counts.full > 0 ? (
                  <View style={[styles.barFill, { flex: counts.full, backgroundColor: T.full }]} />
                ) : null}
                {counts && counts.deposit > 0 ? (
                  <View
                    style={[styles.barFill, { flex: counts.deposit, backgroundColor: T.deposit }]}
                  />
                ) : null}
                {!counts || counts.awaiting > 0 || counts.full + counts.deposit === 0 ? (
                  <View
                    style={[
                      styles.barFill,
                      { flex: counts?.awaiting || 1, backgroundColor: T.track },
                    ]}
                  />
                ) : null}
              </View>
            )}
          </View>
        )}
      </PressableScale>

      {!isOffline && !loading && counts ? (
        <View style={styles.legend}>
          <LegendChip color={T.full} count={counts.full} label="Full paid" />
          <LegendChip color={T.deposit} count={counts.deposit} label="Deposit paid" />
          <LegendChip color={T.awaiting} count={counts.awaiting} label="Awaiting" />
        </View>
      ) : null}
    </View>
  );
};

const LegendChip: React.FC<{ color: string; count: number; label: string }> = ({
  color,
  count,
  label,
}) => (
  <View style={styles.chip} accessible accessibilityLabel={`${label}: ${count}`}>
    <View style={[styles.chipDot, { backgroundColor: color }]}>
      <Text style={styles.chipCount}>{count}</Text>
    </View>
    <Text style={styles.chipLabel} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

/** A row that belongs to this build's Stripe mode and actually moved money. */
function visibleAlways(r: LedgerEvent): boolean {
  return r.counted && r.eventType !== 'failed';
}

const Row: React.FC<{
  row: LedgerEvent;
  name: string;
  avatarUrl: string | null;
  what: string | null;
  /** Position in its day — a day's rows are one card with square joins. */
  first: boolean;
  last: boolean;
}> = ({ row, name, avatarUrl, what, first, last }) => {
  const copy = KIND_COPY[row.eventType] ?? KIND_COPY.paid;
  return (
    <View style={[styles.row, first && styles.rowFirst, last && styles.rowLast]}>
      {avatarUrl ? (
        <Thumb uri={avatarUrl} size={84} style={styles.avatar} contentFit="cover" />
      ) : (
        <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {[what ?? copy.label, timeLabel(row.createdAt)].filter(Boolean).join(' • ')}
          {!row.counted ? (
            <Text style={styles.rowFlag}>{`  ${row.isLivemode ? 'live' : 'test'} mode`}</Text>
          ) : null}
        </Text>
      </View>
      <Text
        style={[
          styles.amount,
          copy.tone === 'refund' && styles.amountRefund,
          copy.tone === 'failed' && styles.amountFailed,
        ]}
      >
        {copy.tone === 'failed'
          ? 'Failed'
          : copy.tone === 'refund'
            ? // A refund is stored negative; the minus is drawn here so it reads
              // "- $100" whichever sign the row carries.
              `- ${formatUsd(Math.abs(row.amountUsd))}`
            : formatUsd(row.amountUsd)}
      </Text>
    </View>
  );
};

/** "Today" / "Yesterday" / "12 Oct 2026". A ledger is read for recency first. */
function dayLabel(iso: string): string {
  if (iso === 'unknown') return 'No date';
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const asKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (iso === asKey(today)) return 'Today';
  const yesterday = new Date(today.getTime() - 86400000);
  if (iso === asKey(yesterday)) return 'Yesterday';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Local time. The CSV keeps the raw ISO — see `ledgerToCsv`. */
function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Text sizes are the Figma styles read per node with get_variable_defs
// (mobile mode), not the px the export prints.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: T.ink,
  },
  backBtn: { padding: 4 },
  // Headings/H-6
  headerTitle: { ...textStyles.H6, color: '#FFFFFF', flex: 1, marginLeft: 8 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  exportOff: { opacity: 0.4 },
  // Body/M B-2
  exportText: { ...textStyles.MB2, color: '#FFFFFF' },
  exportIcon: { width: 18, height: 18 },

  body: { flex: 1, backgroundColor: T.bg },
  content: { paddingHorizontal: 16, paddingTop: 24 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  muted: { ...textStyles.MB2, color: D.muted },
  link: { ...textStyle('MB2', '500'), color: D.wait },

  // ── Payment Summary ──
  summary: { gap: 16 },
  // Body/M B-1, bold override
  summaryTitle: { ...textStyle('MB1', '700'), color: T.title },
  tileRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  tile: {
    backgroundColor: T.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.07,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  tileHalf: { flex: 1, minWidth: 0 },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Body/B-3
  tileLabel: { ...textStyles.B3, color: T.title },
  tileBody: { gap: 8 },
  tileSpinner: { alignSelf: 'flex-start', height: 24 },
  // Body/M B-1, bold override
  tileFigure: { ...textStyle('MB1', '700'), color: T.title, fontVariant: ['tabular-nums'] },
  // Size/s with no named style on the node; 17 is the node's own line height.
  tileSub: { ...textStyles.B3, lineHeight: 17, color: T.count },
  bar: { flexDirection: 'row', height: 6, gap: 1, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 6 },
  guestsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faces: { flexDirection: 'row', alignItems: 'center' },
  face: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.surface,
    backgroundColor: '#E7EDEE',
  },
  faceOverlap: { marginLeft: -11 },

  // 9 under the tiles where the block's own gap is 16.
  legend: { flexDirection: 'row', gap: 8, marginTop: -7 },
  chip: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
    backgroundColor: T.surface,
  },
  chipDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Body/B-4
  chipCount: { ...textStyles.B4, color: '#FFFFFF', textAlign: 'center' },
  chipLabel: { ...textStyles.B4, color: T.title },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: D.waitBg,
  },
  toggleText: { flex: 1, ...textStyle('B3', '500'), color: D.wait },

  // ── Ledger ──
  // Body/B-3
  dayHead: { ...textStyles.B3, color: T.title, marginTop: 32, marginBottom: 8 },
  // A day's rows share borders: each row after the first slides up 1 over the
  // one above it, and only the outer corners are rounded.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.cardBorder,
    marginTop: -1,
  },
  rowFirst: { marginTop: 0, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E7EDEE' },
  rowText: { flex: 1, minWidth: 0 },
  // Body/B-3, bold override
  rowName: { ...textStyle('B3', '700'), color: T.title },
  // Body/B-4
  rowSub: { ...textStyles.B4, color: T.faint },
  rowFlag: { ...textStyle('B4', '600'), color: D.warn },
  // Body/B-3, bold override
  amount: { ...textStyle('B3', '700'), color: T.title, fontVariant: ['tabular-nums'] },
  // Figma draws refunds in #FF5367, which is 3:1 on white at this size.
  // `danger` is the dashboard's own red and clears 4.5:1.
  amountRefund: { color: D.danger },
  amountFailed: { ...textStyles.B3, color: D.muted },
});

export default TripPaymentsScreen;
