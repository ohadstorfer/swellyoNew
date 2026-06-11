// WhenSheetContent — Calendar/Months toggle + range picker + tap-toggle duration (days <-> weeks).
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Keyboard,
  InputAccessoryView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CalendarRangePicker } from '../CalendarRangePicker';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#05BCD3',
  brandTealTint: '#E6F4F8',
  brandTealText: '#05BCD3',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  borderDivider: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  segmentBg: '#F2F2F2',
  accessoryBg: '#F2F2F2',
};

// InputAccessoryViewID — iOS-only toolbar above the numeric keyboard with a
// Done button. The number-pad keyboard has no built-in Done key, so without
// this the user can't dismiss the keyboard except by tapping outside.
const DURATION_ACCESSORY_ID = 'whenDurationDone';

export type DateMode = 'calendar' | 'months';

export interface WhenSheetContentProps {
  mode: DateMode;
  onModeChange: (m: DateMode) => void;
  // Calendar mode
  startDate: Date | null;
  endDate: Date | null;
  onCalendarChange: (next: {
    startDate: Date | null;
    endDate: Date | null;
  }) => void;
  // Months mode
  monthFrom: string; // 'YYYY-MM'
  monthTo: string;
  onMonthsChange: (next: { monthFrom: string; monthTo: string }) => void;
  durationDays: number | null;
  onDurationChange: (days: number | null) => void;
  /** Flow C — exact dates only. Hides the SPECIFIC/LOOSE toggle and forces calendar. */
  lockCalendar?: boolean;
}

interface MonthEntry {
  value: string; // 'YYYY-MM'
  shortMonth: string;
  year: number;
  label: string;
}

// Max calendar months allowed in a range (e.g. 2 → 'Aug–Sep' OK, 'Aug–Oct' rejected).
const MAX_MONTHS_SPAN = 2;

const monthsBetween = (a: string, b: string): number => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return Math.abs((yb - ya) * 12 + (mb - ma));
};

const buildMonthsThisYearForward = (): MonthEntry[] => {
  const out: MonthEntry[] = [];
  const now = new Date();
  const thisYear = now.getFullYear();
  // 12 cubes starting from current month.
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const shortMonth = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    const label =
      year === thisYear ? shortMonth : `${shortMonth} '${String(year).slice(2)}`;
    out.push({ value, shortMonth, year, label });
  }
  return out;
};

export const WhenSheetContent: React.FC<WhenSheetContentProps> = ({
  mode,
  onModeChange,
  startDate,
  endDate,
  onCalendarChange,
  monthFrom,
  monthTo,
  onMonthsChange,
  durationDays,
  onDurationChange,
  lockCalendar,
}) => {
  const months = useMemo(() => buildMonthsThisYearForward(), []);
  // Flow C is calendar-only — collapse to the calendar regardless of `mode`.
  const effectiveMode: DateMode = lockCalendar ? 'calendar' : mode;
  // Unit toggle for the duration field. The number the user typed stays as-is
  // when the unit flips; only the multiplier feeding `durationDays` changes.
  const [unit, setUnit] = useState<'days' | 'weeks'>('days');
  // Local string state for the input so toggling the unit doesn't rewrite it.
  const [inputValue, setInputValue] = useState<string>(
    durationDays != null ? String(durationDays) : '',
  );

  // Sync local input if parent resets durationDays externally (e.g. draft restore).
  // We only pull in when the new value can't be derived from current input+unit,
  // so the user's typed number isn't clobbered by a value we just emitted.
  useEffect(() => {
    const currentEmitted = (() => {
      const n = Number(inputValue);
      if (!Number.isFinite(n) || n <= 0) return null;
      return unit === 'weeks' ? n * 7 : n;
    })();
    if (currentEmitted !== durationDays) {
      setInputValue(durationDays != null ? String(durationDays) : '');
      setUnit('days');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationDays]);

  const handleMonthTap = (value: string) => {
    if (!monthFrom) {
      onMonthsChange({ monthFrom: value, monthTo: '' });
      return;
    }
    if (!monthTo) {
      if (value === monthFrom) {
        onMonthsChange({ monthFrom: '', monthTo: '' });
        return;
      }
      // Reject ranges that would exceed MAX_MONTHS_SPAN — silently restart from
      // the tapped month. (e.g. Aug start + tap Oct = span 3, treat as new start.)
      if (monthsBetween(monthFrom, value) + 1 > MAX_MONTHS_SPAN) {
        onMonthsChange({ monthFrom: value, monthTo: '' });
        return;
      }
      if (value < monthFrom) {
        onMonthsChange({ monthFrom: value, monthTo: monthFrom });
      } else {
        onMonthsChange({ monthFrom, monthTo: value });
      }
      return;
    }
    // Full range already → restart.
    onMonthsChange({ monthFrom: value, monthTo: '' });
  };

  const handleDurationText = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '');
    setInputValue(cleaned);
    if (!cleaned) {
      onDurationChange(null);
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) {
      onDurationChange(null);
      return;
    }
    onDurationChange(unit === 'weeks' ? n * 7 : n);
  };

  const toggleUnit = () => {
    setUnit(prev => {
      const next = prev === 'days' ? 'weeks' : 'days';
      // Re-emit durationDays under the new unit without changing the typed number.
      const n = Number(inputValue);
      if (Number.isFinite(n) && n > 0) {
        onDurationChange(next === 'weeks' ? n * 7 : n);
      }
      return next;
    });
  };

  return (
    <View style={styles.container}>
      {/* Mode toggle — two selectable cards (hidden in calendar-only Flow C). */}
      {lockCalendar ? null : (
      <View style={styles.segment}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onModeChange('calendar')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'calendar' }}
          style={[styles.segCard, mode === 'calendar' && styles.segCardActive]}
        >
          <Ionicons name="calendar-outline" size={22} color={C.inkBody} />
          <Text style={styles.segTitle}>Specific</Text>
          <Text style={styles.segSub}>Exact dates</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onModeChange('months')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'months' }}
          style={[styles.segCard, mode === 'months' && styles.segCardActive]}
        >
          <Ionicons name="calendar-clear-outline" size={22} color={C.inkBody} />
          <Text style={styles.segTitle}>Loose</Text>
          <Text style={styles.segSub}>Flexible months</Text>
        </TouchableOpacity>
      </View>
      )}

      {effectiveMode === 'calendar' ? (
        <CalendarRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={onCalendarChange}
          clampPastMonths
          alwaysOpen
          placeholder="Pick start and end dates"
        />
      ) : (
        <View style={styles.monthsBlock}>
          <View style={styles.monthsGrid}>
            {months.map(m => {
              const isStart = monthFrom === m.value;
              const isEnd = monthTo === m.value;
              const isEndpoint = isStart || isEnd;
              const isMid =
                !!monthFrom &&
                !!monthTo &&
                m.value > monthFrom &&
                m.value < monthTo;
              return (
                <TouchableOpacity
                  key={m.value}
                  activeOpacity={0.85}
                  onPress={() => handleMonthTap(m.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isEndpoint || isMid }}
                  style={[
                    styles.monthCube,
                    isMid && styles.monthCubeMid,
                    isEndpoint && styles.monthCubeEndpoint,
                  ]}
                >
                  <Text
                    style={[
                      styles.monthCubeText,
                      isMid && styles.monthCubeTextMid,
                      isEndpoint && styles.monthCubeTextEndpoint,
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Duration row — number + tappable unit toggle pill */}
          <View style={styles.durationRow}>
            <Text style={styles.durationLabel}>How long?</Text>
            <View style={styles.durationInputRow}>
              <TextInput
                value={inputValue}
                onChangeText={handleDurationText}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={3}
                placeholder="0"
                placeholderTextColor={C.textMuted}
                style={styles.durationInput}
                accessibilityLabel="Trip length"
                returnKeyType="done"
                inputAccessoryViewID={
                  Platform.OS === 'ios' ? DURATION_ACCESSORY_ID : undefined
                }
              />
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={toggleUnit}
                accessibilityRole="button"
                accessibilityLabel={`Switch unit, currently ${unit}`}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={styles.unitPill}
              >
                <Text style={styles.unitPillText}>
                  {unit === 'days' ? 'days' : 'weeks'}
                </Text>
                <Ionicons
                  name="swap-horizontal"
                  size={14}
                  color="#FFFFFF"
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* iOS-only input-accessory toolbar with Done button. number-pad has no
          Done key built-in, so this is the canonical way to dismiss it. */}
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={DURATION_ACCESSORY_ID}>
          <View style={styles.accessoryBar}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => Keyboard.dismiss()}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.accessoryDone}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 20,
  },
  segment: {
    flexDirection: 'row',
    gap: 10,
  },
  // Selectable card — same teal-tint highlight as the month cubes / option cards.
  segCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: C.surfaceCard,
  },
  // Selected = blue border only (no fill, no icon/text recolor), slightly thicker.
  segCardActive: {
    borderColor: C.brandTeal,
    borderWidth: 2,
  },
  segTitle: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '700',
    color: C.inkBody,
  },
  segSub: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '400',
    color: C.textMuted,
  },

  monthsBlock: {
    gap: 20,
  },
  // Even 4-column grid: each cube takes 23% of the width and space-between
  // distributes the remaining ~8% evenly across the 3 gaps.
  monthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  // Month cube: snappy rounded square pill, 4 per row, comfortable tap height.
  monthCube: {
    width: '23%',
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderDivider,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  monthCubeMid: {
    backgroundColor: '#F2F2F2',
    borderColor: '#212121',
  },
  monthCubeEndpoint: {
    backgroundColor: '#212121',
    borderColor: '#212121',
  },
  monthCubeText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: C.inkBody,
    textAlign: 'center',
  },
  monthCubeTextMid: {
    color: '#212121',
  },
  monthCubeTextEndpoint: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  durationRow: {
    gap: 8,
  },
  durationLabel: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: C.inkBody,
  },
  // One continuous bar: number on the left, colored unit toggle attached on the
  // right. overflow:hidden clips the toggle to the bar's rounded corners.
  durationInputRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 54,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.surfaceCard,
  },
  durationInput: {
    flex: 1,
    paddingHorizontal: 16,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 22,
    fontWeight: '700',
    color: C.inkBody,
    textAlignVertical: 'center',
  },
  // Colored section of the bar — reads as an attached toggle button. Fixed
  // width so it doesn't resize between "days" and "weeks".
  unitPill: {
    width: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#212121',
  },
  unitPillText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.accessoryBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.borderDivider,
  },
  accessoryDone: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    fontWeight: '700',
    color: C.brandTeal,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});

export default WhenSheetContent;
