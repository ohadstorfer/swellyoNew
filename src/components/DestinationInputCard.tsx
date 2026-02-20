import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  Dimensions,
  Image,
  ImageBackground,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { getCountryFlag } from '../utils/countryFlags';
import {
  getCountryImageFromStorage,
  getCountryImageFallback,
  getCountryImageFromPexels,
} from '../services/media/imageService';

interface DestinationInputCardProps {
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

type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

const TIME_UNITS: TimeUnit[] = ['days', 'weeks', 'months', 'years'];
const UNIT_LABELS: Record<TimeUnit, string> = { days: 'Days', weeks: 'Weeks', months: 'Months', years: 'Years' };
const UNIT_ITEM_WIDTH = 58;
const UNIT_CAROUSEL_CONTAINER_WIDTH = 179;

// Infinite scroll: 100 copies of the 4 units on each side of center (201 cycles = 804 items)
const REPEAT_SIDES = 100;
const CENTER_CYCLE_INDEX = REPEAT_SIDES;
const TOTAL_UNIT_ITEMS = (REPEAT_SIDES * 2 + 1) * TIME_UNITS.length;
const CENTER_ITEM_INDEX = CENTER_CYCLE_INDEX * TIME_UNITS.length;
const RECENTER_THRESHOLD = TIME_UNITS.length * 25; // recenter when within 25 cycles of edge

export const DestinationInputCard: React.FC<DestinationInputCardProps> = ({
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
}) => {
  const [areas, setAreas] = useState(initialAreas || '');
  const [timeValue, setTimeValue] = useState(initialTimeValue || '2');
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(initialTimeUnit || 'weeks');
  const unitScrollRef = useRef<ScrollView>(null);
  const onDataChangeRef = useRef(onDataChange);
  const scrollEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollXRef = useRef(0);
  const startScrollXRef = useRef(0);
  const dragStartRef = useRef<{ clientX: number; scrollX: number } | null>(null);
  const unitSelectorWrapperRef = useRef<View>(null);
  const maxScrollX = (TOTAL_UNIT_ITEMS - 1) * UNIT_ITEM_WIDTH;
  const unitScrollIndexRef = useRef(CENTER_ITEM_INDEX + TIME_UNITS.indexOf(initialTimeUnit || 'weeks'));
  const [unitScrollIndex, setUnitScrollIndex] = useState(() => CENTER_ITEM_INDEX + TIME_UNITS.indexOf(initialTimeUnit || 'weeks'));

  // Country background image (same system as ProfileScreen destinations)
  const [countryImageFailed, setCountryImageFailed] = useState(false);
  const [pexelsImageUrl, setPexelsImageUrl] = useState<string | null>(null);
  const countryImageUrl = getCountryImageFromStorage(destination);
  const countryFlagUrl = getCountryFlag(destination);
  const handleBucketImageError = async () => {
    setCountryImageFailed(true);
    const url = await getCountryImageFromPexels(destination);
    if (url) setPexelsImageUrl(url);
  };
  const backgroundImageUri =
    (!countryImageFailed && countryImageUrl) || pexelsImageUrl
      ? (countryImageFailed ? pexelsImageUrl! : countryImageUrl!)
      : countryFlagUrl || getCountryImageFallback(destination);
  useEffect(() => {
    setCountryImageFailed(false);
    setPexelsImageUrl(null);
  }, [destination]);

  // Update ref when onDataChange changes
  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  // Calculate time data whenever values change
  useEffect(() => {
    const numericValue = parseFloat(timeValue);
    if (isNaN(numericValue) || numericValue <= 0) {
      return;
    }

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
        if (numericValue % 1 === 0.5) {
          timeInText = `${Math.floor(numericValue)}.5 months`;
        } else {
          timeInText = numericValue === 1 ? '1 month' : `${numericValue} months`;
        }
        break;
      case 'years':
        timeInDays = Math.round(numericValue * 365);
        if (numericValue % 1 === 0.5) {
          timeInText = `${Math.floor(numericValue)}.5 years`;
        } else {
          timeInText = numericValue === 1 ? '1 year' : `${numericValue} years`;
        }
        break;
    }

    // Parse areas
    const areasArray = areas
      .split(/[,\n]/)
      .map(area => area.trim())
      .filter(area => area.length > 0);

    // Don't call onDataChange in read-only mode
    if (!isReadOnly) {
      onDataChangeRef.current({
        areas: areasArray,
        timeInDays,
        timeInText,
      });
    }
  }, [areas, timeValue, timeUnit, isReadOnly]);

  const handleTimeValueChange = (text: string) => {
    // Allow only numbers and a single decimal point
    let cleanedText = text.replace(/[^0-9.]/g, '');
    const parts = cleanedText.split('.');
    
    if (parts.length > 2) {
      // More than one decimal point, keep only the first part and first decimal
      cleanedText = `${parts[0]}.${parts[1]}`;
    }
    
    // If there's a decimal point with digits after it, only allow ".5"
    if (cleanedText.includes('.')) {
      const [integerPart, decimalPart] = cleanedText.split('.');
      if (decimalPart && decimalPart.length > 0) {
        // If user types anything after decimal, replace with "5"
        // Examples: "2.8" -> "2.5", "2.832" -> "2.5", "2.55" -> "2.5"
        cleanedText = `${integerPart}.5`;
      }
      // If decimalPart is empty (user just typed "."), allow it temporarily
    }
    
    setTimeValue(cleanedText);
  };

  const handleUnitSelect = (unit: TimeUnit) => {
    setTimeUnit(unit);
  };

  // Snap to nearest option and update timeUnit; recenter when near edges for infinite feel
  const snapToNearestUnit = (scrollX: number) => {
    let index = Math.round(scrollX / UNIT_ITEM_WIDTH);
    const clampedIndex = Math.max(0, Math.min(TOTAL_UNIT_ITEMS - 1, index));
    index = clampedIndex;
    const unitIndex = index % TIME_UNITS.length;
    const newUnit = TIME_UNITS[unitIndex];
    if (newUnit !== timeUnit) setTimeUnit(newUnit);

    let targetX: number;
    let newScrollIndex = index;
    if (index >= TOTAL_UNIT_ITEMS - RECENTER_THRESHOLD) {
      newScrollIndex = index - CENTER_ITEM_INDEX;
      targetX = newScrollIndex * UNIT_ITEM_WIDTH;
      unitScrollRef.current?.scrollTo({ x: targetX, animated: false });
    } else if (index < RECENTER_THRESHOLD) {
      newScrollIndex = index + CENTER_ITEM_INDEX;
      targetX = newScrollIndex * UNIT_ITEM_WIDTH;
      unitScrollRef.current?.scrollTo({ x: targetX, animated: false });
    } else {
      targetX = index * UNIT_ITEM_WIDTH;
      unitScrollRef.current?.scrollTo({ x: targetX, animated: true });
    }
    scrollXRef.current = targetX;
    unitScrollIndexRef.current = newScrollIndex;
    setUnitScrollIndex(newScrollIndex);
  };

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    snapToNearestUnit(x);
  };

  const onMomentumScrollEnd = handleScrollEnd;
  const onScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    scrollEndTimeoutRef.current = setTimeout(() => handleScrollEnd(event), 100);
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

  // PanResponder: capture horizontal drag on selector so parent carousel doesn't scroll (native + web touch)
  const unitPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (isReadOnly) return false;
          const { dx, dy } = gestureState;
          return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4;
        },
        onPanResponderGrant: () => {
          startScrollXRef.current = scrollXRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const newX = Math.max(0, Math.min(maxScrollX, startScrollXRef.current - gestureState.dx));
          unitScrollRef.current?.scrollTo({ x: newX, animated: false });
          scrollXRef.current = newX;
        },
        onPanResponderRelease: () => {
          snapToNearestUnit(scrollXRef.current);
        },
      }),
    [isReadOnly, maxScrollX]
  );

  // Web (including desktop): pointer capture so parent carousel doesn't get the drag
  const onUnitPointerDown = (e: any) => {
    if (isReadOnly || Platform.OS !== 'web') return;
    const ne = e.nativeEvent;
    const target = ne.target as HTMLElement;
    if (target?.setPointerCapture) target.setPointerCapture(ne.pointerId);
    dragStartRef.current = { clientX: ne.clientX, scrollX: scrollXRef.current };
  };
  const onUnitPointerMove = (e: any) => {
    if (!dragStartRef.current || Platform.OS !== 'web') return;
    const ne = e.nativeEvent;
    ne.preventDefault();
    ne.stopPropagation();
    const dx = ne.clientX - dragStartRef.current.clientX;
    const newScrollX = Math.max(0, Math.min(maxScrollX, dragStartRef.current.scrollX - dx));
    dragStartRef.current = { clientX: ne.clientX, scrollX: newScrollX };
    unitScrollRef.current?.scrollTo({ x: newScrollX, animated: false });
    scrollXRef.current = newScrollX;
  };
  const onUnitPointerUp = (e: any) => {
    if (Platform.OS !== 'web') return;
    const ne = e.nativeEvent;
    const target = ne.target as HTMLElement;
    if (target?.releasePointerCapture) target.releasePointerCapture(ne.pointerId);
    if (dragStartRef.current) {
      snapToNearestUnit(scrollXRef.current);
      dragStartRef.current = null;
    }
  };
  const onUnitPointerCancel = (e: any) => {
    if (Platform.OS !== 'web') return;
    dragStartRef.current = null;
  };

  // Initial scroll position to center the selected unit in the infinite list
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const startIndex = CENTER_ITEM_INDEX + TIME_UNITS.indexOf(timeUnit);
      const startX = startIndex * UNIT_ITEM_WIDTH;
      unitScrollRef.current?.scrollTo({ x: startX, animated: false });
      scrollXRef.current = startX;
      unitScrollIndexRef.current = startIndex;
      setUnitScrollIndex(startIndex);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Clean up scroll-end timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    };
  }, []);

  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(328, screenWidth - 62);

  const showBucketFirst = !countryImageFailed && countryImageUrl;
  const backgroundUri = showBucketFirst
    ? countryImageUrl!
    : pexelsImageUrl || countryFlagUrl || getCountryImageFallback(destination);

  return (
    <View style={[styles.container, { width: cardWidth }]}>
      <View style={[styles.cardOuter, { width: cardWidth }]}>
        {/* Flag outside cardWrapper so it isn't clipped when overlapping top */}
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
            onError={showBucketFirst ? handleBucketImageError : undefined}
          >
            <View style={styles.frostedOverlay} />
          </ImageBackground>
          <View style={styles.card}>
            {/* Destination name */}
            <Text style={styles.destinationName}>{destination}</Text>

          {/* Input Fields */}
          <View style={styles.content}>
            {/* Areas Input */}
            <TouchableOpacity style={styles.inputContainer} activeOpacity={1} disabled={isReadOnly}>
              <Ionicons name="location-outline" size={20} color="#A0A0A0" style={styles.inputIcon} />
              <TextInput
                style={[styles.textInput, isReadOnly && styles.inputReadOnly]}
                value={areas}
                onChangeText={setAreas}
                placeholder="City/town/surf spots..."
                placeholderTextColor="#A0A0A0"
                multiline={false}
                editable={!isReadOnly}
                {...(Platform.OS === 'web' && {
                  // @ts-ignore
                  style: [
                    styles.textInput,
                    isReadOnly && styles.inputReadOnly,
                    {
                      outline: 'none',
                      outlineWidth: 0,
                      outlineStyle: 'none',
                      outlineColor: 'transparent',
                      borderWidth: 0,
                      borderColor: 'transparent',
                    },
                  ],
                })}
              />
            </TouchableOpacity>

            {/* Time Input */}
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
                    {...(Platform.OS === 'web' && {
                      // @ts-ignore
                      style: [
                        styles.timeInput,
                        isReadOnly && styles.inputReadOnly,
                        {
                          outline: 'none',
                          outlineWidth: 0,
                          outlineStyle: 'none',
                          outlineColor: 'transparent',
                          borderWidth: 0,
                          borderColor: 'transparent',
                        },
                      ],
                    })}
                  />
                </View>
                <View
                  ref={unitSelectorWrapperRef}
                  style={[styles.unitCarouselContainer, isReadOnly && styles.unitCarouselReadOnly]}
                  accessibilityRole="adjustable"
                  accessibilityLabel="Time unit"
                  accessibilityValue={{ text: UNIT_LABELS[timeUnit] }}
                  {...(Platform.OS === 'web'
                    ? {
                        onPointerDown: onUnitPointerDown,
                        onPointerMove: onUnitPointerMove,
                        onPointerUp: onUnitPointerUp,
                        onPointerCancel: onUnitPointerCancel,
                      }
                    : unitPanResponder.panHandlers)}
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
                    onMomentumScrollEnd={onMomentumScrollEnd}
                    onScrollEndDrag={onScrollEndDrag}
                    scrollEnabled={false}
                    {...(Platform.OS === 'web' && { style: { overflow: 'hidden' } as any })}
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
                  {/* Figma: gradient overlay so text fades at edges (linear-gradient 90deg #FFF 0%, transparent 50%, #FFF 100%) */}
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

          {/* Next or Save button: Save on last card, Next otherwise */}
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
};

const styles = StyleSheet.create({
  container: {
    padding: 8,
    overflow: 'visible',
  },
  cardOuter: {
    overflow: 'visible',
    paddingTop: 56, /* 16 from flag bottom to Chile text → card starts at 56 (flag bottom 72 − 16 gap) */
  },
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
  backgroundImage: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 24,
  },
  frostedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderRadius: 24,
  },
  card: {
    borderRadius: 24,
    paddingTop: 32, /* 16 gap from flag bottom to Chile text (flag bottom 72, Chile at 88) */
    paddingHorizontal: 24, /* 24 horizontal gap each side for country content */
    paddingBottom: 16,
  },
  flagCircleWrapper: {
    position: 'absolute',
    /* Card starts at 56 (cardOuter paddingTop). top: 50 → only 6px of flag above card; increase for more stick-out, decrease for less. */
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
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
  flagCircleImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  flagEmoji: {
    fontSize: 28,
  },
  destinationName: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#333333',
    lineHeight: 22,
    marginBottom: 32, /* 32 gap between country area and input field */
  },
  content: {
    gap: 12,
    overflow: 'visible',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    height: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
      '&:focus-within': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
    } as any),
  },
  inputIcon: {
    marginRight: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      borderWidth: 0,
      borderColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderWidth: 0,
        borderColor: 'transparent',
      },
    } as any),
  },
  timeInputContainer: {
    width: '100%',
    overflow: 'visible',
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  timeInputBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
      '&:focus-within': {
        outline: 'none',
        borderColor: '#CFCFCF',
      },
    } as any),
  },
  timeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
    ...(Platform.OS === 'web' && {
      outline: 'none',
      outlineWidth: 0,
      outlineStyle: 'none',
      outlineColor: 'transparent',
      borderWidth: 0,
      borderColor: 'transparent',
      // @ts-ignore
      '&:focus': {
        outline: 'none',
        borderWidth: 0,
        borderColor: 'transparent',
      },
    } as any),
  },
  unitCarouselContainer: {
    width: UNIT_CAROUSEL_CONTAINER_WIDTH,
    height: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
  },
  unitCarouselGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  unitCarouselContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitCarouselItem: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitCarouselItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    fontSize: 16,
    fontStyle: 'normal',
    fontWeight: '400',
    lineHeight: 22,
  },
  unitCarouselItemTextSelected: {
    color: '#333333',
    fontWeight: '400',
  },
  unitCarouselItemTextFaded: {
    color: '#B0B0B0',
  },
  unitCarouselReadOnly: {
    opacity: 0.6,
    backgroundColor: '#F5F5F5',
  },
  unitCarouselItemTextReadOnly: {
    color: '#999999',
  },
  nextButton: {
    backgroundColor: '#2C2C2C',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  inputReadOnly: {
    opacity: 0.6,
    backgroundColor: '#F5F5F5',
  },
});
