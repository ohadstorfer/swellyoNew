// StyleSheetContent — multi-select board-type option cards (Soft-Top /
// Shortboard / Mid-Length / Longboard). Matches Figma node 12492:11690: board
// render + title + description + checkbox, cyan border when selected.
import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import type { SurfStyle } from '../../../services/trips/groupTripsService';
import { SheetOptionCard } from './SheetOptionCard';
import { Images } from '../../../assets/images';

type StyleKey = Extract<
  SurfStyle,
  'shortboard' | 'midlength' | 'softtop' | 'longboard'
>;

interface StyleMeta {
  key: StyleKey;
  label: string;
  desc: string;
  image: any;
}

const STYLES: readonly StyleMeta[] = [
  {
    key: 'softtop',
    label: 'Soft-Top',
    desc: 'Foamy and forgiving — easy paddling, stable take-offs.',
    image: Images.boardsEven.softtop,
  },
  {
    key: 'shortboard',
    label: 'Shortboard',
    desc: 'Quick and responsive for steeper, punchier waves.',
    image: Images.boardsEven.shortboard,
  },
  {
    key: 'midlength',
    label: 'Mid-Length',
    desc: 'Versatile glider — speed and maneuverability in one.',
    image: Images.boardsEven.midlength,
  },
  {
    key: 'longboard',
    label: 'Longboard',
    desc: 'Classic logging — smooth trim and noserides on mellow waves.',
    image: Images.boardsEven.longboard,
  },
];

export interface StyleSheetContentProps {
  selected: SurfStyle[];
  onChange: (next: SurfStyle[]) => void;
}

export const StyleSheetContent: React.FC<StyleSheetContentProps> = ({
  selected,
  onChange,
}) => {
  const toggle = useCallback(
    (key: StyleKey) => {
      const next = selected.includes(key)
        ? selected.filter(s => s !== key)
        : [...selected, key];
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <View style={styles.stack}>
      {STYLES.map(style => (
        <SheetOptionCard
          key={style.key}
          title={style.label}
          description={style.desc}
          image={style.image}
          selected={selected.includes(style.key)}
          onPress={() => toggle(style.key)}
          imageResizeMode="contain"
          imageBackground={false}
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

export default StyleSheetContent;
