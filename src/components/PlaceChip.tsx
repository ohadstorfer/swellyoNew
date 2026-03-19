import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';

interface PlaceChipProps {
  label: string;
  onRemove: () => void;
  disabled?: boolean;
}

export function PlaceChip({ label, onRemove, disabled = false }: PlaceChipProps) {
  return (
    <View style={[styles.chip, disabled && styles.chipDisabled]}>
      {!disabled && (
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.closeButton}
          accessibilityLabel="Remove place"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={16} color="#333333" />
        </TouchableOpacity>
      )}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    height: 32,
    maxWidth: 200,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 32,
  },
  chipDisabled: {
    opacity: 0.9,
  },
  closeButton: {
    padding: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: '400',
    color: '#333333',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
});
