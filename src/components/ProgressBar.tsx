import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../styles/theme';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  showStepText?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  totalSteps,
  showStepText = true,
}) => {
  const progress = currentStep / totalSteps;

  return (
    <View style={styles.container}>
      {showStepText && (
        <Text style={styles.stepText}>
          Step {currentStep}/{totalSteps}
        </Text>
      )}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View 
            style={[
              styles.progressFill, 
              { width: `${progress * 100}%` }
            ]} 
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  stepText: {
    ...typography.body,
    color: colors.textDark,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
  },
  progressBar: {
    width: '80%',
    height: 4,
    backgroundColor: colors.backgroundMedium,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
}); 