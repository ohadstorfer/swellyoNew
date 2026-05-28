// Horizontal chip scroller of upcoming months with range-tap semantics.
import React, { useMemo } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface MonthChipPickerProps {
  monthFrom: string; // 'YYYY-MM' or ''
  monthTo: string; // 'YYYY-MM' or ''
  monthCount?: number; // default 18
  onChange: (next: { monthFrom: string; monthTo: string }) => void;
}

interface MonthEntry {
  value: string; // 'YYYY-MM'
  shortMonth: string; // 'Aug'
  year: number;
  label: string; // 'Aug' or "Aug '27"
  full: string; // 'August 2027'
}

const FONT_INTER =
  Platform.OS === 'web' ? ('Inter, sans-serif' as const) : ('Inter' as const);
const FONT_MONTSERRAT =
  Platform.OS === 'web'
    ? ('Montserrat, sans-serif' as const)
    : ('Montserrat' as const);

const COLORS = {
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  brandTeal: '#0788B0',
  brandTealMid: '#066b8c',
  brandTealTint: '#E6F4F8',
  brandTealTintBorder: '#9ED1E2',
};

const buildMonths = (count: number): MonthEntry[] => {
  const out: MonthEntry[] = [];
  const now = new Date();
  const thisYear = now.getFullYear();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const shortMonth = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    const label =
      year === thisYear ? shortMonth : `${shortMonth} '${String(year).slice(2)}`;
    const full = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    out.push({ value, shortMonth, year, label, full });
  }
  return out;
};

const fullLabel = (value: string): string => {
  if (!value) return '';
  const [y, m] = value.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

const shortLabel = (value: string): string => {
  if (!value) return '';
  const [y, m] = value.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short' });
};

const formatSummary = (from: string, to: string): string => {
  if (!from && !to) return '';
  if (from && !to) return fullLabel(from);
  if (from && to) {
    const [fy] = from.split('-').map(Number);
    const [ty] = to.split('-').map(Number);
    const startShort = shortLabel(from);
    const endShort = shortLabel(to);
    if (fy === ty) return `${startShort} – ${endShort} ${ty}`;
    return `${startShort} ${fy} – ${endShort} ${ty}`;
  }
  return fullLabel(to);
};

export const MonthChipPicker: React.FC<MonthChipPickerProps> = ({
  monthFrom,
  monthTo,
  monthCount = 18,
  onChange,
}) => {
  const months = useMemo(() => buildMonths(monthCount), [monthCount]);

  const handleTap = (value: string) => {
    // 1st tap → set start, clear end.
    if (!monthFrom) {
      onChange({ monthFrom: value, monthTo: '' });
      return;
    }
    // Start set, end not set.
    if (!monthTo) {
      if (value === monthFrom) {
        onChange({ monthFrom: '', monthTo: '' });
        return;
      }
      if (value < monthFrom) {
        onChange({ monthFrom: value, monthTo: monthFrom });
      } else {
        onChange({ monthFrom, monthTo: value });
      }
      return;
    }
    // Full range already → restart from this month.
    onChange({ monthFrom: value, monthTo: '' });
  };

  const summary = formatSummary(monthFrom, monthTo);
  const helper = 'Tap a month to start your range, then another to end.';

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
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
              activeOpacity={0.7}
              onPress={() => handleTap(m.value)}
              style={[
                styles.chip,
                isMid && styles.chipMid,
                isEndpoint && styles.chipEndpoint,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  isMid && styles.chipTextMid,
                  isEndpoint && styles.chipTextEndpoint,
                ]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={styles.summaryRow}>
        {summary ? (
          <Text style={styles.summary} numberOfLines={1}>
            {summary}
          </Text>
        ) : (
          <Text style={styles.helper} numberOfLines={2}>
            {helper}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingVertical: 4,
    gap: 8,
  },
  chip: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.borderField,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipMid: {
    backgroundColor: COLORS.brandTealTint,
    borderColor: COLORS.brandTealTintBorder,
  },
  chipEndpoint: {
    backgroundColor: COLORS.brandTeal,
    borderColor: COLORS.brandTeal,
  },
  chipText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: COLORS.inkBody,
  },
  chipTextMid: {
    color: COLORS.brandTealMid,
  },
  chipTextEndpoint: {
    color: '#FFFFFF',
  },
  summaryRow: {
    marginTop: 12,
    minHeight: 22,
  },
  summary: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  helper: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
});
