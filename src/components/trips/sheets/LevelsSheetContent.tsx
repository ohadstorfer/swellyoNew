// LevelsSheetContent — multi-select stacked level cards (Beginner /
// Intermediate / Advanced). Mirrors the Board Style sheet's "floating card"
// treatment: outer shadow wrap + inner overflow-clipped surface so the
// shadow can actually render on iOS (overflow:hidden + shadow on the same
// View kills the shadow).
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SurfLevel } from '../../../services/trips/groupTripsService';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  surfaceCard: '#FFFFFF',
};

type LevelKey = Extract<SurfLevel, 'beginner' | 'intermediate' | 'advanced'>;

interface LevelMeta {
  key: LevelKey;
  title: string;
  desc: string;
  // Hue that runs as a vertical stripe on the card's left edge so the three
  // levels read as a progression (light → mid → dark teal).
  stripe: string;
}

const LEVELS: readonly LevelMeta[] = [
  {
    key: 'beginner',
    title: 'Beginner',
    desc: 'Just getting started - paddling, popping up, white water.',
    stripe: '#A8DCEB', // light teal
  },
  {
    key: 'intermediate',
    title: 'Intermediate',
    desc: 'Comfortable on green waves, working on turns.',
    stripe: '#0788B0', // brand teal
  },
  {
    key: 'advanced',
    title: 'Advanced',
    desc: 'Confident in bigger sets, charging unfamiliar breaks.',
    stripe: '#055A75', // dark teal
  },
];

export interface LevelsSheetContentProps {
  selected: SurfLevel[];
  onChange: (next: SurfLevel[]) => void;
}

export const LevelsSheetContent: React.FC<LevelsSheetContentProps> = ({
  selected,
  onChange,
}) => {
  const toggle = useCallback(
    (key: LevelKey) => {
      const isSelected = selected.includes(key);
      const next = isSelected
        ? selected.filter(s => s !== key)
        : [...selected, key];
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <View style={styles.stack}>
      {LEVELS.map(level => {
        const isSelected = selected.includes(level.key);
        return (
          <TouchableOpacity
            key={level.key}
            activeOpacity={0.85}
            onPress={() => toggle(level.key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={level.title}
            // Outer wrap carries the shadow (no overflow clipping here so it
            // actually renders on iOS).
            style={styles.shadowWrap}
          >
            <View
              style={[
                styles.cardInner,
                isSelected && styles.cardInnerSelected,
              ]}
            >
              {/* Vertical stripe — edge-to-edge of the inner card. */}
              <View
                style={[styles.stripe, { backgroundColor: level.stripe }]}
              />

              <View style={styles.cardBody}>
                <Text
                  style={[styles.title, isSelected && styles.titleSelected]}
                >
                  {level.title}
                </Text>
                <Text style={styles.desc}>{level.desc}</Text>
              </View>

              {isSelected ? (
                <View style={styles.checkBadge}>
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={C.brandTeal}
                  />
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: 16,
  },
  // OUTER — carries the float shadow. No overflow:hidden, no border-radius
  // clipping logic so the iOS layer compositor can render the shadow on all
  // four sides of the card.
  shadowWrap: {
    backgroundColor: C.surfaceCard,
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 5,
  },
  // INNER — same radius, overflow:hidden so the stripe rounds at the corners.
  // No border placeholder anymore: the 2pt transparent border that lit up
  // teal on selected was pushing the stripe 2pt off the edge. Selected state
  // is now communicated by the checkmark badge alone (still visually clear).
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    overflow: 'hidden',
    paddingLeft: 36, // 22pt stripe + 14pt gap
    paddingRight: 18,
    minHeight: 132,
    position: 'relative',
    backgroundColor: C.surfaceCard,
  },
  cardInnerSelected: {
    // Selected state — no border (would offset the stripe). The checkmark
    // badge handles the visual cue.
  },
  // Stripe — absolutely positioned, edge-to-edge of the card (top, bottom,
  // left). Zero gap on any of those three sides. Width pulled in further so
  // it reads as a distinct color block, not a hairline.
  stripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 22,
  },
  cardBody: {
    flex: 1,
    gap: 4,
    paddingVertical: 22,
    // Leave room on the right so long titles don't crash into the check badge.
    paddingRight: 30,
  },
  title: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: C.inkBody,
  },
  titleSelected: {
    color: C.brandTealText,
  },
  desc: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  // Absolutely-positioned checkmark badge (top-right).
  checkBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
});

export default LevelsSheetContent;
