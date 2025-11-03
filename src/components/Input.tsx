import React from 'react';
import { View, TextInput, Text, StyleSheet, TextInputProps } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../styles/theme';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  required?: boolean;
  width?: 'full' | 'half';
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  required = false,
  width = 'full',
  style,
  ...props
}) => {
  return (
    <View style={[styles.container, width === 'half' && styles.halfWidth]}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}>*</Text>}
      </Text>
      <TextInput
        style={[
          styles.input,
          error && styles.inputError,
          style,
        ]}
        placeholderTextColor={colors.textLight}
        {...props}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  halfWidth: {
    width: '48%',
  },
  label: {
    ...typography.body,
    color: colors.textDark,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  required: {
    color: '#FF6B6B',
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.backgroundMedium,
    borderRadius: borderRadius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.textDark,
    ...shadows.small,
  },
  inputError: {
    borderColor: '#FF6B6B',
  },
  errorText: {
    ...typography.body,
    color: '#FF6B6B',
    fontSize: 14,
    marginTop: spacing.xs,
  },
}); 