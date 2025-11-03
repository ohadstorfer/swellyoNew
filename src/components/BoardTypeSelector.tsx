import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../styles/theme';
import { SurfLevelIcon } from './SurfLevelIcon';

interface BoardType {
  id: number;
  description: string;
}

interface BoardTypeSelectorProps {
  selectedType?: BoardType;
  onSelectType: (type: BoardType) => void;
  error?: string;
}

const boardTypes: BoardType[] = [
  {
    id: 0,
    description: 'Shortboard',
  },
  {
    id: 1,
    description: 'Mid-length',
  },
  {
    id: 2,
    description: 'Longboard',
  },
  {
    id: 3,
    description: 'Soft Top',
  },
];

// Mapping from numeric ID to string ID for the icon component
// We'll reuse the surf level icons for now, but you can create board-specific icons later
const ID_TO_ICON_MAP = {
  0: 'dipping',    // Shortboard - beginner friendly
  1: 'cruising',   // Mid-length - intermediate
  2: 'snapping',   // Longboard - advanced
  3: 'charging',   // Soft Top - expert
} as const;

export const BoardTypeSelector: React.FC<BoardTypeSelectorProps> = ({
  selectedType,
  onSelectType,
  error,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>What type of board do you prefer?</Text>
      
      <View style={styles.grid}>
        {boardTypes.map((type) => (
          <TouchableOpacity
            key={type.id}
            style={[
              styles.typeCard,
              selectedType?.id === type.id && styles.selectedCard,
            ]}
            onPress={() => onSelectType(type)}
            activeOpacity={0.8}
          >
            <SurfLevelIcon
              level={ID_TO_ICON_MAP[type.id as keyof typeof ID_TO_ICON_MAP]}
              size={60}
              selected={selectedType?.id === type.id}
            />
            <Text style={styles.typeTitle}>{type.description}</Text>
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
  typeCard: {
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
  typeTitle: {
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
