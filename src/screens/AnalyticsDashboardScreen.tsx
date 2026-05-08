import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';
import { fetchDashboard, DashboardData } from '../services/analytics/analyticsDashboardService';

type RangeKey = 'all' | 'today' | '7d' | '30d' | '1y';

interface RangeOption {
  key: RangeKey;
  label: string;
  shortLabel: string;
}

const RANGE_OPTIONS: RangeOption[] = [
  { key: 'all', label: 'All time', shortLabel: 'all time' },
  { key: 'today', label: 'Today', shortLabel: 'today' },
  { key: '7d', label: 'Last 7 days', shortLabel: 'last 7 days' },
  { key: '30d', label: 'Last 30 days', shortLabel: 'last 30 days' },
  { key: '1y', label: 'Last year', shortLabel: 'last year' },
];

const TRACKING_START_DATE = '2026-05-08';

function rangeToISO(key: RangeKey): { from: string | null; to: string | null } {
  if (key === 'all') return { from: null, to: null };
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  if (key === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (key === '7d') {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (key === '30d') {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  }
  return { from: from.toISOString(), to };
}

interface AnalyticsDashboardScreenProps {
  onBack: () => void;
}

export function AnalyticsDashboardScreen({ onBack }: AnalyticsDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<RangeKey>('all');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAllTime = range === 'all';
  const rangeShort = RANGE_OPTIONS.find(o => o.key === range)?.shortLabel ?? 'all time';

  const load = async (key: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const r = rangeToISO(key);
      const d = await fetchDashboard({ from: r.from ?? undefined, to: r.to ?? undefined });
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(range);
  }, [range]);

  const activityRows = useMemo(() => {
    if (!data) return [];
    // Funnel order — each row is a step further into the user journey.
    return [
      {
        label: 'Completed onboarding phase 1 (Swelly animation)',
        total: data.metric_3.total,
        inRange: data.metric_3.in_range,
        series: data.metric_3.series,
        isNew: true,
      },
      {
        label: 'Completed full onboarding',
        total: data.metric_4.total,
        inRange: data.metric_4.in_range,
        series: data.metric_4.series,
        isNew: false,
      },
      {
        label: 'Clicked Swelly search (first time)',
        total: data.metric_5.total,
        inRange: data.metric_5.in_range,
        series: data.metric_5.series,
        isNew: true,
      },
      {
        label: 'Made a Swelly match (first time)',
        total: data.metric_6.total,
        inRange: data.metric_6.in_range,
        series: data.metric_6.series,
        isNew: false,
      },
    ];
  }, [data]);

  const totalsRows = useMemo(() => {
    if (!data) return [];
    return [
      { counter: data.metric_7, label: 'Conversations with 1+ message' },
      { counter: data.metric_8, label: 'Matches with replies (both sides 1+)' },
      { counter: data.metric_9, label: 'Conversations with 4+ msgs each side' },
    ];
  }, [data]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Top bar: Back chip left, Refresh circle right */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backChip} activeOpacity={0.7} onPress={onBack}>
          <Ionicons name="chevron-back" size={16} color={C.primary} />
          <Text style={styles.backChipText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.refreshCircle} activeOpacity={0.7} onPress={() => load(range)}>
          <Ionicons name="refresh" size={16} color={C.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>Demo users excluded</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chipsContent}
        >
          {RANGE_OPTIONS.map(opt => {
            const active = opt.key === range;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.7}
                onPress={() => setRange(opt.key)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading && <ActivityIndicator style={styles.loader} size="large" color={C.accent} />}
        {error && !loading && <Text style={styles.errorText}>{error}</Text>}

        {!loading && !error && data && (
          <>
            {/* Hero KPIs row — two white cards on the gray background */}
            <View style={styles.heroRow}>
              <HeroCard
                label="Active users"
                total={data.metric_10.with_surfer.total}
                inRange={data.metric_10.with_surfer.in_range}
                series={data.metric_10.with_surfer.series}
                isAllTime={isAllTime}
                rangeShort={rangeShort}
                authOnly={data.metric_10.auth_only.total}
              />
              <HeroCard
                label="Users created"
                total={data.metric_2.total}
                inRange={data.metric_2.in_range}
                series={data.metric_2.series}
                isAllTime={isAllTime}
                rangeShort={rangeShort}
              />
            </View>

            {/* Activity section card */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>ACTIVITY</Text>
              <View style={styles.activityList}>
                {activityRows.map((row, i) => (
                  <View key={i} style={[styles.activityRow, i > 0 && styles.activityRowDivider]}>
                    <View style={styles.activityLeftCol}>
                      <Text style={styles.activityLabel}>{row.label}</Text>
                      {row.isNew && (
                        <View style={styles.newBadge}>
                          <Text style={styles.newBadgeText}>NEW</Text>
                        </View>
                      )}
                      {!isAllTime && (
                        <Text style={styles.deltaText}>+{row.inRange.toLocaleString()} {rangeShort}</Text>
                      )}
                    </View>
                    <View style={styles.activityRightCol}>
                      <Sparkline data={row.series} width={64} height={28} />
                      <Text style={styles.activityNumber}>{row.total.toLocaleString()}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={styles.activityFootnote}>
                Items marked NEW are tracked since {TRACKING_START_DATE}
              </Text>
            </View>

            {/* Totals section card */}
            <View style={styles.sectionCard}>
              <View style={styles.totalsHeader}>
                <Text style={styles.sectionTitle}>Conversations</Text>
              </View>
              <View style={styles.totalsList}>
                {totalsRows.map((row, i) => (
                  <View key={i} style={[styles.totalsRow, i > 0 && styles.totalsRowDivider]}>
                    <Text style={styles.totalsNumber}>{row.counter.total.toLocaleString()}</Text>
                    <View style={styles.totalsLabelCol}>
                      <Text style={styles.totalsLabel}>{row.label}</Text>
                      {!isAllTime && (
                        <Text style={styles.deltaText}>
                          +{row.counter.in_range.toLocaleString()} {rangeShort}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

interface HeroCardProps {
  label: string;
  total: number;
  inRange: number;
  series: number[];
  isAllTime: boolean;
  rangeShort: string;
  authOnly?: number;
}

function HeroCard({ label, total, inRange, series, isAllTime, rangeShort, authOnly }: HeroCardProps) {
  return (
    <View style={styles.heroCard}>
      <Text style={styles.heroLabel}>{label}</Text>
      <View style={styles.heroNumberRow}>
        <Text style={styles.heroNumber}>{total.toLocaleString()}</Text>
        <Sparkline data={series} width={72} height={32} />
      </View>
      {!isAllTime && (
        <Text style={styles.deltaText}>+{inRange.toLocaleString()} {rangeShort}</Text>
      )}
      {authOnly != null && authOnly > 0 && (
        <Text style={styles.heroAuthOnly}>+{authOnly.toLocaleString()} auth-only</Text>
      )}
    </View>
  );
}

interface SparklineProps {
  data: number[];
  width: number;
  height: number;
}

/**
 * Minimal SVG sparkline. Normalizes the input values to fit the box.
 * If all values are 0 (or empty), renders a flat baseline so the layout doesn't shift.
 */
function Sparkline({ data, width, height }: SparklineProps) {
  if (!data || data.length === 0) return <View style={{ width, height }} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const padY = 3;
  const usableH = height - padY * 2;
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = padY + usableH - ((v - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={C.accent}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// Color palette
const C = {
  bg: '#F2F2F4',         // light gray screen background
  card: '#FFFFFF',
  primary: '#1A1A1A',
  secondary: '#6B6B70',
  tertiary: '#9A9AA0',
  accent: '#0095B6',
  chipBg: '#F2F2F6',
  newBadgeBg: '#F8EBC8',
  newBadgeText: '#A17A1A',
  divider: '#EAEAEC',
};

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  backChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.card,
    borderRadius: 20,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 7,
  },
  backChipText: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '500',
    color: C.primary,
  },
  refreshCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  headerBlock: {
    marginTop: 8,
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_MONT,
    fontSize: 32,
    fontWeight: '700',
    color: C.primary,
    lineHeight: 38,
  },
  subtitle: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '400',
    color: C.secondary,
    marginTop: 2,
  },
  chipsRow: {
    flexGrow: 0,
    marginHorizontal: -16,
    marginBottom: 16,
  },
  chipsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    backgroundColor: C.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: C.primary,
  },
  chipText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.primary,
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  // Hero KPIs row
  heroRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  heroCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  heroLabel: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    color: C.secondary,
    marginBottom: 4,
  },
  heroNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroNumber: {
    fontFamily: FONT_MONT,
    fontSize: 32,
    fontWeight: '700',
    color: C.primary,
    lineHeight: 38,
  },
  heroAuthOnly: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '500',
    color: C.tertiary,
    marginTop: 2,
  },
  deltaText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '600',
    color: C.accent,
    marginTop: 2,
  },
  // Section cards (Activity, Totals)
  sectionCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '700',
    color: C.secondary,
    letterSpacing: 0.6,
  },
  // Activity rows
  activityList: {
    marginTop: 4,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  activityRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
  },
  activityLeftCol: {
    flex: 1,
    alignItems: 'flex-start',
  },
  activityLabel: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.primary,
  },
  newBadge: {
    backgroundColor: C.newBadgeBg,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 4,
  },
  newBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 9,
    fontWeight: '700',
    color: C.newBadgeText,
    letterSpacing: 0.4,
  },
  activityRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activityNumber: {
    fontFamily: FONT_MONT,
    fontSize: 22,
    fontWeight: '700',
    color: C.primary,
    lineHeight: 26,
    minWidth: 28,
    textAlign: 'right',
  },
  activityFootnote: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '500',
    color: C.newBadgeText,
    marginTop: 8,
  },
  // Totals section
  totalsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  totalsList: {
    marginTop: 4,
  },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  totalsRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
  },
  totalsNumber: {
    fontFamily: FONT_MONT,
    fontSize: 28,
    fontWeight: '700',
    color: C.primary,
    minWidth: 56,
  },
  totalsLabelCol: {
    flex: 1,
  },
  totalsLabel: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '500',
    color: C.secondary,
  },
  // Misc
  loader: {
    marginTop: 32,
  },
  errorText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
    marginTop: 24,
  },
});
