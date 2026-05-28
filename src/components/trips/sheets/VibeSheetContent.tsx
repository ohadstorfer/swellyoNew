// VibeSheetContent — wraps TripTagPicker with trip_vibe options + a short header.
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { TripTagPicker } from '../TripTagPicker';
import {
  TRIP_VIBE_OPTIONS,
  TRIP_VIBE_MUTEX,
  type TripVibeSlug,
} from '../../../services/trips/groupTripsService';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  textMuted: '#7B7B7B',
};

export interface VibeSheetContentProps {
  selected: TripVibeSlug[];
  onChange: (next: TripVibeSlug[]) => void;
}

export const VibeSheetContent: React.FC<VibeSheetContentProps> = ({
  selected,
  onChange,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>What's the energy of this trip?</Text>
      <TripTagPicker<TripVibeSlug>
        options={TRIP_VIBE_OPTIONS}
        selected={selected}
        onChange={onChange}
        mutexPairs={TRIP_VIBE_MUTEX}
        accessibilityLabel="Trip vibe"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
});

export default VibeSheetContent;
