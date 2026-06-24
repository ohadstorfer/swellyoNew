import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { BottomSheetShell } from './BottomSheetShell';
import { ONBOARDING_COUNTRIES } from '../data/onboardingCountries';
import { colors, spacing } from '../styles/theme';

export type CountrySearchModalProps = {
  visible: boolean;
  selectedCountry: string;
  onSelect: (country: string) => void;
  onClose: () => void;
};

const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.8);

/**
 * Searchable country list rendered as a bottom sheet that slides up.
 */
export const CountrySearchModal: React.FC<CountrySearchModalProps> = ({
  visible,
  selectedCountry,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      // Raise the keyboard as the sheet slides in.
      const focusTimer = setTimeout(() => searchRef.current?.focus(), 350);
      return () => clearTimeout(focusTimer);
    }
  }, [visible]);

  // "USA" is surfaced as a convenience alias; picking it saves "United States"
  // so the value never diverges from the canonical country name.
  const filtered = ['USA', ...ONBOARDING_COUNTRIES].filter(c =>
    c.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      backdropColor="rgba(0,0,0,0.5)"
    >
      {({ panHandlers }) => (
        <View style={styles.sheet}>
          {/* Drag area — swipe down on the handle/header to dismiss */}
          <View {...panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Select Country / State</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            ref={searchRef}
            style={[styles.search, Platform.OS === 'web' && styles.searchWeb]}
            placeholder="Search countries..."
            value={query}
            onChangeText={setQuery}
          />

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {filtered.map(country => (
              <TouchableOpacity
                key={country}
                style={[
                  styles.item,
                  selectedCountry === country && styles.itemSelected,
                ]}
                onPress={() => onSelect(country === 'USA' ? 'United States' : country)}
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
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.white || '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: SHEET_HEIGHT,
    paddingBottom: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#D0D0D0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
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
    flex: 1,
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
