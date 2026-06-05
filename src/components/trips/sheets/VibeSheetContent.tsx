// VibeSheetContent — wraps TripTagPicker with trip_vibe options + a short header.
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { TripTagPicker } from '../TripTagPicker';
import {
  TRIP_VIBE_OPTIONS,
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
      <Text style={styles.scaleHint}>Most surf at the top → most chill at the bottom.</Text>
      <TripTagPicker<TripVibeSlug>
        options={TRIP_VIBE_OPTIONS}
        selected={selected}
        onChange={onChange}
        singleSelect
        accessibilityLabel="Trip vibe"
        style={styles.picker}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: -16,
  },
  header: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  scaleHint: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: C.textMuted,
    marginTop: 2,
  },
  picker: {
    marginTop: 20,
  },
});

export default VibeSheetContent;
