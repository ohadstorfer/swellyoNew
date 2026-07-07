import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FALLBACK_USD_TO_ILS, usdToIls } from '../../utils/currency';

// --------------------------------------------------------------------------
// BudgetTierCards — 3-card tier picker for the budget step.
//
// Spec refs:
//   • docs/create-trip-redesign-spec.md §4.4.1 (Step 4 — Budget tiers)
//   • docs/create-trip-redesign-spec.md §7.7 (component signature)
//   • docs/component-ux-research.md §12 (tier picker survey)
//
// Mid-range card is the visual anchor: slightly taller + "Best for most" badge.
// On narrow screens (< 380dp) the row falls back to a vertical stack so each
// card keeps a readable USD range font size.
//
// Tokens straight from spec §2 — do NOT import theme.ts.
// --------------------------------------------------------------------------

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

// Design tokens (spec §2)
const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

export type BudgetTier = 'low' | 'medium' | 'high';

export interface BudgetTierRange {
  min: number;
  max: number;
  /** Optional secondary label rendered below the price range. */
  label?: string;
}

export interface BudgetTierCardsProps {
  /**
   * USD ranges keyed by tier. When omitted, the component renders nothing —
   * the parent will fall through to manual min/max inputs (spec §4.4.2).
   */
  ranges?: Record<BudgetTier, BudgetTierRange>;
  selected: BudgetTier | null;
  onChange: (tier: BudgetTier) => void;
  /** Single line under the cards. Example: "Based on Canggu, 10 days, villa". */
  derivation?: string;
  /** Inline error rendered below the cards. */
  error?: string;
  /**
   * Tapping the "Adjust manually" link calls this if provided. Stream E will
   * use it to reveal the manual min/max inputs sitting in the parent.
   */
  onManualOverride?: () => void;
  /** Currency shown next to ranges. Israeli operators see ₪ (converted via fxRate); defaults to USD. */
  currency?: 'ILS' | 'USD';
  /** USD -> ILS rate, used only when currency === 'ILS'. Defaults to FALLBACK_USD_TO_ILS. */
  fxRate?: number;
}

const TIER_ORDER: BudgetTier[] = ['low', 'medium', 'high'];
const TIER_LABEL: Record<BudgetTier, string> = {
  low: 'Budget',
  medium: 'Mid-range',
  high: 'Premium',
};

const showAiInfo = (): void => {
  Alert.alert(
    'How this works',
    'Estimate based on destination, duration, and accommodation type. You can adjust manually below.',
    [{ text: 'OK' }],
  );
};

export const BudgetTierCards: React.FC<BudgetTierCardsProps> = ({
  ranges,
  selected,
  onChange,
  derivation,
  error,
  onManualOverride,
  currency = 'USD',
  fxRate,
}) => {
  const { width } = useWindowDimensions();
  // Stack vertically on narrow screens so the USD range stays readable.
  const stacked = width < 380;

  const [pressedTier, setPressedTier] = useState<BudgetTier | null>(null);

  const formatMoney = (usd: number): string => {
    if (!Number.isFinite(usd)) return currency === 'ILS' ? '₪—' : '$—';
    if (currency === 'ILS') {
      return '₪' + usdToIls(usd, fxRate ?? FALLBACK_USD_TO_ILS).toLocaleString('en-US');
    }
    return '$' + Math.round(usd).toLocaleString('en-US');
  };

  const formatRange = (r: BudgetTierRange): string => {
    if (r.min === r.max) return `${formatMoney(r.min)} ${currency}`;
    return `${formatMoney(r.min)} – ${formatMoney(r.max)}`;
  };

  useEffect(() => {
    // Reset transient press state if the ranges object changes.
    setPressedTier(null);
  }, [ranges]);

  if (!ranges) return null;

  return (
    <View>
      {/* AI estimate badge — sits above the row, right-aligned */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={showAiInfo}
          accessibilityRole="button"
          accessibilityLabel="AI estimate — tap for details"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.aiBadge}
        >
          <Ionicons name="sparkles-outline" size={12} color={C.brandTeal} />
          <Text style={styles.aiBadgeText}>AI estimate</Text>
          <Ionicons name="information-circle-outline" size={12} color={C.brandTeal} />
        </TouchableOpacity>
      </View>

      <View style={[styles.row, stacked && styles.rowStacked]}>
        {TIER_ORDER.map(tier => {
          const range = ranges[tier];
          const isSelected = selected === tier;
          const isAnchor = tier === 'medium';
          const isPressed = pressedTier === tier;
          return (
            <TouchableOpacity
              key={tier}
              activeOpacity={0.9}
              onPress={() => onChange(tier)}
              onPressIn={() => setPressedTier(tier)}
              onPressOut={() => setPressedTier(prev => (prev === tier ? null : prev))}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${TIER_LABEL[tier]}, ${formatRange(range)} per person`}
              style={[
                styles.card,
                stacked ? styles.cardStacked : styles.cardRow,
                isAnchor && !stacked && styles.cardAnchor,
                isSelected && styles.cardSelected,
                isPressed && !isSelected && styles.cardPressed,
              ]}
            >
              {isAnchor ? (
                <View style={styles.anchorBadge}>
                  <Text style={styles.anchorBadgeText}>Best for most</Text>
                </View>
              ) : null}

              <Text
                style={[styles.tierName, isSelected && styles.tierNameSelected]}
              >
                {TIER_LABEL[tier]}
              </Text>
              <Text style={styles.tierRange}>{formatRange(range)}</Text>
              <Text style={styles.tierUnit}>per person</Text>
              {range.label ? (
                <Text style={styles.tierExtra}>{range.label}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {derivation ? (
        <Text style={styles.derivation}>{derivation}</Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {onManualOverride ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onManualOverride}
          accessibilityRole="button"
          accessibilityLabel="Adjust the range yourself"
          style={styles.manualLinkBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.manualLink}>Adjust the range yourself →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.brandTealTint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  aiBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '600',
    color: C.brandTealText,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 8,
  },
  rowStacked: {
    flexDirection: 'column',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderField,
    backgroundColor: C.surfaceCard,
    padding: 14,
  },
  cardRow: {
    flex: 1,
  },
  cardStacked: {
    width: '100%',
  },
  cardAnchor: {
    // Mid-range gets slightly more visual weight in the row layout.
    flexGrow: 1.05,
    padding: 16,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: C.brandTeal,
    backgroundColor: C.brandTealTint,
  },
  cardPressed: {
    opacity: 0.92,
  },
  anchorBadge: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    backgroundColor: C.brandTeal,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  anchorBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tierName: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: C.inkBody,
    marginBottom: 4,
  },
  tierNameSelected: {
    color: C.brandTealText,
  },
  tierRange: {
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: C.inkDark,
  },
  tierUnit: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '400',
    color: C.textMuted,
  },
  tierExtra: {
    marginTop: 6,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    color: C.textMuted,
  },
  derivation: {
    marginTop: 16,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: C.textMuted,
  },
  manualLinkBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  manualLink: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '600',
    color: C.brandTeal,
  },
  error: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    color: C.errorText,
  },
});

export default BudgetTierCards;
