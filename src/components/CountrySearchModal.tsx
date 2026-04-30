import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
  PanResponder,
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
  const [mounted, setMounted] = useState(visible);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Swipe-down to dismiss
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          sheetAnim.setValue(Math.max(0, 1 - gs.dy / SHEET_HEIGHT));
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 100 || gs.vy > 0.5) {
          onCloseRef.current();
        } else {
          Animated.spring(sheetAnim, {
            toValue: 1,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setQuery('');
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(sheetAnim, { toValue: 1, tension: 65, friction: 11, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  const filtered = ONBOARDING_COUNTRIES.filter(c =>
    c.toLowerCase().includes(query.toLowerCase()),
  );

  const sheetTranslate = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_HEIGHT, 0],
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: sheetTranslate }] }]}
        >
          {/* Drag area — swipe down on the handle/header to dismiss */}
          <View {...pan.panHandlers}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Select Country</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            style={[styles.search, Platform.OS === 'web' && styles.searchWeb]}
            placeholder="Search countries..."
            value={query}
            onChangeText={setQuery}
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
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: colors.white || '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
