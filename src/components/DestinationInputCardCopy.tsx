import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Dimensions,
  Image,
  ImageBackground,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  PanResponder,
  LayoutAnimation,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { getCountryFlag } from '../utils/countryFlags';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
  getCountryImageFromPexels,
} from '../services/media/imageService';
import { MultiPlaceAutocompleteInput, type MultiPlaceAutocompleteInputRef } from './MultiPlaceAutocompleteInput';

/** Country name (as shown in UI) to CLDR 2-letter region code for Places API bias. */
const COUNTRY_TO_REGION: Record<string, string> = {
  'USA': 'us',
  'United States': 'us',
  'Costa Rica': 'cr',
  'Nicaragua': 'ni',
  'Panama': 'pa',
  'El Salvador': 'sv',
  'Indonesia': 'id',
  'Sri Lanka': 'lk',
  'Philippines': 'ph',
  'Australia': 'au',
  'Mexico': 'mx',
  'Brazil': 'br',
  'Portugal': 'pt',
  'France': 'fr',
  'Spain': 'es',
  'South Africa': 'za',
  'Morocco': 'ma',
  'Israel': 'il',
  'Japan': 'jp',
  'New Zealand': 'nz',
  'Peru': 'pe',
  'Ecuador': 'ec',
  'Chile': 'cl',
};

interface DestinationInputCardCopyProps {
  destination: string;
  onDataChange: (data: {
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }) => void;
  currentIndex?: number;
  totalCount?: number;
  onNext?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  isReadOnly?: boolean;
  initialAreas?: string;
  initialTimeValue?: string;
  initialTimeUnit?: TimeUnit;
}

export interface DestinationInputCardCopyRef {
  focusAreaInput: () => void;
}

type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

const TIME_UNITS: TimeUnit[] = ['days', 'weeks', 'months', 'years'];
const UNIT_LABELS: Record<TimeUnit, string> = { days: 'Days', weeks: 'Weeks', months: 'Months', years: 'Years' };
const UNIT_ITEM_WIDTH = 58;
const UNIT_CAROUSEL_CONTAINER_WIDTH = 179;
const REPEAT_SIDES = 100;
const CENTER_CYCLE_INDEX = REPEAT_SIDES;
const TOTAL_UNIT_ITEMS = (REPEAT_SIDES * 2 + 1) * TIME_UNITS.length;
const CENTER_ITEM_INDEX = CENTER_CYCLE_INDEX * TIME_UNITS.length;
const RECENTER_THRESHOLD = TIME_UNITS.length * 25;

export const DestinationInputCardCopy = forwardRef<
  DestinationInputCardCopyRef,
  DestinationInputCardCopyProps
>(function DestinationInputCardCopy(
  {
    destination,
    onDataChange,
    currentIndex = 0,
    totalCount = 1,
    onNext,
    onSave,
    saveDisabled = false,
    isReadOnly = false,
    initialAreas,
    initialTimeValue,
    initialTimeUnit,
  },
  ref
) {
  const initialPlaces = initialAreas
    ? initialAreas.split(/[,\n]/).map((a) => a.trim()).filter(Boolean)
    : [];
  const [places, setPlaces] = useState<string[]>(initialPlaces);
  const [timeValue, setTimeValue] = useState(initialTimeValue || '2');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(initialTimeUnit || 'weeks');
  const unitScrollRef = useRef<ScrollView>(null);
  const placesInputRef = useRef<MultiPlaceAutocompleteInputRef>(null);
  const scrollXRef = useRef(0);
  const unitScrollIndexRef = useRef(CENTER_ITEM_INDEX + TIME_UNITS.indexOf(initialTimeUnit || 'weeks'));
  const [unitScrollIndex, setUnitScrollIndex] = useState(() => CENTER_ITEM_INDEX + TIME_UNITS.indexOf(initialTimeUnit || 'weeks'));
  const onDataChangeRef = useRef(onDataChange);
  const maxScrollX = (TOTAL_UNIT_ITEMS - 1) * UNIT_ITEM_WIDTH;

  const regionCodes = useMemo(() => {
    const code = COUNTRY_TO_REGION[destination];
    return code ? [code] : undefined;
  }, [destination]);

  useImperativeHandle(ref, () => ({
    focusAreaInput: () => placesInputRef.current?.focus(),
  }), []);

  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  useEffect(() => {
    const numericValue = parseFloat(timeValue);
    if (isNaN(numericValue) || numericValue <= 0) return;

    let timeInDays = 0;
    let timeInText = '';

    switch (timeUnit) {
      case 'days':
        timeInDays = Math.round(numericValue);
        timeInText = numericValue === 1 ? '1 day' : `${numericValue} days`;
        break;
      case 'weeks':
        timeInDays = Math.round(numericValue * 7);
        timeInText = numericValue === 1 ? '1 week' : `${numericValue} weeks`;
        break;
      case 'months':
        timeInDays = Math.round(numericValue * 30);
        timeInText = numericValue % 1 === 0.5 ? `${Math.floor(numericValue)}.5 months` : (numericValue === 1 ? '1 month' : `${numericValue} months`);
        break;
      case 'years':
        timeInDays = Math.round(numericValue * 365);
        timeInText = numericValue % 1 === 0.5 ? `${Math.floor(numericValue)}.5 years` : (numericValue === 1 ? '1 year' : `${numericValue} years`);
        break;
    }

    if (!isReadOnly) {
      onDataChangeRef.current({
        areas: places,
        timeInDays,
        timeInText,
      });
    }
  }, [places, timeValue, timeUnit, isReadOnly]);

  const [countryImageFailed, setCountryImageFailed] = useState(false);
  const [pexelsImageUrl, setPexelsImageUrl] = useState<string | null>(null);
  const countryImageUrl = getCountryImageFromStorage(destination);
  const countryFlagUrl = getCountryFlag(destination);
  const handleBucketImageError = async () => {
    setCountryImageFailed(true);
    const url = await getCountryImageFromPexels(destination);
    if (url) setPexelsImageUrl(url);
  };
  const backgroundUri =
    (!countryImageFailed && countryImageUrl) || pexelsImageUrl
      ? (countryImageFailed ? pexelsImageUrl! : countryImageUrl!)
      : countryFlagUrl || getCountryImageFallback(destination);
  useEffect(() => {
    setCountryImageFailed(false);
    setPexelsImageUrl(null);
  }, [destination]);

  const handleTimeValueChange = (text: string) => {
    const cleanedText = text.replace(/[^0-9.]/g, '');
    const parts = cleanedText.split('.');
    const final = parts.length > 2 ? `${parts[0]}.${parts[1]}` : cleanedText;
    setTimeValue(final);
  };

  const snapToNearestUnit = (scrollX: number) => {
    const index = Math.round(scrollX / UNIT_ITEM_WIDTH);
    const clampedIndex = Math.max(0, Math.min(TOTAL_UNIT_ITEMS - 1, index));
    const unitIndex = clampedIndex % TIME_UNITS.length;
    const newUnit = TIME_UNITS[unitIndex];
    if (newUnit !== timeUnit) {
      LayoutAnimation.configureNext({ duration: 220, update: { type: LayoutAnimation.Types.easeInEaseOut } });
      setTimeUnit(newUnit);
    }
    const targetX = clampedIndex * UNIT_ITEM_WIDTH;
    unitScrollRef.current?.scrollTo({ x: targetX, animated: true });
    scrollXRef.current = targetX;
    unitScrollIndexRef.current = clampedIndex;
    setUnitScrollIndex(clampedIndex);
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    snapToNearestUnit(event.nativeEvent.contentOffset.x);
  };

  const onUnitScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    scrollXRef.current = x;
    const idx = Math.round(x / UNIT_ITEM_WIDTH);
    if (idx !== unitScrollIndexRef.current) {
      unitScrollIndexRef.current = idx;
      setUnitScrollIndex(idx);
    }
  };

  const unitPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (isReadOnly) return false;
          const { dx } = gestureState;
          return Math.abs(dx) > 4;
        },
        onPanResponderGrant: () => {},
        onPanResponderMove: (_, gestureState) => {
          const newX = Math.max(0, Math.min(maxScrollX, scrollXRef.current - gestureState.dx));
          unitScrollRef.current?.scrollTo({ x: newX, animated: false });
          scrollXRef.current = newX;
        },
        onPanResponderRelease: () => {
          snapToNearestUnit(scrollXRef.current);
        },
      }),
    [isReadOnly, maxScrollX, timeUnit]
  );

  useEffect(() => {
    const startIndex = CENTER_ITEM_INDEX + TIME_UNITS.indexOf(timeUnit);
    const startX = startIndex * UNIT_ITEM_WIDTH;
    unitScrollRef.current?.scrollTo({ x: startX, animated: false });
    scrollXRef.current = startX;
    unitScrollIndexRef.current = startIndex;
    setUnitScrollIndex(startIndex);
  }, []);

  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(328, screenWidth - 62);

  return (
    <View style={[styles.container, { width: cardWidth }]}>
      <View style={[styles.cardOuter, { width: cardWidth }]}>
        <View style={styles.flagCircleWrapper} pointerEvents="none">
          <View style={styles.flagCircle}>
            {countryFlagUrl ? (
              <Image source={{ uri: countryFlagUrl }} style={styles.flagCircleImage} resizeMode="cover" />
            ) : (
              <Text style={styles.flagEmoji}>🌊</Text>
            )}
          </View>
        </View>
        <View style={[styles.cardWrapper, { width: cardWidth }]}>
          <ImageBackground
            source={{ uri: backgroundUri }}
            style={styles.backgroundImage}
            resizeMode="cover"
            onError={handleBucketImageError}
          >
            <View style={styles.frostedOverlay} />
          </ImageBackground>
          <View style={styles.card}>
            <Text style={styles.destinationName}>{destination}</Text>

            <View style={styles.contentWithStack}>
              <MultiPlaceAutocompleteInput
                ref={placesInputRef}
                value={places}
                onChange={setPlaces}
                placeholder="City/town/surf spots..."
                disabled={isReadOnly}
                includedRegionCodes={regionCodes}
              />

              <View style={styles.timeInputContainer}>
                <View style={styles.timeInputRow}>
                  <View style={styles.timeInputBox}>
                    <TextInput
                      style={[styles.timeInput, isReadOnly && styles.inputReadOnly]}
                      value={timeValue}
                      onChangeText={handleTimeValueChange}
                      placeholder="🕝 Time spent"
                      placeholderTextColor="#A0A0A0"
                      keyboardType="numeric"
                      editable={!isReadOnly}
                    />
                  </View>
                  <View
                    style={[styles.unitCarouselContainer, isReadOnly && styles.unitCarouselReadOnly]}
                    {...unitPanResponder.panHandlers}
                  >
                    <ScrollView
                      ref={unitScrollRef}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      scrollEventThrottle={16}
                      decelerationRate="fast"
                      snapToInterval={UNIT_ITEM_WIDTH}
                      snapToAlignment="center"
                      disableIntervalMomentum
                      contentContainerStyle={[
                        styles.unitCarouselContent,
                        { paddingHorizontal: (UNIT_CAROUSEL_CONTAINER_WIDTH - UNIT_ITEM_WIDTH) / 2 },
                      ]}
                      onScroll={onUnitScroll}
                      onMomentumScrollEnd={handleScrollEnd}
                      onScrollEndDrag={handleScrollEnd}
                      scrollEnabled={!isReadOnly}
                    >
                      {Array.from({ length: TOTAL_UNIT_ITEMS }, (_, i) => {
                        const unit = TIME_UNITS[i % TIME_UNITS.length];
                        const isSelected = i === unitScrollIndex;
                        return (
                          <View key={i} style={[styles.unitCarouselItem, { width: UNIT_ITEM_WIDTH }]}>
                            <Text
                              style={[
                                styles.unitCarouselItemText,
                                isSelected ? styles.unitCarouselItemTextSelected : styles.unitCarouselItemTextFaded,
                                isReadOnly && styles.unitCarouselItemTextReadOnly,
                              ]}
                            >
                              {UNIT_LABELS[unit]}
                            </Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                    <View style={styles.unitCarouselGradientOverlay} pointerEvents="none">
                      <LinearGradient
                        colors={['#FFFFFF', 'rgba(255, 255, 255, 0)', '#FFFFFF']}
                        locations={[0, 0.5, 1]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {!isReadOnly && (onNext || onSave) && (
              <TouchableOpacity
                style={[
                  onSave ? styles.saveButton : styles.nextButton,
                  onSave && saveDisabled && styles.saveButtonDisabled,
                ]}
                onPress={onSave || onNext}
                activeOpacity={0.85}
                disabled={onSave ? saveDisabled : false}
              >
                <Text style={styles.nextButtonText}>{onSave ? 'Save' : 'Next'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { padding: 8, overflow: 'visible' },
  cardOuter: { overflow: 'visible', paddingTop: 56 },
  cardWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    position: 'relative',
  },
  backgroundImage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 24 },
  frostedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 24 },
  card: {
    borderRadius: 24,
    paddingTop: 32,
    paddingHorizontal: 24,
    paddingBottom: 16,
    minHeight: 320,
  },
  flagCircleWrapper: { position: 'absolute', top: 40, left: 0, right: 0, alignItems: 'center', zIndex: 1 },
  flagCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.white,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  flagCircleImage: { width: 50, height: 50, borderRadius: 25 },
  flagEmoji: { fontSize: 28 },
  destinationName: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#333333',
    lineHeight: 22,
    marginBottom: 32,
  },
  content: { gap: 12, overflow: 'visible' },
  contentWithStack: {
    gap: 12,
    overflow: 'visible',
    zIndex: 10000,
    elevation: 24,
  },
  timeInputContainer: { width: '100%' },
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  timeInputBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  timeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  inputReadOnly: { opacity: 0.6, backgroundColor: '#F5F5F5' },
  unitCarouselContainer: {
    width: UNIT_CAROUSEL_CONTAINER_WIDTH,
    height: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  unitCarouselReadOnly: { opacity: 0.6, backgroundColor: '#F5F5F5' },
  unitCarouselContent: { alignItems: 'center', justifyContent: 'center' },
  unitCarouselItem: { height: 56, alignItems: 'center', justifyContent: 'center' },
  unitCarouselItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
  unitCarouselItemTextSelected: { color: '#333333', fontWeight: '400' },
  unitCarouselItemTextFaded: { color: '#B0B0B0' },
  unitCarouselItemTextReadOnly: { color: '#999999' },
  unitCarouselGradientOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12 },
  nextButton: {
    backgroundColor: '#2C2C2C',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  nextButtonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  saveButton: {
    backgroundColor: '#212121',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  saveButtonDisabled: { opacity: 0.5 },
});
