import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
  Dimensions,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
    if (visible) setQuery('');
  }, [visible]);

  // NOTE: we deliberately do NOT auto-focus the search input on open.
  // This sheet is a transparent Modal presented from INSIDE another transparent
  // Modal (onboarding wraps the destination sheet in its own Modal; profile-edit
  // does the same). On iOS, raising the keyboard while that nested presentation
  // is still settling races the presentation and kicks the sheet straight back
  // closed on the FIRST open (second open works only because the keyboard is
  // already up, so there's no transition to race). Letting the user tap the
  // search field to bring up the keyboard avoids the race entirely — by then the
  // sheet is fully presented and stable.

  // Keyboard-aware height. The shell lifts this bottom-anchored sheet by the
  // keyboard height (avoidKeyboard); since the sheet is a fixed 80%-screen box,
  // without capping its height the top (handle/header/search input) would slide
  // off the top of the screen. Capping to the space above the keyboard makes the
  // sheet SHRINK instead — input stays pinned, the list (flex:1) gives up room.
  const insets = useSafeAreaInsets();
  const screenH = Dimensions.get('window').height;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const sheetHeight =
    keyboardHeight > 0
      ? Math.min(SHEET_HEIGHT, screenH - keyboardHeight - insets.top - 12)
      : SHEET_HEIGHT;

  // "USA" is surfaced as a convenience alias; picking it saves "United States"
  // so the value never diverges from the canonical country name.
  const filtered = ['USA', ...ONBOARDING_COUNTRIES].filter(c =>
    c.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      backdropColor="rgba(0,0,0,0.5)"
    >
      {({ panHandlers }) => (
        <View style={[styles.sheet, { height: sheetHeight }, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 24) }]}>
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
