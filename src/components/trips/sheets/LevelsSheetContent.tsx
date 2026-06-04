// LevelsSheetContent — multi-select surf-level option cards (Beginner /
// Intermediate / Advanced). Matches Figma node 12492:2983: photo thumbnail +
// title + description + checkbox, cyan border when selected.
import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import type { SurfLevel } from '../../../services/trips/groupTripsService';
import { SheetOptionCard } from './SheetOptionCard';
import { Images } from '../../../assets/images';

type LevelKey = Extract<SurfLevel, 'beginner' | 'intermediate' | 'advanced'>;

interface LevelMeta {
  key: LevelKey;
  title: string;
  desc: string;
  image: any;
  imageZoom?: number;
}

const LEVELS: readonly LevelMeta[] = [
  {
    key: 'beginner',
    title: 'Beginner',
    desc: 'Just getting started - paddling, popping up, white water.',
    image: Images.levels.beginner,
  },
  {
    key: 'intermediate',
    title: 'Intermediate',
    desc: 'Comfortable on green waves, working on turns.',
    image: Images.levels.intermediate,
  },
  {
    key: 'advanced',
    title: 'Advanced',
    desc: 'Confident in bigger sets, charging unfamiliar breaks.',
    image: Images.levels.advanced,
    imageZoom: 1.2,
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
      const next = selected.includes(key)
        ? selected.filter(s => s !== key)
        : [...selected, key];
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <View style={styles.stack}>
      {LEVELS.map(level => (
        <SheetOptionCard
          key={level.key}
          title={level.title}
          description={level.desc}
          image={level.image}
          imageZoom={level.imageZoom}
          selected={selected.includes(level.key)}
          onPress={() => toggle(level.key)}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: 16,
    marginHorizontal: 8,
  },
});

export default LevelsSheetContent;
