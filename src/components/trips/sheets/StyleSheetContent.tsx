// StyleSheetContent — multi-select board-type option cards (Soft-Top /
// Shortboard / Mid-Length / Longboard). Matches Figma node 12492:11690: board
// render + title + description + checkbox, cyan border when selected.
import React, { useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SurfStyle } from '../../../services/trips/groupTripsService';
import { SheetOptionCard } from './SheetOptionCard';
import { Images } from '../../../assets/images';

const GAP = 16; // vertical gap between cards (styles.stack)
const NATURAL_CARD_H = 112; // SheetOptionCard's natural minHeight

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
    desc: 'Foamy and forgiving - easy paddling, stable take-offs.',
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
    desc: 'Versatile glider - speed and maneuverability in one.',
    image: Images.boardsEven.midlength,
  },
  {
    key: 'longboard',
    label: 'Longboard',
    desc: 'Classic logging - smooth trim and noserides on mellow waves.',
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

  // Android-only: on short screens the 4 full-size cards overflow the sheet and
  // force a scroll. Shrink them to share the height the boards step's
  // WizardBottomSheet actually gives the list, so all 4 fit without scrolling.
  // iOS / tall screens fall through to undefined → the natural 112 design.
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardHeight = React.useMemo(() => {
    if (Platform.OS !== 'android') return undefined;
    // Sheet height = 90% of the screen, never crowding the 40pt top margin.
    const sheetH = Math.min(winH * 0.9, winH - 40);
    // Everything in the sheet that isn't the cards (boards step, measured from
    // WizardBottomSheet): handle 16 + large header w/ subtitle 96 + content
    // paddingTop 28 + paddingBottom 24 + footer (12 + 62 button + bottom inset)
    // + an 8pt safety buffer so it reliably clears the scroll threshold.
    const chrome = 16 + 96 + 28 + 24 + 12 + 62 + Math.max(insets.bottom, 12) + 8;
    const available = sheetH - chrome;
    const perCard = Math.floor((available - GAP * (STYLES.length - 1)) / STYLES.length);
    if (perCard >= NATURAL_CARD_H) return undefined; // already fits — keep full size
    return Math.max(64, perCard); // floor so the thumbnail never collapses
  }, [winH, insets.bottom]);

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
          height={cardHeight}
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
