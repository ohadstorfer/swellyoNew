// VibeSheetContent — single-select trip-vibe option cards. Same visual language
// as LevelsSheetContent: photo thumbnail left, title + description, cyan-border
// + check when selected. Order top→bottom = most surf → most chill.
import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SheetOptionCard } from './SheetOptionCard';
import { Images } from '../../../assets/images';
import {
  TRIP_VIBE_OPTIONS,
  type TripVibeSlug,
} from '../../../services/trips/groupTripsService';

interface VibeMeta {
  key: TripVibeSlug;
  title: string;
  desc: string;
  image: any;
}

// Copy is intentionally short (2-line max desc) to match the level cards.
const VIBES: readonly VibeMeta[] = [
  {
    key: 'improve_surf',
    title: 'Training Camp',
    desc: 'Improve your surfing with coaching, drills and dawn sessions.',
    image: Images.tripVibes.trainingCamp,
  },
  {
    key: 'surf_focused',
    title: 'Surf-Focused',
    desc: 'Early starts and lots of water time - the surf comes first.',
    image: Images.tripVibes.surfFocused,
  },
  {
    key: 'explore',
    title: 'Surf & Explore',
    desc: 'Good waves balanced with local food, culture and side trips.',
    image: Images.tripVibes.explore,
  },
  {
    key: 'vacation',
    title: 'Vacation Style',
    desc: 'Relaxed pace, loose surf and plenty of lay-days to unwind.',
    image: Images.tripVibes.vacation,
  },
];

// Keep card order in sync with the canonical option list (most→least surf).
const ORDERED_VIBES: readonly VibeMeta[] = TRIP_VIBE_OPTIONS.map(
  o => VIBES.find(v => v.key === o.slug)!,
).filter(Boolean);

export interface VibeSheetContentProps {
  selected: TripVibeSlug[];
  onChange: (next: TripVibeSlug[]) => void;
}

export const VibeSheetContent: React.FC<VibeSheetContentProps> = ({
  selected,
  onChange,
}) => {
  // Single-select: tapping a card replaces the selection (tapping the active
  // one clears it).
  const pick = useCallback(
    (key: TripVibeSlug) => {
      onChange(selected.includes(key) ? [] : [key]);
    },
    [selected, onChange],
  );

  return (
    <View style={styles.stack}>
      {ORDERED_VIBES.map(vibe => (
        <SheetOptionCard
          key={vibe.key}
          title={vibe.title}
          description={vibe.desc}
          image={vibe.image}
          selected={selected.includes(vibe.key)}
          onPress={() => pick(vibe.key)}
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

export default VibeSheetContent;
