// Budget tier picker — Figma node 12541:3162. Three row cards (checkbox · plan ·
// price), an "Estimated by AI" pill, and "Based on:" chips. Reuses the white
// floating-card + circular-checkbox language from AudienceCard / SheetOptionCard.

import React from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../Text';
import { FALLBACK_USD_TO_ILS, usdToIlsDisplay } from '../../utils/currency';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  accent: '#05BCD3', // brand cyan — selection + checkbox
  aiGradStart: '#FF5367', // "Estimated by AI" gradient border — accent/100 (pink)
  aiGradEnd: '#B72DF2', //   → accent/200 (purple)
  inkDark: '#212121',
  inkBody: '#333333',
  textMuted: '#7B7B7B',
  borderHairline: '#EEEEEE',
  checkboxOffBg: '#F7F7F7',
  checkboxOffBorder: '#CFCFCF',
  chipBg: '#EEEEEE',
  surface: '#FFFFFF',
  errorText: '#C0392B',
};

export type BudgetTier = 'low' | 'medium' | 'high';

export interface BudgetTierRange {
  min: number;
  max: number;
  label?: string;
}

export interface BudgetTierCardsBigProps {
  ranges: Record<BudgetTier, BudgetTierRange>;
  selected: BudgetTier | null;
  onChange: (tier: BudgetTier) => void;
  /** Chips rendered after "Based on:" (e.g. ['Bali', '10 days', 'bungalow']). */
  basedOnTags?: string[];
  /** Fallback single-line derivation if no tags are passed. */
  derivation?: string;
  onManualOverride?: () => void;
  error?: string;
  /** Israeli operators see ₪ (converted via fxRate); everyone else sees $. Defaults to USD. */
  currency?: 'ILS' | 'USD';
  /** USD -> ILS rate, used only when currency === 'ILS'. Defaults to FALLBACK_USD_TO_ILS. */
  fxRate?: number;
}

const TIER_ORDER: BudgetTier[] = ['low', 'medium', 'high'];
const TIER_LABEL: Record<BudgetTier, string> = {
  low: 'Basic',
  medium: 'Balanced',
  high: 'Premium',
};
const CARD_SUBTITLE = 'Accommodation & Meals';

const showAiInfo = (): void => {
  Alert.alert(
    'How this estimate works',
    'Ranges come from your destination, trip length, and accommodation type.',
    [{ text: 'OK' }],
  );
};

export const BudgetTierCardsBig: React.FC<BudgetTierCardsBigProps> = ({
  ranges,
  selected,
  onChange,
  basedOnTags,
  derivation,
  onManualOverride,
  error,
  currency,
  fxRate,
}) => {
  const formatMoney = (usd: number): string => {
    if (!Number.isFinite(usd)) return '-';
    if (currency === 'ILS') {
      return '₪' + usdToIlsDisplay(usd, fxRate ?? FALLBACK_USD_TO_ILS).toLocaleString('en-US');
    }
    return '$' + Math.round(usd).toLocaleString('en-US');
  };

  const formatRange = (r: BudgetTierRange): string => {
    if (r.min === r.max) return formatMoney(r.min);
    return `${formatMoney(r.min)} - ${formatMoney(r.max)}`;
  };

  return (
    <View>
      {/* Estimated by AI pill — pink→purple gradient border */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={showAiInfo}
        accessibilityRole="button"
        accessibilityLabel="Estimated by AI — tap for details"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={styles.aiPillWrap}
      >
        <LinearGradient
          colors={[C.aiGradStart, C.aiGradEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.aiPillGradient}
        >
          <View style={styles.aiPillInner}>
            <Ionicons name="sparkles" size={15} color={C.inkBody} />
            <Text style={styles.aiPillText}>Estimated by AI</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>

      {/* Based on: + chips */}
      {basedOnTags && basedOnTags.length > 0 ? (
        <View style={styles.basedOnRow}>
          <Text style={styles.basedOnLabel}>Based on:</Text>
          <View style={styles.chipsRow}>
            {basedOnTags.map((t, i) => (
              <View key={`${t}-${i}`} style={styles.chip}>
                <Text style={styles.chipText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : derivation ? (
        <Text style={styles.derivation}>{derivation}</Text>
      ) : null}

      {/* Card stack */}
      <View style={styles.stack}>
        {TIER_ORDER.map(tier => {
          const range = ranges[tier];
          const isSelected = selected === tier;
          const isBest = tier === 'medium';

          return (
            <TouchableOpacity
              key={tier}
              activeOpacity={0.85}
              onPress={() => onChange(tier)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${TIER_LABEL[tier]}, ${formatRange(range)} per person`}
              style={[styles.card, isSelected && styles.cardSelected]}
            >
              {isBest ? (
                <View style={styles.bestBadge}>
                  <Ionicons name="star" size={11} color="#FFFFFF" />
                  <Text style={styles.bestBadgeText}>BEST FOR MOST</Text>
                </View>
              ) : null}

              <View
                style={[
                  styles.checkbox,
                  isSelected ? styles.checkboxOn : styles.checkboxOff,
                ]}
              >
                {isSelected ? (
                  <MaterialCommunityIcons name="check-bold" size={13} color="#FFFFFF" />
                ) : null}
              </View>

              <View style={styles.planInfo}>
                <Text style={styles.planTitle}>{TIER_LABEL[tier]}</Text>
                <Text style={styles.planSub}>{range.label ?? CARD_SUBTITLE}</Text>
              </View>

              <View style={styles.planPrice}>
                <Text style={styles.priceText}>{formatRange(range)}</Text>
                <Text style={styles.perPerson}>Per person</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {onManualOverride ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onManualOverride}
          accessibilityRole="button"
          accessibilityLabel="Adjust manually"
          style={styles.manualLinkBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.manualLink}>Adjust manually</Text>
        </TouchableOpacity>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

export default BudgetTierCardsBig;

const styles = StyleSheet.create({
  // Gradient "border" = gradient fill with a 1.5px pad and a white inner.
  aiPillWrap: {
    alignSelf: 'flex-start',
  },
  aiPillGradient: {
    borderRadius: 9,
    padding: 1.5,
  },
  aiPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    borderRadius: 7.5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  aiPillText: {
    fontFamily: FONT_INTER,
    fontSize: 15,
    fontWeight: '700',
    color: C.inkBody,
  },
  basedOnRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  basedOnLabel: {
    fontFamily: FONT_INTER,
    fontSize: 17,
    fontWeight: '700',
    color: C.inkBody,
  },
  chipsRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    backgroundColor: C.chipBg,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: C.inkBody,
  },
  derivation: {
    marginTop: 10,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: C.textMuted,
  },
  stack: {
    marginTop: 24,
    gap: 26,
  },
  // Floating row card — Box Shadow 01 (same as AudienceCard).
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 30,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: C.surface,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cardSelected: {
    borderColor: C.accent,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: C.accent,
  },
  checkboxOff: {
    backgroundColor: C.checkboxOffBg,
    borderWidth: 1,
    borderColor: C.checkboxOffBorder,
  },
  planInfo: {
    flex: 1,
    gap: 4,
  },
  planTitle: {
    fontFamily: FONT_INTER,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    color: C.inkBody,
  },
  planSub: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  planPrice: {
    alignItems: 'flex-end',
    gap: 4,
  },
  priceText: {
    fontFamily: FONT_INTER,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    color: C.inkBody,
  },
  perPerson: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  // Black "BEST FOR MOST" pill overlapping the card's top edge.
  bestBadge: {
    position: 'absolute',
    top: -11,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.inkDark,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    zIndex: 2,
  },
  bestBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  manualLinkBtn: {
    marginTop: 18,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  manualLink: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: C.accent,
  },
  error: {
    marginTop: 10,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    color: C.errorText,
    textAlign: 'center',
  },
});
