import React from 'react';
import {
  View,
  StyleSheet,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { colors, spacing } from '../styles/theme';
import { Text } from './Text';

interface TravelExperienceSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  error?: string;
}

export const TravelExperienceSlider: React.FC<TravelExperienceSliderProps> = ({
  value,
  onValueChange,
  error,
}) => {
  return (
    <View style={styles.container}>
      <Text variant="title" style={styles.title}>
        What is your Travel Experience?
      </Text>
      
      {/* Current Value Display */}
      <View style={styles.valueSection}>
        <Text variant="title" style={styles.valueText}>
          {Math.round(value)}
        </Text>
        <Text variant="body" style={styles.valueLabel}>
          surf trips
        </Text>
      </View>

      {/* Slider */}
      <View style={styles.sliderContainer}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={100} // Set a reasonable max for now, can be increased
          value={value}
          onValueChange={onValueChange}
          step={1}
          minimumTrackTintColor="#FF6B9D"
          maximumTrackTintColor="#E0E0E0"
        />
      </View>

      {/* Min/Max Labels */}
      <View style={styles.labelsContainer}>
        <Text style={styles.labelText}>0</Text>
        <Text style={styles.labelText}>∞</Text>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.lg,
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontSize: 24,
    color: colors.textDark,
    marginBottom: spacing.xl,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  valueSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  valueText: {
    fontSize: 48,
    color: colors.textDark,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  valueLabel: {
    fontSize: 18,
    color: colors.textMedium,
  },
  sliderContainer: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  labelsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 12,
  },
  labelText: {
    fontSize: 16,
    color: colors.textMedium,
    fontWeight: '500',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
