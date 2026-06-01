// Spacy vertical-stack budget tier picker — supersedes BudgetTierCards.tsx.

import React from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../Text';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
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
  derivation?: string;
  onManualOverride?: () => void;
  error?: string;
  /** Currency code shown next to ranges. Defaults to USD. */
  currency?: string;
}

const TIER_ORDER: BudgetTier[] = ['low', 'medium', 'high'];
const TIER_LABEL: Record<BudgetTier, string> = {
  low: 'Budget',
  medium: 'Mid-range',
  high: 'Premium',
};

// Placeholder gradients — Eyal will swap real artwork later.
const TIER_GRADIENT: Record<BudgetTier, [string, string]> = {
  low: ['#E6F4F8', '#C7E8F2'],
  medium: ['#0788B0', '#066b8c'],
  high: ['#212121', '#3a3a3a'],
};

const formatMoney = (n: number): string => {
  if (!Number.isFinite(n)) return '$—';
  return '$' + Math.round(n).toLocaleString('en-US');
};

const formatRange = (r: BudgetTierRange): string => {
  if (r.min === r.max) return formatMoney(r.min);
  return `${formatMoney(r.min)}–${formatMoney(r.max)}`;
};

const showAiInfo = (): void => {
  Alert.alert(
    'How this estimate works',
    'Ranges come from destination, duration, and accommodation type.',
    [{ text: 'OK' }],
  );
};

export const BudgetTierCardsBig: React.FC<BudgetTierCardsBigProps> = ({
  ranges,
  selected,
  onChange,
  derivation,
  onManualOverride,
  error,
  currency = 'USD',
}) => {
  return (
    <View>
      {/* AI estimate badge — tappable */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={showAiInfo}
        accessibilityRole="button"
        accessibilityLabel="AI estimated — tap for details"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={styles.aiBadge}
      >
        <Ionicons name="sparkles-outline" size={14} color={C.brandTeal} />
        <Text style={styles.aiBadgeText}>AI estimated</Text>
        <Ionicons name="information-circle-outline" size={14} color={C.brandTeal} />
      </TouchableOpacity>

      {derivation ? (
        <Text style={styles.derivation}>{derivation}</Text>
      ) : null}

      {/* Stack — vertical with generous gap between cards */}
      <View style={styles.stack}>
        {TIER_ORDER.map(tier => {
          const range = ranges[tier];
          const isSelected = selected === tier;
          const gradient = TIER_GRADIENT[tier];
          const isDarkBg = tier === 'medium' || tier === 'high';

          return (
            <TouchableOpacity
              key={tier}
              activeOpacity={0.92}
              onPress={() => onChange(tier)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${TIER_LABEL[tier]}, ${formatRange(range)} ${currency} per person`}
              style={[styles.card, isSelected && styles.cardSelected]}
            >
              <LinearGradient
                colors={gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />

              {/* "Best for most" pill on the medium card. Stays inside the
                  card top-right with comfortable inset to avoid clipping. */}
              {tier === 'medium' ? (
                <View style={styles.popularBadge}>
                  <Ionicons name="star" size={11} color="#FFFFFF" />
                  <Text style={styles.popularBadgeText}>BEST FOR MOST</Text>
                </View>
              ) : null}

              {/* Selected check icon top-right */}
              {isSelected ? (
                <View style={styles.checkBadge}>
                  <Ionicons
                    name="checkmark-circle"
                    size={28}
                    color={C.brandTeal}
                  />
                </View>
              ) : null}

              {/* White overlay panel so text reads on any background */}
              <View
                style={[
                  styles.panel,
                  isDarkBg ? styles.panelOnDark : styles.panelOnLight,
                ]}
              >
                <Text style={styles.tierName}>{TIER_LABEL[tier]}</Text>
                <Text style={styles.tierRange}>{formatRange(range)}</Text>
                <Text style={styles.tierCurrency}>{currency} · per person</Text>
                {range.label ? (
                  <Text style={styles.tierExtra}>{range.label}</Text>
                ) : null}
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
          <Text style={styles.manualLink}>Adjust manually →</Text>
        </TouchableOpacity>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

export default BudgetTierCardsBig;

const styles = StyleSheet.create({
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: C.brandTealTint,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  aiBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '700',
    color: C.brandTealText,
  },
  derivation: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: C.textMuted,
  },
  stack: {
    marginTop: 16,
    gap: 16,
  },
  card: {
    height: 160,
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardSelected: {
    borderColor: C.brandTeal,
    borderWidth: 3,
  },
  checkBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: C.surface,
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  // "Best for most" pill — anchored top-left so it doesn't conflict with the
  // selection check on the top-right.
  popularBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.inkDark,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  popularBadgeText: {
    fontFamily: FONT_INTER,
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  panel: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  panelOnLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  panelOnDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
  },
  tierName: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    fontWeight: '700',
    color: C.inkBody,
    marginBottom: 2,
  },
  tierRange: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
    color: C.inkDark,
  },
  tierCurrency: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '400',
    color: C.textMuted,
  },
  tierExtra: {
    marginTop: 6,
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: C.textMuted,
  },
  manualLinkBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  manualLink: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: C.brandTeal,
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
