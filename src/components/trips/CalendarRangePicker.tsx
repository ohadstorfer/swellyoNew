// Range calendar with month nav, brand-teal endpoints, and a teal-tint range rail.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CalendarRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  minDate?: Date;
  onChange: (range: { startDate: Date | null; endDate: Date | null }) => void;
  placeholder?: string;
  // When true, disable navigating to months before the current month.
  clampPastMonths?: boolean;
  // When true, the calendar grid is always visible — the tap-to-toggle
  // summary field is not rendered. Use this inside contexts that have already
  // opened the calendar (e.g. the When? bottom sheet).
  alwaysOpen?: boolean;
}

const FONT_INTER =
  Platform.OS === 'web' ? ('Inter, sans-serif' as const) : ('Inter' as const);
const FONT_MONTSERRAT =
  Platform.OS === 'web'
    ? ('Montserrat, sans-serif' as const)
    : ('Montserrat' as const);

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const startOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const isBetween = (d: Date, start: Date, end: Date) => {
  const t = startOfDay(d).getTime();
  return t > startOfDay(start).getTime() && t < startOfDay(end).getTime();
};
const formatRangeSummary = (start: Date | null, end: Date | null): string => {
  if (!start) return '';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startFmt = start.toLocaleDateString('en-US', opts);
  if (!end) return startFmt;
  const endFmt = end.toLocaleDateString('en-US', opts);
  const days =
    Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000) + 1;
  return `${startFmt} – ${endFmt}${days > 0 ? ` · ${days} ${days === 1 ? 'day' : 'days'}` : ''}`;
};
const monthLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export const CalendarRangePicker: React.FC<CalendarRangePickerProps> = ({
  startDate,
  endDate,
  minDate,
  onChange,
  placeholder = 'Pick dates',
  clampPastMonths = false,
  alwaysOpen = false,
}) => {
  const [open, setOpen] = useState(alwaysOpen);
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    startOfMonth(startDate ?? new Date())
  );

  const effectiveMinDate = minDate
    ? minDate
    : clampPastMonths
      ? startOfMonth(new Date())
      : null;
  const min = effectiveMinDate ? startOfDay(effectiveMinDate) : null;
  const minMonth = clampPastMonths ? startOfMonth(new Date()) : null;
  const isAtMinMonth =
    !!minMonth && viewMonth.getTime() <= minMonth.getTime();

  const handleDayTap = (day: Date) => {
    if (min && startOfDay(day).getTime() < min.getTime()) return;
    // No selection yet, or full range already → start fresh from this day.
    if (!startDate || (startDate && endDate)) {
      onChange({ startDate: day, endDate: null });
      return;
    }
    // Start set, end not yet.
    if (sameDay(day, startDate)) {
      onChange({ startDate: null, endDate: null });
      return;
    }
    if (startOfDay(day).getTime() < startOfDay(startDate).getTime()) {
      onChange({ startDate: day, endDate: startDate });
    } else {
      onChange({ startDate, endDate: day });
    }
  };

  // Build the grid one full week (7 cells) at a time so cells share a flex row
  // and align cleanly without sub-pixel gaps from percentage widths.
  const rows = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const dow = first.getDay();
    const total = daysInMonth(viewMonth);
    const cells: (Date | null)[] = [];
    for (let i = 0; i < dow; i++) cells.push(null);
    for (let d = 1; d <= total; d++) {
      cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [viewMonth]);

  const summary = formatRangeSummary(startDate, endDate);

  return (
    <View>
      {!alwaysOpen && (
        <TouchableOpacity
          style={styles.field}
          onPress={() => setOpen(!open)}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar-outline" size={18} color="#0788B0" />
          <Text style={[styles.fieldText, !summary && styles.fieldPlaceholder]} numberOfLines={1}>
            {summary || placeholder}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#7B7B7B" />
        </TouchableOpacity>
      )}

      {open && (
        <View style={styles.calendar}>
          <View style={styles.monthRow}>
            <TouchableOpacity
              onPress={() => setViewMonth(addMonths(viewMonth, -1))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.navBtn, isAtMinMonth && styles.navBtnDisabled]}
              disabled={isAtMinMonth}
            >
              <Ionicons name="chevron-back" size={22} color="#222B30" />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel(viewMonth)}</Text>
            <TouchableOpacity
              onPress={() => setViewMonth(addMonths(viewMonth, 1))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.navBtn}
            >
              <Ionicons name="chevron-forward" size={22} color="#222B30" />
            </TouchableOpacity>
          </View>

          <View style={styles.dowRow}>
            {DAY_LABELS.map((d, i) => (
              <Text key={i} style={styles.dowLabel}>
                {d}
              </Text>
            ))}
          </View>

          {rows.map((row, ri) => (
            <View key={ri} style={styles.gridRow}>
              {row.map((day, ci) => {
                if (!day) {
                  return <View key={ci} style={styles.cell} />;
                }
                const disabled = !!min && startOfDay(day).getTime() < min.getTime();
                const isStart = !!startDate && sameDay(day, startDate);
                const isEnd = !!endDate && sameDay(day, endDate);
                const isMid =
                  !!startDate && !!endDate && isBetween(day, startDate, endDate);
                const isEndpoint = isStart || isEnd;
                const isRangeStartCell = isStart && !!endDate;
                const isRangeEndCell = isEnd && !!startDate;
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[
                      styles.cell,
                      isMid && styles.cellRail,
                      isRangeStartCell && [styles.cellRail, styles.cellRailStartCap],
                      isRangeEndCell && [styles.cellRail, styles.cellRailEndCap],
                    ]}
                    onPress={() => handleDayTap(day)}
                    disabled={disabled}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.cellInner,
                        isEndpoint && styles.cellEndpointInner,
                      ]}
                    >
                      <Text
                        style={[
                          styles.cellText,
                          disabled && styles.cellTextDisabled,
                          isMid && styles.cellTextMid,
                          isEndpoint && styles.cellTextEndpoint,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    gap: 10,
    minHeight: 52,
  },
  fieldText: {
    flex: 1,
    fontSize: 15,
    color: '#222B30',
    fontWeight: '500',
    fontFamily: FONT_INTER,
  },
  fieldPlaceholder: { color: '#B0B0B0', fontWeight: '400' },

  calendar: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  navBtnDisabled: { opacity: 0.3 },
  monthLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: '#222B30',
    fontFamily: FONT_MONTSERRAT,
  },

  dowRow: { flexDirection: 'row' },
  dowLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#7B7B7B',
    letterSpacing: 0.5,
    paddingBottom: 8,
    fontFamily: FONT_INTER,
    textTransform: 'uppercase',
  },

  gridRow: { flexDirection: 'row' },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Range rail behind in-range and endpoint cells. The endpoint cells get caps
  // (rounded corners on the outer side) so the rail looks like a continuous pill.
  cellRail: { backgroundColor: '#E6F4F8' },
  cellRailStartCap: { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  cellRailEndCap: { borderTopRightRadius: 999, borderBottomRightRadius: 999 },

  cellInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEndpointInner: { backgroundColor: '#0788B0' },

  cellText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#222B30',
    fontFamily: FONT_INTER,
  },
  cellTextMid: { color: '#066b8c', fontWeight: '600' },
  cellTextEndpoint: { color: '#FFF', fontWeight: '700' },
  cellTextDisabled: { color: '#D0D0D0' },
});
