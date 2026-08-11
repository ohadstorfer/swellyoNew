// Which currency the traveler sees prices in.
//
// Display only — every charge is in USD regardless of what is picked here, and
// the sheet says so rather than letting anyone assume otherwise.
//
// "Auto" is the default and is a real option, not the absence of one: it tracks
// the country on their profile, so a user who never opens this screen still
// gets sensible prices. The override exists because auto-detection is wrong for
// anyone who has moved, is travelling, or rushed through onboarding — the
// well-documented failure mode of currency auto-detection everywhere.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import {
  currencyForCountry,
  CURRENCY_NAMES,
  CURRENCY_ORDER,
  formatAmount,
  type CurrencyCode,
} from '../../utils/currency';

const C = {
  ink: '#222B30',
  muted: '#7B7B7B',
  line: '#EEEEEE',
  accent: '#05BCD3',
};

export const CurrencySheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** Current stored choice. `null` = Auto. */
  value: CurrencyCode | null;
  /** Profile country, so the Auto row can name what it resolves to. */
  country: string | null | undefined;
  onSelect: (next: CurrencyCode | null) => void;
  /**
   * Copy overrides. The same picker answers two different questions: "what do
   * I read prices in" (the traveler, default copy) and "what do I charge in"
   * (an operator picking a default for new trips). Only the words differ, so
   * they are props rather than a second 140-line component — but the default
   * copy is wrong for an operator and must be replaced, not merely tolerated.
   */
  title?: string;
  subtitle?: string;
  /** The operator's default price currency also allows Auto; kept for clarity. */
  autoLabel?: string;
}> = ({
  visible,
  onClose,
  value,
  country,
  onSelect,
  title = 'Currency',
  subtitle = 'Changes how prices are shown. Payments are always made in US dollars.',
  autoLabel = 'Automatic',
}) => {
  const autoCode = currencyForCountry(country);

  const choose = (next: CurrencyCode | null) => {
    onSelect(next);
    onClose();
  };

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      {/* BottomSheetShell is headless — it owns the backdrop, the slide and the
          swipe, and paints NOTHING. Without this surface the rows render as
          bare text over whatever screen is behind, which is exactly how this
          looked before. Every other sheet in the app carries the same wrapper. */}
      <View style={styles.surface}>
        <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Pressable
          style={styles.row}
          onPress={() => choose(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: value == null }}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{autoLabel}</Text>
            <Text style={styles.rowSub}>{`Follows your profile country — ${autoCode}`}</Text>
          </View>
          {value == null ? <Ionicons name="checkmark" size={20} color={C.accent} /> : null}
        </Pressable>

        <View style={styles.divider} />

        {CURRENCY_ORDER.map(code => (
          <Pressable
            key={code}
            style={styles.row}
            onPress={() => choose(code)}
            accessibilityRole="button"
            accessibilityState={{ selected: value === code }}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{`${CURRENCY_NAMES[code]} · ${code}`}</Text>
              {/* A sample beats a symbol: it shows the format, the separator
                  and where the symbol sits, all in one glance. */}
              <Text style={styles.rowSub}>{formatAmount(1200, code)}</Text>
            </View>
            {value === code ? <Ionicons name="checkmark" size={20} color={C.accent} /> : null}
          </Pressable>
        ))}
        </ScrollView>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // No horizontal padding here — the rows already carry their own 20, and
  // adding it twice would inset every row by 40.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 12,
  },
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  title: {
    fontFamily: ff('Inter', '700'),
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
    color: C.ink,
  },
  sub: {
    marginTop: 4,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: C.muted,
  },
  // Capped so the sheet never grows past a comfortable height on a small
  // phone — 14 currencies plus Auto is more than one screen.
  list: { maxHeight: 420 },
  listContent: { paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 20,
    color: C.ink,
  },
  rowSub: {
    marginTop: 2,
    fontFamily: ff('Inter', '400'),
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 16,
    color: C.muted,
  },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 6, marginHorizontal: 20 },
});
