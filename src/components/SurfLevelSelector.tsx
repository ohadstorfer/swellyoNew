import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../styles/theme';
import { SurfLevelIcon } from './SurfLevelIcon';

interface SurfLevel {
  id: number;
  description: string;
}

interface SurfLevelSelectorProps {
  selectedLevel?: SurfLevel;
  onSelectLevel: (level: SurfLevel) => void;
  error?: string;
}

const surfLevels: SurfLevel[] = [
  {
    id: 0,
    description: 'Dipping My Toes',
  },
  {
    id: 1,
    description: 'Cruising Around',
  },
  {
    id: 2,
    description: 'Snapping',
  },
  {
    id: 3,
    description: 'Charging',
  },
];

// Mapping from numeric ID to string ID for the icon component
const ID_TO_ICON_MAP = {
  0: 'dipping',
  1: 'cruising',
  2: 'snapping',
  3: 'charging',
} as const;

export const SurfLevelSelector: React.FC<SurfLevelSelectorProps> = ({
  selectedLevel,
  onSelectLevel,
  error,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>What is your surf level?</Text>
      
      <View style={styles.grid}>
        {surfLevels.map((level) => (
          <TouchableOpacity
            key={level.id}
            style={[
              styles.levelCard,
              selectedLevel?.id === level.id && styles.selectedCard,
            ]}
            onPress={() => onSelectLevel(level)}
            activeOpacity={0.8}
          >
            <SurfLevelIcon
              level={ID_TO_ICON_MAP[level.id as keyof typeof ID_TO_ICON_MAP]}
              size={60}
              selected={selectedLevel?.id === level.id}
            />
            <Text style={styles.levelTitle}>{level.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
      
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    fontSize: 20,
    color: colors.textDark,
    marginBottom: spacing.md,
    textAlign: 'left',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  levelCard: {
    width: '48%',
    backgroundColor: colors.white,
    borderRadius: borderRadius.medium,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
    ...shadows.small,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedCard: {
    borderColor: colors.primary,
    backgroundColor: colors.backgroundLight,
    ...shadows.medium,
  },
  levelTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textDark,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.body,
    color: '#FF6B6B',
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
}); 