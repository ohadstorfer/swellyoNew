/**
 * TripPaymentsScreen — every payment on one trip, newest first.
 *
 * Product Specs §"Trip operator view": "Payments page — view all transactions,
 * amounts, profiles, times, export options."
 *
 * ── What this screen is NOT ────────────────────────────────────────────────
 * It computes no totals. The Dashboard's summary tiles are the one place a
 * figure is derived, and a second derivation here is how two screens come to
 * disagree about the same trip. Everything below is a list, a filter and an
 * export.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Thumb from '../../components/Thumb';
import { Image } from 'expo-image';
import { Images } from '../../assets/images';
import { ff } from '../../theme/fonts';
import { PressableScale } from '../../components/trips/PressableScale';
import { D } from '../../components/trips/dashboard/dashboardTheme';
import { formatUsd } from '../../components/trips/dashboard/dashboardFormat';
import {
  fetchPaymentLedger,
  fetchTripMoney,
  ledgerToCsv,
  type LedgerEvent,
} from '../../services/trips/operatorDashboardService';
import { STRIPE_LIVEMODE } from '../../services/trips/tripPaymentsService';
import { showErrorAlert } from '../../utils/friendlyError';
import { shareTextAsFile } from '../../services/trips/exportService';

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
}> = ({ tripId, tripTitle, onBack, travelers }) => {
  const insets = useSafeAreaInsets();
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  const ledger = useQuery({
    queryKey: ['operatorDashboard', 'ledger', tripId],
    queryFn: () => fetchPaymentLedger(tripId),
  });
  // Only for the step titles — "Deposit" beside an amount is worth a query the
  // Dashboard has already made and cached under this exact key.
  const money = useQuery({
    queryKey: ['operatorDashboard', 'money', tripId],
    queryFn: () => fetchTripMoney(tripId),
  });

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
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={D.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Payments</Text>
        <Pressable
          onPress={exportCsv}
          hitSlop={12}
          disabled={exporting || rows.length === 0}
          accessibilityLabel="Export every payment as a spreadsheet"
        >
          {exporting ? (
            <ActivityIndicator size="small" />
          ) : (
            <Ionicons
              name="share-outline"
              size={21}
              color={rows.length === 0 ? '#C9C9C9' : D.ink}
            />
          )}
        </Pressable>
      </View>

      {ledger.isPending ? (
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
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Nobody has paid for this trip yet.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            hidden > 0 ? (
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
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayHead}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Row
              row={item}
              name={names.get(item.userId) ?? 'Traveler'}
              avatarUrl={avatars.get(item.userId) ?? null}
              what={item.requirementId ? stepTitles.get(item.requirementId) ?? null : null}
            />
          )}
        />
      )}
    </View>
  );
};

/** A row that belongs to this build's Stripe mode and actually moved money. */
function visibleAlways(r: LedgerEvent): boolean {
  return r.counted && r.eventType !== 'failed';
}

const Row: React.FC<{
  row: LedgerEvent;
  name: string;
  avatarUrl: string | null;
  what: string | null;
}> = ({ row, name, avatarUrl, what }) => {
  const copy = KIND_COPY[row.eventType] ?? KIND_COPY.paid;
  return (
    <View style={styles.row}>
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
          {[what ?? copy.label, timeLabel(row.createdAt)].filter(Boolean).join(' · ')}
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
        {copy.tone === 'failed' ? 'Failed' : formatUsd(row.amountUsd)}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: D.hairline,
  },
  headerTitle: {
    fontFamily: ff('Inter', '600'),
    fontSize: 16,
    fontWeight: '600',
    color: D.ink,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  muted: { fontFamily: ff('Inter', '400'), fontSize: 13.5, color: D.muted },
  link: { fontFamily: ff('Inter', '500'), fontSize: 13.5, color: D.wait },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: D.waitBg,
  },
  toggleText: { flex: 1, fontFamily: ff('Inter', '500'), fontSize: 12.5, color: D.wait },
  dayHead: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    fontWeight: '600',
    color: D.muted,
    marginTop: 20,
    marginBottom: 6,
    marginHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: D.cardBorder,
    marginBottom: 6,
  },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E7EDEE' },
  rowText: { flex: 1, gap: 2 },
  rowName: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: D.ink,
  },
  rowSub: { fontFamily: ff('Inter', '400'), fontSize: 12, color: D.muted },
  rowFlag: { fontFamily: ff('Inter', '600'), fontSize: 11, color: D.warn },
  amount: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14.5,
    fontWeight: '600',
    color: D.ink,
    fontVariant: ['tabular-nums'],
  },
  amountRefund: { color: D.warn },
  amountFailed: { color: D.muted, fontSize: 12.5 },
});

export default TripPaymentsScreen;
