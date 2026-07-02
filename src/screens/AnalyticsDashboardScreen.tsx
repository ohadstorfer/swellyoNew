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
  Pressable,
  RefreshControl,
  Dimensions,
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
import {
  fetchTripsAnalytics,
  TripsAnalyticsData,
} from '../services/analytics/analyticsTripsService';
import { RetentionCurveCard } from '../components/analytics/RetentionCurveCard';
import { friendlyErrorMessage } from '../utils/friendlyError';
import { FeatureAdoptionCard } from '../components/analytics/FeatureAdoptionCard';
import { BottomSheetShell } from '../components/BottomSheetShell';
import { TripHealthCard } from '../components/analytics/TripHealthCard';

const SCREEN_H = Dimensions.get('window').height;
// Two-column KPI grid: (screen − scroll padding 16×2 − gap 10) / 2.
const TILE_W = (Dimensions.get('window').width - 32 - 10) / 2;

type PresetKey = 'all' | 'today' | '7d' | '30d' | '90d' | '1y' | 'custom';
type DashTab = 'overview' | 'trips';
// Info-sheet keys: every analytics event, plus the non-event metrics.
type InfoKey = EventName | 'active_conversations';

const EMPTY_COUNTER: DashboardCounter = { total: 0, prev: 0, series: [] };

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

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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

// Headline KPIs shown as the top tile grid.
const OVERVIEW_TILES: { key: EventName; label: string; icon: IoniconName }[] = [
  { key: 'user_signed_up',        label: 'Users created',        icon: 'person-add-outline' },
  { key: 'app_opened',            label: 'App opens',            icon: 'phone-portrait-outline' },
  { key: 'onboarding_finalized',  label: 'Completed onboarding', icon: 'checkmark-done-outline' },
  { key: 'swelly_search_clicked', label: 'Swelly searches',      icon: 'search-outline' },
  { key: 'swelly_connect_clicked',label: 'Connects',             icon: 'link-outline' },
];

const EVENT_DEFINITIONS: Record<InfoKey, { what: string; when: string }> = {
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
    what: 'How many different people tapped the "Search" button in the Swelly chat to look for surfers in the selected time period. Each person counts once, no matter how many times they searched.',
    when: 'When someone taps the "Search" button in the Swelly chat.',
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
  active_conversations: {
    what: 'How many 1:1 conversations had at least one message sent during the selected time period. Each conversation counts once, no matter how many messages were exchanged.',
    when: 'A conversation counts as active for a period if any non-deleted message in it has a timestamp inside that range. Group chats are not counted, and conversations with a demo or admin participant are excluded.',
  },
};

const EVENT_LABELS: Record<InfoKey, string> = {
  user_signed_up: 'Signed up',
  onboarding_step_1: 'Step 1 · Board',
  onboarding_step_2: 'Step 2 · Surf level',
  onboarding_step_3: 'Step 3 · Experience',
  onboarding_step_4: 'Step 4 · Destinations',
  onboarding_step_5: 'Step 5 · Budget',
  onboarding_step_6: 'Step 6 · Lifestyle',
  onboarding_step_7: 'Step 7 · Profile',
  onboarding_finalized: 'Completed ("Got it")',
  swelly_search_clicked: 'Tapped "Search" button in Swelly chat',
  swelly_connect_clicked: 'Pressed "Connect"',
  first_message_sent: 'Sent first message',
  conversation_two_sided: 'Got a reply',
  conversation_deep_engaged: '4+ msgs each side',
  app_opened: 'Opened the app',
  active_conversations: 'Active conversations',
};

interface AnalyticsDashboardScreenProps {
  onBack: () => void;
}

export function AnalyticsDashboardScreen({ onBack }: AnalyticsDashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<RangeState>({ preset: 'all', from: null, to: null });
  const [data, setData] = useState<DashboardData | null>(null);
  const [tripsData, setTripsData] = useState<TripsAnalyticsData | null>(null);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DashTab>('overview');
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState<Date>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [customTo, setCustomTo] = useState<Date>(new Date());
  const [infoEvent, setInfoEvent] = useState<InfoKey | null>(null);

  const rangeShort = PRESETS.find(p => p.key === range.preset)?.shortLabel
    ?? (range.from && range.to ? `${fmtShortDate(range.from)} → ${fmtShortDate(range.to)}` : 'all time');

  const load = async (r: RangeState) => {
    setLoading(true);
    setError(null);
    setTripsError(null);
    // Trips analytics loads in parallel but fails independently — a missing /
    // not-yet-deployed analytics-trips function must not blank the whole screen.
    const tripsPromise = fetchTripsAnalytics({ from: r.from, to: r.to })
      .then(setTripsData)
      .catch((e: any) => setTripsError(friendlyErrorMessage(e, 'Failed to load trips analytics')));
    try {
      const d = await fetchDashboard({ from: r.from ?? undefined, to: r.to ?? undefined });
      setData(d);
    } catch (e: any) {
      setError(friendlyErrorMessage(e, 'Failed to load'));
    } finally {
      await tripsPromise;
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
  const isAllEmpty = !!data
    && Object.values(data.metrics).every(c => c.total === 0)
    && (data.active_conversations?.total ?? 0) === 0;

  return (
    <View style={styles.container}>
      {/* ============ Header ============ */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.headerSide} activeOpacity={0.7} onPress={onBack} hitSlop={HIT}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Analytics</Text>
          <View style={styles.headerSubRow}>
            <Ionicons name="shield-checkmark-outline" size={11} color={C.textSecondary} />
            <Text style={styles.headerSub} numberOfLines={1}>
              Demo &amp; admins excluded · {rangeShort}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.headerSide} activeOpacity={0.7} onPress={() => load(range)} hitSlop={HIT}>
          <Ionicons name="refresh" size={20} color={C.accent} />
        </TouchableOpacity>
      </View>

      {/* ============ Tabs ============ */}
      <View style={styles.tabBar}>
        {([
          { key: 'overview', label: 'Overview', icon: 'stats-chart-outline' },
          { key: 'trips', label: 'Group trips', icon: 'airplane-outline' },
        ] as { key: DashTab; label: string; icon: IoniconName }[]).map(t => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              activeOpacity={0.7}
              onPress={() => setTab(t.key)}
            >
              <Ionicons name={t.icon} size={15} color={active ? C.accent : C.textSecondary} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ============ Range selector (sticky) ============ */}
      <View style={styles.rangeBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {PRESETS.map(opt => {
            const active = opt.key === range.preset;
            const isCustom = opt.key === 'custom';
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.7}
                onPress={() => selectPreset(opt.key)}
              >
                {isCustom && (
                  <Ionicons
                    name="calendar-outline"
                    size={13}
                    color={active ? '#FFFFFF' : C.accent}
                    style={{ marginRight: 5 }}
                  />
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ============ Body ============ */}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading && !!data}
            onRefresh={() => load(range)}
            tintColor={C.accent}
            colors={[C.accent]}
          />
        }
      >
        {loading && !data && (
          <View style={styles.firstLoad}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={styles.firstLoadText}>Loading analytics…</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color={C.down} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {data && tab === 'overview' && (
          <>
            {isAllEmpty && <EmptyBanner />}

            <SectionLabel text="Overview" />
            <View style={styles.gridWrap}>
              {OVERVIEW_TILES.map(t => (
                <StatTile
                  key={t.key}
                  label={t.label}
                  icon={t.icon}
                  counter={data.metrics[t.key]}
                  eventKey={t.key}
                  onInfo={setInfoEvent}
                />
              ))}
              <StatTile
                label="Active conversations"
                icon="chatbubbles-outline"
                counter={data.active_conversations ?? EMPTY_COUNTER}
                eventKey="active_conversations"
                onInfo={setInfoEvent}
              />
            </View>

            <SectionLabel text="Funnels" />
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

        {tab === 'trips' && !loading && (
          <>
            {tripsError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color={C.down} />
                <Text style={styles.errorText}>Trips analytics: {tripsError}</Text>
              </View>
            )}
            {tripsData && (
              <>
                <RetentionCurveCard data={tripsData.retention} />
                <FeatureAdoptionCard features={tripsData.adoption.features} />
                <TripHealthCard buckets={tripsData.health.buckets} trips={tripsData.health.trips} />
              </>
            )}
          </>
        )}
      </ScrollView>

      <InfoSheet event={infoEvent} onClose={() => setInfoEvent(null)} />

      <CustomRangeSheet
        visible={customOpen}
        from={customFrom}
        to={customTo}
        onChangeFrom={setCustomFrom}
        onChangeTo={setCustomTo}
        onCancel={() => setCustomOpen(false)}
        onApply={applyCustom}
      />
    </View>
  );
}

// ============== Section label ==============

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text.toUpperCase()}</Text>;
}

// ============== Bottom sheet shell ==============

function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {children}
      </View>
    </BottomSheetShell>
  );
}

// ============== Info sheet ==============

function InfoSheet({ event, onClose }: { event: InfoKey | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  // Keep the last event around so content doesn't blank out during slide-out.
  const [shown, setShown] = useState<InfoKey | null>(null);
  useEffect(() => {
    if (event) setShown(event);
  }, [event]);
  const def = shown ? EVENT_DEFINITIONS[shown] : null;

  return (
    <BottomSheet visible={event !== null} onClose={onClose}>
      {shown && def && (
        <>
          <View style={styles.sheetHeader}>
            <View style={styles.infoHeaderLeft}>
              <View style={styles.infoIconWrap}>
                <Ionicons name="information-circle" size={20} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{EVENT_LABELS[shown]}</Text>
                <Text style={styles.infoEventName}>{shown}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} hitSlop={HIT} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color={C.label} />
            </TouchableOpacity>
          </View>

          <View style={styles.sheetBody}>
            <Text style={styles.infoSectionLabel}>WHAT IT COUNTS</Text>
            <Text style={styles.infoText}>{def.what}</Text>

            <Text style={[styles.infoSectionLabel, { marginTop: 18 }]}>WHEN IT'S RECORDED</Text>
            <Text style={styles.infoText}>{def.when}</Text>
          </View>

          <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + 14 }]}>
            <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.btnPrimaryText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

// ============== Custom range sheet ==============

interface CustomRangeSheetProps {
  visible: boolean;
  from: Date;
  to: Date;
  onChangeFrom: (d: Date) => void;
  onChangeTo: (d: Date) => void;
  onCancel: () => void;
  onApply: () => void;
}

function CustomRangeSheet({ visible, from, to, onChangeFrom, onChangeTo, onCancel, onApply }: CustomRangeSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet visible={visible} onClose={onCancel}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Custom date range</Text>
        <TouchableOpacity style={styles.sheetCloseBtn} onPress={onCancel} hitSlop={HIT} activeOpacity={0.7}>
          <Ionicons name="close" size={18} color={C.label} />
        </TouchableOpacity>
      </View>

      <View style={styles.sheetBody}>
        <DateField label="FROM" value={from} onChange={onChangeFrom} maximumDate={to} />
        <DateField label="TO" value={to} onChange={onChangeTo} minimumDate={from} maximumDate={new Date()} />
      </View>

      <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={[styles.btnSecondary, { flex: 1 }]} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.btnSecondaryText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={onApply} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Apply</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

// ============== Date field (platform-aware) ==============

interface DateFieldProps {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}

function DateField({ label, value, onChange, minimumDate, maximumDate }: DateFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <View style={styles.dateField}>
      <Text style={styles.dateFieldLabel}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            value={value}
            mode="date"
            display="spinner"
            onChange={(_e, d) => d && onChange(d)}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
          />
        </View>
      ) : (
        <>
          <TouchableOpacity style={styles.dateButton} activeOpacity={0.7} onPress={() => setPickerOpen(true)}>
            <Ionicons name="calendar-outline" size={16} color={C.accent} />
            <Text style={styles.dateButtonText}>{fmtShortDate(value.toISOString())}</Text>
            <Ionicons name="chevron-down" size={15} color={C.textSecondary} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          {pickerOpen && (
            <DateTimePicker
              value={value}
              mode="date"
              display="default"
              onChange={(_e, d) => {
                setPickerOpen(false);
                if (d) onChange(d);
              }}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
            />
          )}
        </>
      )}
    </View>
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

// ============== Delta pill ==============

function DeltaPill({ counter }: { counter: DashboardCounter }) {
  const delta = deltaPct(counter.total, counter.prev);
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);
  if (!delta) {
    return (
      <Text style={styles.deltaPlaceholder}>
        {isEmpty ? 'No events yet' : 'No prior data'}
      </Text>
    );
  }
  return (
    <View style={[styles.deltaPill, delta.up ? styles.deltaPillUp : styles.deltaPillDown]}>
      <Text style={[styles.deltaText, delta.up ? styles.deltaUp : styles.deltaDown]}>
        {delta.flat ? '— flat' : `${delta.up ? '▲' : '▼'} ${delta.value.toFixed(0)}%`}
      </Text>
    </View>
  );
}

// ============== Stat tile (KPI grid) ==============

interface StatTileProps {
  label: string;
  icon: IoniconName;
  counter: DashboardCounter;
  eventKey: InfoKey;
  onInfo: (e: InfoKey) => void;
}

function StatTile({ label, icon, counter, eventKey, onInfo }: StatTileProps) {
  const isEmpty = counter.total === 0 && counter.series.every(v => v === 0);
  return (
    <TouchableOpacity style={styles.tile} activeOpacity={0.7} onPress={() => onInfo(eventKey)}>
      <View style={styles.tileHeader}>
        <View style={styles.tileIconWrap}>
          <Ionicons name={icon} size={15} color={C.accent} />
        </View>
        <Ionicons name="information-circle-outline" size={15} color={C.faint} />
      </View>

      <Text style={styles.tileNumber} numberOfLines={1}>
        {counter.total.toLocaleString()}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>

      <View style={styles.tileFooter}>
        <DeltaPill counter={counter} />
        {!isEmpty && (
          <View style={styles.tileSpark}>
            <Sparkline data={counter.series} height={22} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ============== Funnel section (with view toggle) ==============

interface FunnelSectionProps {
  title: string;
  subtitle?: string;
  icon: IoniconName;
  events: EventName[];
  metrics: Record<EventName, DashboardCounter>;
  onInfo: (e: InfoKey) => void;
}

function FunnelSection({ title, subtitle, icon, events, metrics, onInfo }: FunnelSectionProps) {
  const counts = events.map(e => metrics[e]?.total ?? 0);
  const top = counts[0] || 0;
  const bottom = counts[counts.length - 1] || 0;
  const max = counts[0] || 1;
  const allZero = counts.every(c => c === 0);
  const overallConv = top > 0 ? (bottom / top) * 100 : null;

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIconWrap}>
          <Ionicons name={icon} size={16} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
        </View>
      </View>

      {allZero ? (
        <View style={styles.funnelEmpty}>
          <Ionicons name="bar-chart-outline" size={20} color={C.faint} />
          <Text style={styles.funnelEmptyText}>No events in this range yet.</Text>
        </View>
      ) : (
        <>
          {/* Conversion callout */}
          <View style={styles.convCallout}>
            <View style={styles.convIconWrap}>
              <Ionicons name="git-compare-outline" size={16} color={C.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.convLabel}>End-to-end conversion</Text>
              <Text style={styles.convSub}>
                {top.toLocaleString()} → {bottom.toLocaleString()} · first to last step
              </Text>
            </View>
            <Text style={styles.convPctBig}>
              {overallConv !== null ? `${overallConv.toFixed(0)}%` : '—'}
            </Text>
          </View>

          <FunnelBars events={events} counts={counts} max={max} metrics={metrics} onInfo={onInfo} />
        </>
      )}
    </View>
  );
}

// ============== Funnel bars ==============

interface FunnelViewProps {
  events: EventName[];
  counts: number[];
  metrics: Record<EventName, DashboardCounter>;
  onInfo: (e: InfoKey) => void;
}

function FunnelBars({ events, counts, max, metrics, onInfo }: FunnelViewProps & { max: number }) {
  return (
    <View style={styles.funnelList}>
      {events.map((ev, i) => {
        const c = metrics[ev] ?? { total: 0, prev: 0, series: [] };
        const pct = max > 0 ? (c.total / max) * 100 : 0;
        const dropoff = i > 0 ? counts[i - 1] - c.total : 0;
        const dropoffPct = i > 0 && counts[i - 1] > 0 ? (dropoff / counts[i - 1]) * 100 : 0;
        const delta = deltaPct(c.total, c.prev);

        return (
          <TouchableOpacity
            key={ev}
            style={[styles.funnelRow, i > 0 && styles.funnelRowDivider]}
            activeOpacity={0.6}
            onPress={() => onInfo(ev)}
          >
            <View style={styles.funnelTopRow}>
              <Text style={styles.funnelLabel} numberOfLines={1}>{EVENT_LABELS[ev] ?? ev}</Text>
              <View style={styles.funnelNumbers}>
                <Text style={styles.funnelNumber}>{c.total.toLocaleString()}</Text>
                {delta && (
                  <Text style={[styles.funnelDelta, delta.up ? styles.deltaUp : styles.deltaDown]}>
                    {delta.flat ? '— ' : (delta.up ? '▲ ' : '▼ ')}{delta.value.toFixed(0)}%
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.funnelBarRow}>
              <View style={styles.funnelBarWrap}>
                <View style={[styles.funnelBar, { width: `${Math.max(pct, 2)}%` }]} />
              </View>
              <Text style={styles.funnelPct}>{pct.toFixed(0)}%</Text>
            </View>
            {i > 0 && dropoff > 0 && (
              <Text style={styles.funnelDropoff}>
                ↓ {dropoff.toLocaleString()} dropped off ({dropoffPct.toFixed(0)}%)
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
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
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      )}
    </View>
  );
}

// ============== Tokens & styles ==============

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// Palette aligned with the app design system (src/styles/theme.ts).
const C = {
  bg: '#F4F5F7',
  card: '#FFFFFF',
  text: '#222B30',
  textSecondary: '#7B7B7B',
  label: '#4A5565',
  faint: '#AEB4BC',
  border: '#E5E7EB',
  divider: '#ECECEC',
  track: '#EEF0F2',
  accent: '#0788B0',
  accentSoft: '#E6F4F8',
  accentBg: '#F0F8FB',
  up: '#1B9E5A',
  upSoft: '#E7F6EE',
  down: '#C0392B',
  downSoft: '#FBE9E7',
  backdrop: 'rgba(0,0,0,0.45)',
};

const CARD_SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  android: { elevation: 2 },
  default: {},
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // ----- Header -----
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: C.card,
  },
  headerSide: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', paddingTop: 2 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  headerSub: { fontSize: 11.5, fontWeight: '500', color: C.textSecondary },

  // ----- Tab bar -----
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 10,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabBtnActive: {
    backgroundColor: C.accentSoft,
    borderColor: C.accent,
  },
  tabText: { fontSize: 13, fontWeight: '600', color: C.textSecondary },
  tabTextActive: { color: C.accent, fontWeight: '700' },

  // ----- Range bar -----
  rangeBar: {
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
    paddingBottom: 12,
  },
  chipsContent: { paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: C.text },
  chipTextActive: { color: '#FFFFFF' },

  // ----- Scroll body -----
  scrollContent: { paddingHorizontal: 16, paddingTop: 18 },

  firstLoad: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  firstLoadText: { fontSize: 13, color: C.textSecondary, fontWeight: '500' },

  errorBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    backgroundColor: C.downSoft, borderRadius: 12, padding: 14, marginBottom: 16,
  },
  errorText: { fontSize: 13, color: C.down, flex: 1, fontWeight: '500' },

  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: C.label,
    letterSpacing: 0.6, marginBottom: 10,
  },

  // ----- Empty banner -----
  emptyBanner: {
    flexDirection: 'row', gap: 12, padding: 16,
    backgroundColor: C.accentBg, borderRadius: 14, marginBottom: 20,
    borderWidth: 1, borderColor: C.accentSoft,
  },
  emptyIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  emptyBody: { fontSize: 12.5, color: C.textSecondary, marginTop: 3, lineHeight: 18 },

  // ----- KPI tile grid -----
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  tile: {
    width: TILE_W,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    minHeight: 150,
    borderWidth: 1,
    borderColor: C.border,
    ...CARD_SHADOW,
  },
  tileHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  tileIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tileNumber: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.6 },
  tileLabel: {
    fontSize: 12, fontWeight: '600', color: C.textSecondary,
    lineHeight: 16, marginTop: 2, minHeight: 32,
  },
  tileFooter: { marginTop: 'auto', paddingTop: 8 },
  tileSpark: { marginTop: 8 },

  // ----- Delta pill -----
  deltaPill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  deltaPillUp: { backgroundColor: C.upSoft },
  deltaPillDown: { backgroundColor: C.downSoft },
  deltaText: { fontSize: 11, fontWeight: '700' },
  deltaUp: { color: C.up },
  deltaDown: { color: C.down },
  deltaPlaceholder: { fontSize: 10.5, fontWeight: '500', color: C.faint, fontStyle: 'italic' },

  // ----- Section cards -----
  sectionCard: {
    backgroundColor: C.card, borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    ...CARD_SHADOW,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  sectionIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  sectionSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  // ----- Conversion callout -----
  convCallout: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: C.accentBg, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11,
    borderWidth: 1, borderColor: C.accentSoft,
    marginBottom: 6,
  },
  convIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  convLabel: { fontSize: 12.5, fontWeight: '700', color: C.text },
  convSub: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  convPctBig: { fontSize: 24, fontWeight: '800', color: C.accent, letterSpacing: -0.5 },

  // ----- Funnel bars -----
  funnelList: { marginTop: 4 },
  funnelRow: { paddingVertical: 13 },
  funnelRowDivider: { borderTopWidth: 1, borderTopColor: C.divider },
  funnelTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  funnelLabel: { fontSize: 13, fontWeight: '600', color: C.text, flex: 1, paddingRight: 10 },
  funnelNumbers: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  funnelNumber: { fontSize: 17, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  funnelDelta: { fontSize: 11, fontWeight: '700' },
  funnelBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  funnelBarWrap: { flex: 1, height: 10, backgroundColor: C.track, borderRadius: 5, overflow: 'hidden' },
  funnelBar: { height: '100%', backgroundColor: C.accent, borderRadius: 5 },
  funnelPct: { fontSize: 11, fontWeight: '600', color: C.textSecondary, width: 34, textAlign: 'right' },
  funnelDropoff: { fontSize: 11, color: C.down, marginTop: 7, fontWeight: '500' },
  funnelEmpty: {
    paddingVertical: 28, alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, backgroundColor: C.bg, marginTop: 4,
  },
  funnelEmptyText: { fontSize: 12.5, color: C.textSecondary, fontStyle: 'italic' },

  // ----- Bottom sheet -----
  sheetBackdrop: { flex: 1, backgroundColor: C.backdrop, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_H * 0.9,
    paddingTop: 6,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#D7DBE0',
    alignSelf: 'center', marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  sheetCloseBtn: {
    width: 30, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  sheetFooter: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: C.divider,
  },

  // ----- Info sheet -----
  infoHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 12 },
  infoIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: C.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  infoEventName: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11, color: C.faint, marginTop: 2,
  },
  infoSectionLabel: {
    fontSize: 10.5, fontWeight: '800',
    color: C.accent, letterSpacing: 0.8, marginBottom: 7,
  },
  infoText: { fontSize: 13.5, color: C.text, lineHeight: 20 },

  // ----- Date field -----
  dateField: { marginBottom: 16 },
  dateFieldLabel: {
    fontSize: 11, fontWeight: '800', color: C.label,
    letterSpacing: 0.6, marginBottom: 8,
  },
  iosPickerWrap: {
    alignItems: 'center',
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  dateButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.bg,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  dateButtonText: { fontSize: 15, fontWeight: '600', color: C.text },

  // ----- Buttons -----
  btnPrimary: {
    backgroundColor: C.accent,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { color: C.text, fontWeight: '700', fontSize: 15 },
});
