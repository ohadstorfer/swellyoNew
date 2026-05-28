// StayTypeSheetContent — single-select accommodation kind, reuses AccommodationTypeGrid.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  AccommodationTypeGrid,
  type AccommodationKind,
} from '../AccommodationTypeGrid';

export type { AccommodationKind };

export interface StayTypeSheetContentProps {
  selected: AccommodationKind | null;
  onChange: (next: AccommodationKind) => void;
  error?: string;
}

export const StayTypeSheetContent: React.FC<StayTypeSheetContentProps> = ({
  selected,
  onChange,
  error,
}) => {
  return (
    <View style={styles.container}>
      <AccommodationTypeGrid
        selected={selected}
        onChange={onChange}
        error={error}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 4,
  },
});

export default StayTypeSheetContent;
