// HowItWorksSheetContent — wraps TripTagPicker with trip_structure options + a short header.
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import {
  TripTagPicker,
} from '../TripTagPicker';
import {
  TRIP_STRUCTURE_OPTIONS,
  TRIP_STRUCTURE_MUTEX,
  type TripStructureSlug,
} from '../../../services/trips/groupTripsService';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  textMuted: '#7B7B7B',
};

export interface HowItWorksSheetContentProps {
  selected: TripStructureSlug[];
  onChange: (next: TripStructureSlug[]) => void;
}

export const HowItWorksSheetContent: React.FC<HowItWorksSheetContentProps> = ({
  selected,
  onChange,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>
        Pick a few that describe how this trip runs.
      </Text>
      <TripTagPicker<TripStructureSlug>
        options={TRIP_STRUCTURE_OPTIONS}
        selected={selected}
        onChange={onChange}
        mutexPairs={TRIP_STRUCTURE_MUTEX}
        accessibilityLabel="How the trip runs"
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
  picker: {
    marginTop: 20,
  },
});

export default HowItWorksSheetContent;
