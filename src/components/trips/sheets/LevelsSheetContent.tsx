// LevelsSheetContent — multi-select stacked level cards (Beginner/Intermediate/Advanced) for the create-trip wizard sheet.
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
  brandTealTint: '#E6F4F8',
  brandTealText: '#066b8c',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderDivider: '#E0E0E0',
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
  icon: keyof typeof Ionicons.glyphMap;
}

const LEVELS: readonly LevelMeta[] = [
  {
    key: 'beginner',
    title: 'Beginner',
    desc: 'Just getting started — paddling, popping up, white water.',
    stripe: '#A8DCEB', // light teal
    icon: 'leaf-outline',
  },
  {
    key: 'intermediate',
    title: 'Intermediate',
    desc: 'Comfortable on green waves, working on turns.',
    stripe: '#0788B0', // brand teal
    icon: 'flash-outline',
  },
  {
    key: 'advanced',
    title: 'Advanced',
    desc: 'Confident in bigger sets, charging unfamiliar breaks.',
    stripe: '#055A75', // dark teal
    icon: 'flame-outline',
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
            style={[styles.card, isSelected && styles.cardSelected]}
          >
            {/* Vertical stripe on the left edge — encodes level progression. */}
            <View
              style={[styles.stripe, { backgroundColor: level.stripe }]}
            />

            <View
              style={[
                styles.iconWrap,
                { backgroundColor: isSelected ? C.surfaceCard : C.brandTealTint },
              ]}
            >
              <Ionicons name={level.icon} size={22} color={level.stripe} />
            </View>

            <View style={styles.cardBody}>
              <Text
                style={[styles.title, isSelected && styles.titleSelected]}
              >
                {level.title}
              </Text>
              <Text style={styles.desc}>{level.desc}</Text>
            </View>

            {isSelected ? (
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={C.brandTeal}
                style={styles.check}
              />
            ) : (
              <View style={styles.checkPlaceholder} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.borderDivider,
    borderRadius: 14,
    backgroundColor: C.surfaceCard,
    overflow: 'hidden',
    paddingVertical: 12,
    paddingRight: 14,
    minHeight: 76,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: C.brandTeal,
    backgroundColor: C.brandTealTint,
  },
  stripe: {
    width: 6,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardBody: {
    flex: 1,
    gap: 2,
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
  check: {
    marginLeft: 8,
  },
  checkPlaceholder: {
    width: 22,
    height: 22,
    marginLeft: 8,
  },
});

export default LevelsSheetContent;
