import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';
import {
  fetchDashboard,
  DashboardData,
  DashboardCounter,
  EventName,
} from '../services/analytics/analyticsDashboardService';

type PresetKey = 'all' | 'today' | '7d' | '30d' | '90d' | '1y' | 'custom';

interface RangeOption {
  key: PresetKey;
  label: string;
  shortLabel: string;
}

const PRESETS: RangeOption[] = [
  { key: 'all',    label: 'All time',     shortLabel: 'all time' },
  { key: 'today',  label: 'Today',        shortLabel: 'today' },
  { key: '7d',     label: 'Last 7 days',  shortLabel: 'last 7d' },
  { key: '30d',    label: 'Last 30 days', shortLabel: 'last 30d' },
  { key: '90d',    label: 'Last 90 days', shortLabel: 'last 90d' },
  { key: '1y',     label: 'Last year',    shortLabel: 'last year' },
  { key: 'custom', label: 'Custom…',      shortLabel: 'custom range' },
];

interface RangeState {
  preset: PresetKey;
  from: string | null;
  to: string | null;
}

function presetToISO(key: Exclude<PresetKey, 'custom' | 'all'>): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  let from: Date;
  if (key === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (key === '7d') {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (key === '30d') {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (key === '90d') {
    from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else {
    from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  }
  return { from: from.toISOString(), to };
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function deltaPct(total: number, prev: number): { value: number; up: boolean; flat: boolean } | null {
  if (prev <= 0) return null;
  const v = ((total - prev) / prev) * 100;
  return { value: Math.abs(v), up: v >= 0, flat: Math.abs(v) < 0.1 };
}

// Event groups
const ONBOARDING_FUNNEL_EVENTS: EventName[] = [
  'user_signed_up',
  'onboarding_step_1',
  'onboarding_step_2',
  'onboarding_step_3',
  'onboarding_step_4',
  'onboarding_step_5',
  'onboarding_step_6',
  'onboarding_step_7',
  'onboarding_finalized',
];

const ENGAGEMENT_FUNNEL_EVENTS: EventName[] = [
  'swelly_search_clicked',
  'swelly_connect_clicked',
  'first_message_sent',
  'conversation_two_sided',
  'conversation_deep_engaged',
];

const EVENT_DEFINITIONS: Record<EventName, { what: string; when: string }> = {
  user_signed_up: {
    what: 'How many people created an account in the selected time period.',
    when: 'When someone finishes signing up for the first time.',
  },
  onboarding_step_1: {
    what: 'How many people completed Step 1 (board type) in the selected time period. Each person counts once.',
    when: 'When the user taps "Next" on the board-type screen.',
  },
  onboarding_step_2: {
    what: 'How many people completed Step 2 (surf level) in the selected time period. Each person counts once.',
    when: 'When the user taps "Next" on the surf-level screen.',
  },
  onboarding_step_3: {
    what: 'How many people completed Step 3 (travel experience) in the selected time period. Each person counts once.',
    when: 'When the user taps "Next" on the travel-experience screen.',
  },
  onboarding_step_4: {
    what: 'How many people completed Step 4 (destinations) in the selected time period. Each person counts once.',
    when: 'When the user taps "Next" on the destinations screen.',
  },
  onboarding_step_5: {
    what: 'How many people completed Step 5 (budget) in the selected time period. Each person counts once.',
    when: 'When the user taps "Next" on the budget screen.',
  },
  onboarding_step_6: {
    what: 'How many people completed Step 6 (lifestyle) in the selected time period. Each person counts once.',
    when: 'When the user taps "Next" on the lifestyle screen.',
  },
  onboarding_step_7: {
    what: 'How many people completed Step 7 (profile + video) in the selected time period. Each person counts once.',
    when: 'When the user finishes the profile/video screen.',
  },
  onboarding_finalized: {
    what: 'How many people completed the FULL onboarding in the selected time period. Each person counts once.',
    when: 'When the user presses the final "Got it" / Save button.',
  },
  swelly_search_clicked: {
    what: 'How many different people opened the Swelly chat to look for surfers in the selected time period. Each person counts once, no matter how many times they searched.',
    when: 'When someone opens the Swelly chat.',
  },
  swelly_connect_clicked: {
    what: 'How many different people pressed "Connect" to start a new conversation in the selected time period. Each person counts once. Re-messaging an existing chat does NOT count.',
    when: 'When someone taps "Connect" on a profile they haven\'t messaged before.',
  },
  first_message_sent: {
    what: 'How many people sent their first-ever message in the selected time period. Each person counts once.',
    when: 'The first time someone sends any message in any conversation.',
  },
  conversation_two_sided: {
    what: 'How many 1:1 conversations got a reply (both sides sent at least 1 message) in the selected time period.',
    when: 'When the second person sends their first message in a chat. Excluded if any participant is demo or admin.',
  },
  conversation_deep_engaged: {
    what: 'How many 1:1 conversations became real conversations — both people sent 4+ messages each — in the selected time period.',
    when: 'When both people reach 4 messages in the same chat. Excluded if any participant is demo or admin.',
  },
  app_opened: {
    what: 'How many different people opened the app in the selected time period. Each person counts once, no matter how many times they opened it.',
    when: 'When someone opens the app.',
  },
};

const EVENT_LABELS: Record<EventName, string> = {
  user_signed_up: 'Signed up',
  onboarding_step_1: 'Step 1 · Board',
  onboarding_step_2: 'Step 2 · Surf level',
  onboarding_step_3: 'Step 3 · Experience',
  onboarding_step_4: 'Step 4 · Destinations',
  onboarding_step_5: 'Step 5 · Budget',
  onboarding_step_6: 'Step 6 · Lifestyle',
  onboarding_step_7: 'Step 7 · Profile',
  onboarding_finalized: 'Completed ("Got it")',
  swelly_search_clicked: 'Clicked Swelly search',
  swelly_connect_clicked: 'Pressed "Connect"',
  first_message_sent: 'Sent first message',
  conversation_two_sided: 'Got a reply',
  conversation_deep_engaged: '4+ msgs each side',
  app_opened: 'Opened the app',
};

interface AnalyticsDashboardScreenProps {
  onBack: () => void;
}

export function AnalyticsDashboardScreen({ onBack }: AnalyticsDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<RangeState>({ preset: 'all', from: null, to: null });
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState<Date>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [customTo, setCustomTo] = useState<Date>(new Date());
  const [infoEvent, setInfoEvent] = useState<EventName | null>(null);

  const rangeShort = PRESETS.find(p => p.key === range.preset)?.shortLabel
    ?? (range.from && range.to ? `${fmtShortDate(range.from)} → ${fmtShortDate(range.to)}` : 'all time');

  const load = async (r: RangeState) => {
    setLoading(true);
    setError(null);
    try {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  function selectPreset(key: PresetKey) {
    if (key === 'custom') {
      setCustomOpen(true);
      return;
    }
    if (key === 'all') {
      setRange({ preset: 'all', from: null, to: null });
    } else {
      const { from, to } = presetToISO(key);
      setRange({ preset: key, from, to });
    }
  }

  function applyCustom() {
    setRange({
      preset: 'custom',
      from: customFrom.toISOString(),
      to: customTo.toISOString(),
    });
    setCustomOpen(false);
  }

  // Is the whole dashboard empty (no events at all)?
  const isAllEmpty = !!data && Object.values(data.metrics).every(c => c.total === 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
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
          <View style={styles.subtitleRow}>
            <Ionicons name="shield-checkmark-outline" size={12} color={C.secondary} />
            <Text style={styles.subtitle}>Demo users & admins excluded</Text>
            <View style={styles.dotSep} />
            <Ionicons name="calendar-outline" size={12} color={C.secondary} />
            <Text style={styles.subtitle}>{rangeShort}</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={styles.chipsContent}
        >
          {PRESETS.map(opt => {
            const active = opt.key === range.preset;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.7}
                onPress={() => selectPreset(opt.key)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading && <ActivityIndicator style={styles.loader} size="large" color={C.accent} />}
        {error && !loading && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color={C.down} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && data && (
          <>
            {isAllEmpty && <EmptyBanner />}

            <View style={styles.heroRow}>
              <HeroCard label="Users created"   icon="person-add-outline"     counter={data.metrics.user_signed_up}        eventKey="user_signed_up"        onInfo={setInfoEvent} />
              <HeroCard label="App opens"       icon="phone-portrait-outline" counter={data.metrics.app_opened}            eventKey="app_opened"            onInfo={setInfoEvent}  />
              <HeroCard label="Onboarding done" icon="checkmark-done-outline" counter={data.metrics.onboarding_finalized}  eventKey="onboarding_finalized"  onInfo={setInfoEvent} />
            </View>

            <FunnelSection
              title="Onboarding funnel"
              subtitle="Where users drop off during sign-up"
              icon="trending-down-outline"
              events={ONBOARDING_FUNNEL_EVENTS}
              metrics={data.metrics}
              onInfo={setInfoEvent}
            />

            <FunnelSection
              title="Engagement funnel"
              subtitle="From search to a meaningful conversation"
              icon="chatbubbles-outline"
              events={ENGAGEMENT_FUNNEL_EVENTS}
              metrics={data.metrics}
              onInfo={setInfoEvent}
            />
          </>
        )}
      </ScrollView>

      <InfoModal event={infoEvent} onClose={() => setInfoEvent(null)} />

      <Modal visible={customOpen} animationType="slide" transparent onRequestClose={() => setCustomOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Custom date range</Text>

            <Text style={styles.modalLabel}>From</Text>
            <View style={styles.modalPickerWrap}>
              <DateTimePicker
                value={customFrom}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_e, d) => d && setCustomFrom(d)}
                maximumDate={customTo}
              />
            </View>

            <Text style={styles.modalLabel}>To</Text>
            <View style={styles.modalPickerWrap}>
              <DateTimePicker
                value={customTo}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_e, d) => d && setCustomTo(d)}
                minimumDate={customFrom}
                maximumDate={new Date()}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setCustomOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalApplyBtn} onPress={applyCustom}>
                <Text style={styles.modalApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============== Info modal ==============

function InfoModal({ event, onClose }: { event: EventName | null; onClose: () => void }) {
  const def = event ? EVENT_DEFINITIONS[event] : null;
  return (
    <Modal
      visible={event !== null}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.infoCard} onPress={() => {}}>
          {event && def && (
            <>
              <View style={styles.infoHeader}>
                <View style={styles.infoIconWrap}>
                  <Ionicons name="information-circle" size={20} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle}>{EVENT_LABELS[event]}</Text>
                  <Text style={styles.infoEventName}>{event}</Text>
                </View>
              </View>

              <Text style={styles.infoSectionLabel}>WHAT IT COUNTS</Text>
              <Text style={styles.infoText}>{def.what}</Text>

              <Text style={styles.infoSectionLabel}>WHEN IT'S RECORDED</Text>
              <Text style={styles.infoText}>{def.when}</Text>

              <TouchableOpacity style={styles.infoCloseBtn} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.infoCloseText}>Got it</Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ============== Empty-state banner ==============

function EmptyBanner() {
  return (
    <View style={styles.emptyBanner}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="sparkles-outline" size={20} color={C.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.emptyTitle}>Analytics just started</Text>
        <Text style={styles.emptyBody}>
          Numbers will appear here as users sign up, finish onboarding, search, message, and open the app.
        </Text>
      </View>
    </View>
  );
}

// ============== Hero card ==============

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface HeroCardProps {
  label: string;
  icon: IoniconName;
  counter: DashboardCounter;
  eventKey: EventName;
  onInfo: (e: EventName) => void;
  suffix?: string;
}

function HeroCard({ label, icon, counter, eventKey, onInfo, suffix }: HeroCardProps) {
  const delta = deltaPct(counter.total, counter.prev);
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);

  return (
    <View style={styles.heroCard}>
      <View style={styles.heroHeader}>
        <View style={styles.heroIconWrap}>
          <Ionicons name={icon} size={14} color={C.accent} />
        </View>
        <View style={styles.heroHeaderRight}>
          {suffix && <Text style={styles.heroSuffix}>{suffix}</Text>}
          <TouchableOpacity
            onPress={() => onInfo(eventKey)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.6}
          >
            <Ionicons name="information-circle-outline" size={16} color={C.tertiary} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.heroLabel} numberOfLines={2}>{label}</Text>

      <Text style={[styles.heroNumber, isEmpty && styles.heroNumberMuted]} numberOfLines={1}>
        {counter.total.toLocaleString()}
      </Text>

      {delta ? (
        <View style={styles.deltaRow}>
          <Text style={[styles.deltaText, delta.up ? styles.deltaUp : styles.deltaDown]}>
            {delta.flat ? '— flat' : `${delta.up ? '▲' : '▼'} ${delta.value.toFixed(1)}%`}
          </Text>
          <Text style={styles.deltaVsText}>vs prev</Text>
        </View>
      ) : (
        <Text style={styles.deltaPlaceholder}>
          {isEmpty ? 'No events yet' : 'No prior data'}
        </Text>
      )}

      {!isEmpty && (
        <View style={styles.sparkWrap}>
          <Sparkline data={counter.series} height={22} />
        </View>
      )}
    </View>
  );
}

// ============== Funnel section ==============

interface FunnelSectionProps {
  title: string;
  subtitle?: string;
  icon: IoniconName;
  events: EventName[];
  metrics: Record<EventName, DashboardCounter>;
  onInfo: (e: EventName) => void;
}

function FunnelSection({ title, subtitle, icon, events, metrics, onInfo }: FunnelSectionProps) {
  const counts = events.map(e => metrics[e]?.total ?? 0);
  const max = counts[0] || 1;
  const allZero = counts.every(c => c === 0);

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIconWrap}>
          <Ionicons name={icon} size={14} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
        </View>
      </View>

      {allZero ? (
        <View style={styles.funnelEmpty}>
          <Text style={styles.funnelEmptyText}>No events in this range yet.</Text>
        </View>
      ) : (
        <View style={styles.funnelList}>
          {events.map((ev, i) => {
            const c = metrics[ev] ?? { total: 0, prev: 0, series: [] };
            const pct = max > 0 ? (c.total / max) * 100 : 0;
            const dropoff = i > 0 ? counts[i - 1] - c.total : 0;
            const dropoffPct = i > 0 && counts[i - 1] > 0 ? (dropoff / counts[i - 1]) * 100 : 0;
            const delta = deltaPct(c.total, c.prev);

            return (
              <View key={ev} style={[styles.funnelRow, i > 0 && styles.funnelRowDivider]}>
                <View style={styles.funnelLabelCol}>
                  <View style={styles.funnelLabelRow}>
                    <Text style={styles.funnelLabel} numberOfLines={1}>{EVENT_LABELS[ev] ?? ev}</Text>
                    <TouchableOpacity
                      onPress={() => onInfo(ev)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="information-circle-outline" size={13} color={C.tertiary} />
                    </TouchableOpacity>
                  </View>
                  {i > 0 && dropoff > 0 && (
                    <Text style={styles.funnelDropoff}>
                      ↓ {dropoff.toLocaleString()} ({dropoffPct.toFixed(0)}% drop)
                    </Text>
                  )}
                </View>
                <View style={styles.funnelBarWrap}>
                  <View style={[styles.funnelBar, { width: `${Math.max(pct, 2)}%` }]} />
                </View>
                <View style={styles.funnelNumberCol}>
                  <Text style={styles.funnelNumber}>{c.total.toLocaleString()}</Text>
                  <Text style={styles.funnelPct}>{pct.toFixed(0)}%</Text>
                  {delta && (
                    <Text style={[styles.funnelDelta, delta.up ? styles.deltaUp : styles.deltaDown]}>
                      {delta.flat ? '— ' : (delta.up ? '▲ ' : '▼ ')}{delta.value.toFixed(0)}%
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ============== Sparkline ==============

interface SparklineProps {
  data: number[];
  height: number;
}

function Sparkline({ data, height }: SparklineProps) {
  const [width, setWidth] = useState(0);
  if (!data || data.length === 0) return <View style={{ height }} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const stepX = data.length > 1 && width > 0 ? width / (data.length - 1) : 0;
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
    <View
      style={{ height, width: '100%' }}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
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
      )}
    </View>
  );
}

// ============== Styles ==============

const C = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  primary: '#0F0F12',
  secondary: '#6B6B72',
  tertiary: '#A0A0A8',
  faint: '#D9D9DE',
  accent: '#0095B6',
  accentSoft: '#E0F4F8',
  accentBg: '#EFF9FB',
  chipBg: '#FFFFFF',
  divider: '#EFEFF2',
  up: '#0E9F6E',
  upSoft: '#E3F5EC',
  down: '#C0392B',
  downSoft: '#FBE9E7',
  shadow: '#000',
};

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const CARD_SHADOW = Platform.select({
  ios: {
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  android: { elevation: 2 },
  default: {},
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, marginBottom: 4,
  },
  backChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.card, borderRadius: 20,
    paddingLeft: 8, paddingRight: 12, paddingVertical: 7,
    ...CARD_SHADOW,
  },
  backChipText: { fontFamily: FONT_INTER, fontSize: 15, fontWeight: '500', color: C.primary },
  refreshCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    ...CARD_SHADOW,
  },

  scrollContent: { paddingHorizontal: 16 },

  // Header
  headerBlock: { marginTop: 8, marginBottom: 16 },
  title: {
    fontFamily: FONT_MONT, fontSize: 32, fontWeight: '700',
    color: C.primary, lineHeight: 38, letterSpacing: -0.5,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' },
  subtitle: { fontFamily: FONT_INTER, fontSize: 12, fontWeight: '500', color: C.secondary },
  dotSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.faint, marginHorizontal: 3 },

  // Chips
  chipsRow: { flexGrow: 0, marginHorizontal: -16, marginBottom: 16 },
  chipsContent: { paddingHorizontal: 16, gap: 8 },
  chip: {
    backgroundColor: C.chipBg, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: C.faint,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontFamily: FONT_INTER, fontSize: 13, fontWeight: '500', color: C.primary },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },

  // Empty banner
  emptyBanner: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: C.accentBg, borderRadius: 14, marginBottom: 16,
    borderWidth: 1, borderColor: C.accentSoft,
  },
  emptyIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontFamily: FONT_INTER, fontSize: 14, fontWeight: '600', color: C.primary },
  emptyBody: { fontFamily: FONT_INTER, fontSize: 12, color: C.secondary, marginTop: 2, lineHeight: 17 },

  // Hero KPIs
  heroRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  heroCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    minHeight: 132,
    ...CARD_SHADOW,
  },
  heroHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  heroIconWrap: {
    width: 24, height: 24, borderRadius: 7,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  heroLabel: {
    fontFamily: FONT_INTER, fontSize: 12, fontWeight: '600',
    color: C.secondary, letterSpacing: 0.1,
    lineHeight: 15,
    minHeight: 30, // accommodates 2 lines so cards align even when label is short
    marginBottom: 4,
  },
  heroSuffix: {
    fontFamily: FONT_INTER, fontSize: 10, fontWeight: '500',
    color: C.tertiary,
    backgroundColor: C.bg,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  heroHeaderRight: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  heroNumber: {
    fontFamily: FONT_MONT, fontSize: 30, fontWeight: '700',
    color: C.primary, lineHeight: 36, letterSpacing: -0.6,
  },
  heroNumberMuted: { color: C.faint },

  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  deltaText: { fontFamily: FONT_INTER, fontSize: 11, fontWeight: '700' },
  deltaUp: { color: C.up },
  deltaDown: { color: C.down },
  deltaVsText: { fontFamily: FONT_INTER, fontSize: 10, fontWeight: '500', color: C.tertiary },
  deltaPlaceholder: {
    fontFamily: FONT_INTER, fontSize: 10, fontWeight: '500',
    color: C.tertiary, marginTop: 4, fontStyle: 'italic',
  },

  sparkWrap: { marginTop: 'auto', paddingTop: 8 },

  // Section cards
  sectionCard: {
    backgroundColor: C.card, borderRadius: 14,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12,
    marginBottom: 16,
    ...CARD_SHADOW,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  sectionIconWrap: {
    width: 26, height: 26, borderRadius: 7,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: {
    fontFamily: FONT_INTER, fontSize: 13, fontWeight: '700',
    color: C.primary, letterSpacing: 0.1,
  },
  sectionSubtitle: { fontFamily: FONT_INTER, fontSize: 11, color: C.secondary, marginTop: 1 },

  // Funnel
  funnelList: { marginTop: 8 },
  funnelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  funnelRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  funnelLabelCol: { width: 140 },
  funnelLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  funnelLabel: { fontFamily: FONT_INTER, fontSize: 12, fontWeight: '500', color: C.primary, flexShrink: 1 },
  funnelDropoff: { fontFamily: FONT_INTER, fontSize: 10, color: C.down, marginTop: 2 },
  funnelBarWrap: { flex: 1, height: 8, backgroundColor: C.divider, borderRadius: 4, overflow: 'hidden' },
  funnelBar: { height: '100%', backgroundColor: C.accent, borderRadius: 4 },
  funnelNumberCol: { width: 56, alignItems: 'flex-end' },
  funnelNumber: { fontFamily: FONT_MONT, fontSize: 15, fontWeight: '700', color: C.primary },
  funnelPct: { fontFamily: FONT_INTER, fontSize: 10, color: C.tertiary, marginTop: 1 },
  funnelDelta: { fontFamily: FONT_INTER, fontSize: 10, fontWeight: '600', marginTop: 1 },
  funnelEmpty: {
    paddingVertical: 24, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, backgroundColor: C.bg, marginTop: 8,
  },
  funnelEmptyText: { fontFamily: FONT_INTER, fontSize: 12, color: C.tertiary, fontStyle: 'italic' },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 20,
    width: '88%', maxWidth: 380,
    ...CARD_SHADOW,
  },
  modalTitle: { fontFamily: FONT_MONT, fontSize: 18, fontWeight: '700', color: C.primary, marginBottom: 16 },
  modalLabel: {
    fontFamily: FONT_INTER, fontSize: 12, fontWeight: '600',
    color: C.secondary, marginTop: 8, marginBottom: 4,
  },
  modalPickerWrap: { alignItems: 'center', marginBottom: 4 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  modalCancelBtn: {
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8,
    backgroundColor: C.divider,
  },
  modalCancelText: { fontFamily: FONT_INTER, fontSize: 14, fontWeight: '500', color: C.primary },
  modalApplyBtn: {
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8,
    backgroundColor: C.primary,
  },
  modalApplyText: { fontFamily: FONT_INTER, fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  // Info modal
  infoCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 20,
    width: '88%', maxWidth: 420,
    ...CARD_SHADOW,
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  infoIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  infoTitle: { fontFamily: FONT_MONT, fontSize: 17, fontWeight: '700', color: C.primary },
  infoEventName: {
    fontFamily: Platform.OS === 'web' ? 'SF Mono, Menlo, monospace' : 'Menlo',
    fontSize: 11, color: C.tertiary, marginTop: 2,
  },
  infoSectionLabel: {
    fontFamily: FONT_INTER, fontSize: 10, fontWeight: '700',
    color: C.accent, letterSpacing: 0.8, marginTop: 14, marginBottom: 6,
  },
  infoText: {
    fontFamily: FONT_INTER, fontSize: 13, color: C.primary, lineHeight: 18,
  },
  infoCloseBtn: {
    marginTop: 20, paddingVertical: 12, borderRadius: 10,
    backgroundColor: C.primary, alignItems: 'center',
  },
  infoCloseText: { fontFamily: FONT_INTER, fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  // Misc
  loader: { marginTop: 32 },
  errorBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    backgroundColor: C.downSoft, borderRadius: 12, padding: 12, marginTop: 12,
  },
  errorText: { fontFamily: FONT_INTER, fontSize: 13, color: C.down, flex: 1 },
});
