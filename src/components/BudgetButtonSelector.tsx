import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Text } from './Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';

interface BudgetButtonSelectorProps {
  onSelect: (budget: 'budget' | 'mid' | 'high') => void;
  isReadOnly?: boolean;
  initialSelection?: 'budget' | 'mid' | 'high';
}

export const BudgetButtonSelector: React.FC<BudgetButtonSelectorProps> = ({
  onSelect,
  isReadOnly = false,
  initialSelection,
}) => {
  const [selectedBudget, setSelectedBudget] = useState<'budget' | 'mid' | 'high' | null>(initialSelection || null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelect = (budget: 'budget' | 'mid' | 'high') => {
    if (isReadOnly) return; // Don't allow selection in read-only mode
    setSelectedBudget(budget);
  };

  const handleSubmit = () => {
    if (!selectedBudget) return;

    setIsSubmitting(true);
    onSelect(selectedBudget);

    // Reset after a brief delay
    setTimeout(() => {
      setIsSubmitting(false);
    }, 300);
  };

  return (
    <View style={styles.container}>
      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          style={[
            styles.budgetButton,
            selectedBudget === 'budget' && styles.budgetButtonSelected,
            isReadOnly && styles.budgetButtonReadOnly,
          ]}
          onPress={() => handleSelect('budget')}
          disabled={isReadOnly}
        >
          <Text
            style={[
              styles.budgetButtonText,
              selectedBudget === 'budget' && styles.budgetButtonTextSelected,
              isReadOnly && styles.budgetButtonTextReadOnly,
            ]}
          >
            Budget
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.budgetButton,
            selectedBudget === 'mid' && styles.budgetButtonSelected,
            isReadOnly && styles.budgetButtonReadOnly,
          ]}
          onPress={() => handleSelect('mid')}
          disabled={isReadOnly}
        >
          <Text
            style={[
              styles.budgetButtonText,
              selectedBudget === 'mid' && styles.budgetButtonTextSelected,
              isReadOnly && styles.budgetButtonTextReadOnly,
            ]}
          >
            Mid
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.budgetButton,
            selectedBudget === 'high' && styles.budgetButtonSelected,
            isReadOnly && styles.budgetButtonReadOnly,
          ]}
          onPress={() => handleSelect('high')}
          disabled={isReadOnly}
        >
          <Text
            style={[
              styles.budgetButtonText,
              selectedBudget === 'high' && styles.budgetButtonTextSelected,
              isReadOnly && styles.budgetButtonTextReadOnly,
            ]}
          >
            High
          </Text>
        </TouchableOpacity>
      </View>

      {/* Submit Button - Hidden in read-only mode */}
      {!isReadOnly && (
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!selectedBudget || isSubmitting) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!selectedBudget || isSubmitting}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  budgetButton: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.medium,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E0E0E0',
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 10px rgba(0, 0, 0, 0.05)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  budgetButtonSelected: {
    borderColor: '#B72DF2',
    backgroundColor: '#F5E6FF',
  },
  budgetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: colors.textPrimary,
  },
  budgetButtonTextSelected: {
    color: '#B72DF2',
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: '#B72DF2',
    borderRadius: borderRadius.medium,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  budgetButtonReadOnly: {
    opacity: 0.6,
  },
  budgetButtonTextReadOnly: {
    color: '#999999',
  },
});

