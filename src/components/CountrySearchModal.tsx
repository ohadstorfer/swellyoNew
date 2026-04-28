import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { ONBOARDING_COUNTRIES } from '../data/onboardingCountries';
import { colors, spacing } from '../styles/theme';

export type CountrySearchModalProps = {
  visible: boolean;
  selectedCountry: string;
  onSelect: (country: string) => void;
  onClose: () => void;
};

/**
 * Searchable country list — same data and layout as OnboardingStep4Screen’s picker.
 */
export const CountrySearchModal: React.FC<CountrySearchModalProps> = ({
  visible,
  selectedCountry,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = ONBOARDING_COUNTRIES.filter(c =>
    c.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={styles.content}
          activeOpacity={1}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Select Country</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.search, Platform.OS === 'web' && styles.searchWeb]}
            placeholder="Search countries..."
            value={query}
            onChangeText={setQuery}
            autoFocus
          />

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filtered.map(country => (
              <TouchableOpacity
                key={country}
                style={[
                  styles.item,
                  selectedCountry === country && styles.itemSelected,
                ]}
                onPress={() => onSelect(country)}
              >
                <Text
                  style={[
                    styles.itemText,
                    selectedCountry === country && styles.itemTextSelected,
                  ]}
                >
                  {country}
                </Text>
              </TouchableOpacity>
            ))}
            {filtered.length === 0 && (
              <Text style={styles.noResults}>No countries found</Text>
            )}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: colors.white || '#FFFFFF',
    borderRadius: 12,
    width: '90%',
    maxWidth: 500,
    maxHeight: '80%',
    overflow: 'hidden',
    zIndex: 10001,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
    ...(Platform.OS === 'web' && {
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.textPrimary || '#333333',
  },
  closeBtn: {
    padding: spacing.xs,
  },
  search: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: spacing.md,
    margin: spacing.lg,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
  },
  searchWeb: {
    // @ts-ignore web CSS
    outlineStyle: 'none',
  },
  list: {
    maxHeight: 400,
    ...(Platform.OS === 'web' && {
      overflowY: 'auto' as const,
    }),
  },
  item: {
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  itemSelected: {
    backgroundColor: '#F0F9FA',
  },
  itemText: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
  },
  itemTextSelected: {
    color: '#00A2B6',
    fontWeight: '600',
  },
  noResults: {
    padding: spacing.lg,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textSecondary || '#666666',
  },
});
