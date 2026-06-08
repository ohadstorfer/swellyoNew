import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, CARD_SHADOW, StatTile, IoniconName } from './analyticsTokens';
import {
  fetchTripsDashboard, TripsDashboardData, NamedCount, TripCounter, TripOverviewKey,
} from '../../services/analytics/analyticsTripsService';

const EMPTY_COUNTER: TripCounter = { total: 0, prev: 0, series: [] };

const OVERVIEW_TILES: { key: TripOverviewKey; label: string; icon: IoniconName }[] = [
  { key: 'trips_created',        label: 'Trips created',     icon: 'add-circle-outline' },
  { key: 'join_requests',        label: 'Join requests',     icon: 'hand-left-outline' },
  { key: 'members_joined',       label: 'Members joined',    icon: 'people-outline' },
  { key: 'unique_hosts',         label: 'Unique hosts',      icon: 'person-outline' },
  { key: 'commitments_approved', label: 'Commitments',       icon: 'checkmark-circle-outline' },
];

// Short, accurate definitions for the info sheet (keyed by tile/metric).
export const TRIP_METRIC_INFO: Record<string, { what: string; when: string }> = {
  trips_created:        { what: 'Group trips published in the selected period. Excludes trips hosted by demo/admin accounts.', when: 'When a host creates a group trip.' },
  join_requests:        { what: 'Requests to join a trip in the selected period.', when: 'When a user taps "Request to join".' },
  members_joined:       { what: 'People who became trip members (role = member) in the selected period.', when: 'When a host approves a join request.' },
  unique_hosts:        { what: 'Distinct hosts who created at least one trip in the selected period.', when: 'Counted from trips created in range.' },
  commitments_approved: { what: 'Commitments a host approved (flight booked, insurance, etc.) in the selected period.', when: 'When a host approves a member\'s commitment.' },
};

interface TripsAnalyticsViewProps {
  range: { from: string | null; to: string | null };
  onInfo: (key: string) => void;
  reloadToken: number; // bump to force refetch (e.g. pull-to-refresh from parent)
}

export function TripsAnalyticsView({ range, onInfo, reloadToken }: TripsAnalyticsViewProps) {
  const [data, setData] = useState<TripsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTripsDashboard({ from: range.from ?? undefined, to: range.to ?? undefined })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, reloadToken]);

  if (loading && !data) {
    return (
      <View style={styles.firstLoad}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={styles.firstLoadText}>Loading trip analytics…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.errorBanner}>
        <Ionicons name="alert-circle" size={18} color={C.down} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  if (!data) return null;

  return (
    <>
      <SectionLabel text="Overview" />
      <View style={styles.gridWrap}>
        {OVERVIEW_TILES.map(t => (
          <StatTile
            key={t.key}
            label={t.label}
            icon={t.icon}
            counter={data.overview[t.key] ?? EMPTY_COUNTER}
            eventKey={t.key}
            onInfo={onInfo}
          />
        ))}
      </View>

      <SectionLabel text="Funnels" />
      <FunnelCard title="Trip lifecycle" subtitle="Created → completed" icon="trending-down-outline" steps={data.lifecycle_funnel} />
      <FunnelCard title="Demand" subtitle="Request → committed" icon="git-compare-outline" steps={data.demand_funnel} />

      <SectionLabel text="Key rates" />
      <RatesCard rates={data.rates} />

      <SectionLabel text="Breakdowns" />
      <BreakdownCard title="By status" icon="ellipse-outline" items={data.breakdowns.status} />
      <BreakdownCard title="By hosting style" icon="options-outline" items={data.breakdowns.hosting_style} />
      <BreakdownCard title="Top destinations" icon="location-outline" items={data.breakdowns.top_destinations} />
      <BreakdownCard title="By budget" icon="cash-outline" items={data.breakdowns.budget} />
    </>
  );
}

// ============== Section label ==============
function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text.toUpperCase()}</Text>;
}

// ============== Generic funnel card ==============
function FunnelCard({ title, subtitle, icon, steps }: { title: string; subtitle?: string; icon: IoniconName; steps: NamedCount[] }) {
  const top = steps[0]?.count ?? 0;
  const bottom = steps[steps.length - 1]?.count ?? 0;
  const max = top || 1;
  const allZero = steps.every(s => s.count === 0);
  const overallConv = top > 0 ? (bottom / top) * 100 : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIconWrap}><Ionicons name={icon} size={16} color={C.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
        </View>
      </View>

      {allZero ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={20} color={C.faint} />
          <Text style={styles.emptyText}>No trips in this range yet.</Text>
        </View>
      ) : (
        <>
          <View style={styles.convCallout}>
            <View style={styles.cardIconWrap}><Ionicons name="git-compare-outline" size={16} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.convLabel}>End-to-end</Text>
              <Text style={styles.convSub}>{top.toLocaleString()} → {bottom.toLocaleString()}</Text>
            </View>
            <Text style={styles.convPctBig}>{overallConv !== null ? `${overallConv.toFixed(0)}%` : '—'}</Text>
          </View>

          <View style={{ marginTop: 4 }}>
            {steps.map((s, i) => {
              const pct = max > 0 ? (s.count / max) * 100 : 0;
              const dropoff = i > 0 ? steps[i - 1].count - s.count : 0;
              const dropoffPct = i > 0 && steps[i - 1].count > 0 ? (dropoff / steps[i - 1].count) * 100 : 0;
              return (
                <View key={s.label} style={[styles.funnelRow, i > 0 && styles.funnelRowDivider]}>
                  <View style={styles.funnelTopRow}>
                    <Text style={styles.funnelLabel} numberOfLines={1}>{s.label}</Text>
                    <Text style={styles.funnelNumber}>{s.count.toLocaleString()}</Text>
                  </View>
                  <View style={styles.funnelBarRow}>
                    <View style={styles.funnelBarWrap}><View style={[styles.funnelBar, { width: `${Math.max(pct, 2)}%` }]} /></View>
                    <Text style={styles.funnelPct}>{pct.toFixed(0)}%</Text>
                  </View>
                  {i > 0 && dropoff > 0 && (
                    <Text style={styles.funnelDropoff}>↓ {dropoff.toLocaleString()} dropped off ({dropoffPct.toFixed(0)}%)</Text>
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

// ============== Generic breakdown card ==============
function BreakdownCard({ title, icon, items }: { title: string; icon: IoniconName; items: NamedCount[] }) {
  const total = items.reduce((sum, it) => sum + it.count, 0);
  const max = Math.max(1, ...items.map(it => it.count));
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIconWrap}><Ionicons name={icon} size={16} color={C.accent} /></View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {items.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No data in this range.</Text></View>
      ) : (
        items.map((it, i) => {
          const pct = total > 0 ? (it.count / total) * 100 : 0;
          const barPct = (it.count / max) * 100;
          return (
            <View key={it.label} style={[styles.breakRow, i > 0 && styles.funnelRowDivider]}>
              <View style={styles.funnelTopRow}>
                <Text style={styles.funnelLabel} numberOfLines={1}>{it.label}</Text>
                <Text style={styles.breakNumber}>{it.count.toLocaleString()} · {pct.toFixed(0)}%</Text>
              </View>
              <View style={styles.funnelBarWrap}><View style={[styles.funnelBar, { width: `${Math.max(barPct, 2)}%` }]} /></View>
            </View>
          );
        })
      )}
    </View>
  );
}

// ============== Rates card ==============
function RatesCard({ rates }: { rates: TripsDashboardData['rates'] }) {
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);
  const hrs = (v: number | null) => (v === null ? '—' : v < 1 ? `${Math.round(v * 60)} min` : `${v.toFixed(1)} h`);
  const rows: { label: string; value: string }[] = [
    { label: 'Avg fill rate', value: pct(rates.fill_rate_avg) },
    { label: 'Reached full', value: pct(rates.pct_reached_full) },
    { label: 'Cancellation rate', value: pct(rates.cancellation_rate) },
    { label: 'Approval rate', value: pct(rates.approval_rate) },
    { label: 'Median host response', value: hrs(rates.median_response_hours) },
    { label: 'Ghost trips', value: rates.ghost_trips.toLocaleString() },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.ratesGrid}>
        {rows.map(r => (
          <View key={r.label} style={styles.rateCell}>
            <Text style={styles.rateValue}>{r.value}</Text>
            <Text style={styles.rateLabel}>{r.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  firstLoad: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  firstLoadText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' },
  errorBanner: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.downSoft, borderRadius: 12, padding: 14, marginBottom: 16 },
  errorText: { fontSize: 13, color: C.down, flex: 1, fontWeight: '500' },

  sectionLabel: { fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 0.6, marginBottom: 10 },

  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },

  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border, ...CARD_SHADOW },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  cardIconWrap: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  cardSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  empty: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: C.bg },
  emptyText: { fontSize: 12.5, color: C.textSecondary, fontStyle: 'italic' },

  convCallout: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.accentBg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: C.accentSoft, marginBottom: 6 },
  convLabel: { fontSize: 12.5, fontWeight: '700', color: C.text },
  convSub: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  convPctBig: { fontSize: 24, fontWeight: '800', color: C.accent, letterSpacing: -0.5 },

  funnelRow: { paddingVertical: 13 },
  funnelRowDivider: { borderTopWidth: 1, borderTopColor: C.divider },
  funnelTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  funnelLabel: { fontSize: 13, fontWeight: '600', color: C.text, flex: 1, paddingRight: 10 },
  funnelNumber: { fontSize: 17, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  funnelBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  funnelBarWrap: { flex: 1, height: 10, backgroundColor: C.track, borderRadius: 5, overflow: 'hidden' },
  funnelBar: { height: '100%', backgroundColor: C.accent, borderRadius: 5 },
  funnelPct: { fontSize: 11, fontWeight: '600', color: C.textSecondary, width: 34, textAlign: 'right' },
  funnelDropoff: { fontSize: 11, color: C.down, marginTop: 7, fontWeight: '500' },

  breakRow: { paddingVertical: 11 },
  breakNumber: { fontSize: 13, fontWeight: '700', color: C.text },

  ratesGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  rateCell: { width: '33.33%', paddingVertical: 10, alignItems: 'center' },
  rateValue: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  rateLabel: { fontSize: 10.5, color: C.textSecondary, marginTop: 3, textAlign: 'center', fontWeight: '600' },
});
