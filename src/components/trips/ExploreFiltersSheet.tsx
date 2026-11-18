// Explore filter sheet: budget range slider, dates calendar, age range.
//
// Replaces the old chips ("Below/Above $1k", three month chips). The picks are
// a DRAFT while the sheet is open, so dragging a slider does not re-query the
// server on every tick. "Show trips" (or closing the sheet any other way)
// applies them.
//
// Every value is null when its filter is off. The server (explore_feed:
// p_price_*, p_date_*, p_age_*) treats null as "no bound".
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import BottomSheetShell from '../BottomSheetShell';
import { RangeSlider } from './RangeSlider';
import { CalendarRangePicker } from './CalendarRangePicker';
import { formatAmount, type Viewer } from '../../utils/currency';
import { ff, fs } from '../../theme/fonts';
import { fontSize, textStyle, textStyles } from '../../theme/typography';

/** USD. The slider's right end means "no max". */
export const PRICE_SLIDER_MAX = 10000;
const PRICE_STEP = 250;
/** The slider's ends mean "no bound" on that side. */
export const AGE_SLIDER_MIN = 18;
export const AGE_SLIDER_MAX = 70;
const AGE_DEFAULT_RANGE = { lower: 25, upper: 40 };

export interface ExploreFilters {
  priceMin: number | null;  // USD
  priceMax: number | null;  // USD
  dateFrom: string | null;  // YYYY-MM-DD
  dateTo: string | null;    // YYYY-MM-DD
  ageMin: number | null;
  ageMax: number | null;
}

export const EMPTY_EXPLORE_FILTERS: ExploreFilters = {
  priceMin: null, priceMax: null, dateFrom: null, dateTo: null, ageMin: null, ageMax: null,
};

/** How many filter groups are on (shown as the badge on the filter button). */
export const countActiveFilters = (f: ExploreFilters): number =>
  (f.priceMin != null || f.priceMax != null ? 1 : 0) +
  (f.dateFrom != null || f.dateTo != null ? 1 : 0) +
  (f.ageMin != null || f.ageMax != null ? 1 : 0);

const toYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string | null): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "Any dates", "Jan 28", "Jan 1 – Jan 28", or with years when they differ
 *  from each other ("Dec 28, 2026 – Jan 4, 2027"). */
const formatDatesSummary = (from: string | null, to: string | null): string => {
  const a = fromYmd(from ?? to);
  const b = fromYmd(to ?? from);
  if (!a || !b) return 'Any dates';
  const crossYear = a.getFullYear() !== b.getFullYear();
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(crossYear ? { year: 'numeric' } : {}),
    });
  return a.getTime() === b.getTime() ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
};

interface Props {
  visible: boolean;
  /** The filters in force now. The sheet starts its draft from these. */
  value: ExploreFilters;
  /** Called once, when the sheet closes, with the draft. */
  onApply: (next: ExploreFilters) => void;
  /** Label currency for the budget slider. The filter value stays in USD. */
  viewer: Viewer;
}

export const ExploreFiltersSheet: React.FC<Props> = ({ visible, value, onApply, viewer }) => {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ExploreFilters>(value);
  // "All ages" vs "Choose a range". A chosen range at both slider ends is
  // still "all ages" on the server (both bounds null).
  const [ageCustom, setAgeCustom] = useState(value.ageMin != null || value.ageMax != null);
  // The calendar is tall, so its group starts closed every time.
  const [datesOpen, setDatesOpen] = useState(false);

  // Each time the sheet opens, start again from what is in force.
  useEffect(() => {
    if (!visible) return;
    setDatesOpen(false);
    setDraft(value);
    setAgeCustom(value.ageMin != null || value.ageMax != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = () => onApply(draft);

  const rate = viewer.currency === 'USD' ? null : viewer.rates?.[viewer.currency];
  const money = (usd: number) =>
    rate != null && Number.isFinite(rate) && rate > 0
      ? formatAmount(usd * rate, viewer.currency)
      : formatAmount(usd, 'USD');
  const moneyShort = (usd: number) => {
    const full = money(usd);
    return usd >= PRICE_SLIDER_MAX ? `${full}+` : full;
  };

  const priceLower = draft.priceMin ?? 0;
  const priceUpper = draft.priceMax ?? PRICE_SLIDER_MAX;
  // null = the slider's end (no bound), the same mapping onChange uses, so a
  // value sent up comes back unchanged. (A default here would bounce the
  // thumb: dragged to 18 → null → back as some other number.) The starting
  // 25–40 is set once, by pickAgeRange.
  const ageLower = draft.ageMin ?? AGE_SLIDER_MIN;
  const ageUpper = draft.ageMax ?? AGE_SLIDER_MAX;

  const priceSummary = useMemo(() => {
    if (draft.priceMin == null && draft.priceMax == null) return 'Any budget';
    if (draft.priceMin == null) return `Up to ${money(draft.priceMax!)}`;
    if (draft.priceMax == null) return `${money(draft.priceMin)}+`;
    return `${money(draft.priceMin)} – ${money(draft.priceMax)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.priceMin, draft.priceMax, viewer]);

  const ageSummary =
    !ageCustom ? 'All ages'
      : ageLower <= AGE_SLIDER_MIN && ageUpper >= AGE_SLIDER_MAX ? 'All ages'
        : ageUpper >= AGE_SLIDER_MAX ? `${ageLower}+`
          : `${ageLower} – ${ageUpper}`;

  const datesSummary = formatDatesSummary(draft.dateFrom, draft.dateTo);

  const activeCount = countActiveFilters(draft);

  const pickAllAges = () => {
    setAgeCustom(false);
    setDraft(d => ({ ...d, ageMin: null, ageMax: null }));
  };
  const pickAgeRange = () => {
    setAgeCustom(true);
    setDraft(d => ({ ...d, ageMin: AGE_DEFAULT_RANGE.lower, ageMax: AGE_DEFAULT_RANGE.upper }));
  };

  return (
    <BottomSheetShell visible={visible} onClose={close}>
      {({ panHandlers }) => (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View {...panHandlers}>
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
            <View style={styles.header}>
              <Text style={styles.title}>Filters</Text>
              {activeCount > 0 && (
                <TouchableOpacity
                  onPress={() => { setDraft(EMPTY_EXPLORE_FILTERS); setAgeCustom(false); }}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.clear}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.groupRow}>
              <Text style={styles.group}>Budget</Text>
              <Text style={styles.groupValue}>{priceSummary}</Text>
            </View>
            <RangeSlider
              min={0}
              max={PRICE_SLIDER_MAX}
              step={PRICE_STEP}
              lower={priceLower}
              upper={priceUpper}
              minLabel={money(0)}
              maxLabel={moneyShort(PRICE_SLIDER_MAX)}
              onChange={({ lower, upper }) =>
                setDraft(d => ({
                  ...d,
                  priceMin: lower <= 0 ? null : lower,
                  priceMax: upper >= PRICE_SLIDER_MAX ? null : upper,
                }))
              }
            />

            {/* Collapsed by default: the header shows the picked dates (or
                "Any dates") and a chevron; tapping it opens the calendar. */}
            <TouchableOpacity
              style={styles.groupRow}
              onPress={() => setDatesOpen(o => !o)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: datesOpen }}
              accessibilityLabel={`Dates, ${datesSummary}`}
            >
              <Text style={styles.group}>Dates</Text>
              <View style={styles.groupRight}>
                <Text style={styles.groupValue}>{datesSummary}</Text>
                <Chevron open={datesOpen} />
              </View>
            </TouchableOpacity>
            <Collapsible open={datesOpen}>
                <CalendarRangePicker
                  alwaysOpen
                  clampPastMonths
                  startDate={fromYmd(draft.dateFrom)}
                  endDate={fromYmd(draft.dateTo)}
                  onChange={({ startDate, endDate }) =>
                    setDraft(d => ({
                      ...d,
                      dateFrom: startDate ? toYmd(startDate) : null,
                      dateTo: endDate ? toYmd(endDate) : null,
                    }))
                  }
                />
                {(draft.dateFrom || draft.dateTo) && (
                  <TouchableOpacity
                    style={styles.clearDates}
                    onPress={() => setDraft(d => ({ ...d, dateFrom: null, dateTo: null }))}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.clear}>Clear dates</Text>
                  </TouchableOpacity>
                )}
            </Collapsible>

            <View style={styles.groupRow}>
              <Text style={styles.group}>Age</Text>
              <Text style={styles.groupValue}>{ageSummary}</Text>
            </View>
            <View style={styles.chips}>
              <Chip label="All ages" active={!ageCustom} onPress={pickAllAges} />
              <Chip label="Choose a range" active={ageCustom} onPress={pickAgeRange} />
            </View>
            {ageCustom && (
              <View style={styles.ageSlider}>
                <RangeSlider
                  min={AGE_SLIDER_MIN}
                  max={AGE_SLIDER_MAX}
                  step={1}
                  lower={ageLower}
                  upper={ageUpper}
                  minLabel={`${AGE_SLIDER_MIN}`}
                  maxLabel={`${AGE_SLIDER_MAX}+`}
                  onChange={({ lower, upper }) =>
                    setDraft(d => ({
                      ...d,
                      ageMin: lower <= AGE_SLIDER_MIN ? null : lower,
                      ageMax: upper >= AGE_SLIDER_MAX ? null : upper,
                    }))
                  }
                />
              </View>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.done} onPress={close} activeOpacity={0.9} accessibilityRole="button">
            <Text style={styles.doneText}>Show trips</Text>
          </TouchableOpacity>
        </View>
      )}
    </BottomSheetShell>
  );
};

// Open/close by animating the height to the content's measured height (and
// back to 0), with a fade. The content stays mounted so its height is known
// before the first open. ease-out: it answers the tap at once, then settles.
const EXPAND_MS = 260;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const Collapsible: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => {
  const reduceMotion = useReducedMotion();
  const contentH = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {
      duration: reduceMotion ? 0 : EXPAND_MS,
      easing: EASE_OUT,
    });
  }, [open, reduceMotion, progress]);
  const style = useAnimatedStyle(() => ({
    height: contentH.value * progress.value,
    opacity: progress.value,
  }));
  return (
    <Animated.View
      style={[styles.collapsible, style]}
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      {/* Absolute, so it lays out at its natural height whatever the
          wrapper's animated height is. */}
      <View
        style={styles.collapsibleInner}
        onLayout={e => {
          contentH.value = e.nativeEvent.layout.height;
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
};

const Chevron: React.FC<{ open: boolean }> = ({ open }) => {
  const reduceMotion = useReducedMotion();
  const rot = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    rot.value = withTiming(open ? 1 : 0, { duration: reduceMotion ? 0 : EXPAND_MS, easing: EASE_OUT });
  }, [open, reduceMotion, rot]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={16} color="#333333" />
    </Animated.View>
  );
};

const Chip: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({ label, active, onPress }) => (
  <TouchableOpacity
    style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
    onPress={onPress}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
  >
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>{label}</Text>
  </TouchableOpacity>
);

// Same look as the chip sheet it replaces (TripsScreen fs* styles).
const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...textStyle('MB1', '700'), color: '#333333' },
  clear: { ...textStyles.MB2, color: '#05BCD3' },
  // Full sheet width with the side padding inside: a ScrollView clips its
  // content, and the slider thumbs' shadows need room past the track ends.
  scroll: { flexGrow: 0, flexShrink: 1, marginHorizontal: -16 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 4 },
  collapsible: { overflow: 'hidden' },
  collapsibleInner: { position: 'absolute', top: 0, left: 0, right: 0 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  group: { ...textStyle('B3', '700'), color: '#7B7B7B' },
  groupValue: { ...textStyle('B3', '600'), color: '#333333' },
  groupRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clearDates: { alignSelf: 'flex-end', marginTop: 10, marginBottom: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  chipActive: { backgroundColor: '#212121', borderWidth: 1, borderColor: '#212121' },
  chipInactive: { backgroundColor: '#F7F7F7', borderWidth: 1, borderColor: '#EEEEEE' },
  chipText: { ...textStyles.B3 },
  chipTextActive: { color: '#FFFFFF' },
  chipTextInactive: { color: '#333333' },
  ageSlider: { marginTop: 12 },
  done: {
    marginTop: 16,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#212121',
  },
  doneText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(fontSize.lg),
    lineHeight: 22,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
    includeFontPadding: false,
    color: '#FFFFFF',
  },
});
