import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  PanResponder,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { colors } from '../styles/theme';
import type { DurationTimeUnit } from '../utils/destinationDuration';

const TIME_UNITS: DurationTimeUnit[] = ['days', 'weeks', 'months', 'years'];
const UNIT_LABELS: Record<DurationTimeUnit, string> = {
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
  years: 'Years',
};
const UNIT_ITEM_WIDTH = 58;
const UNIT_CAROUSEL_CONTAINER_WIDTH = 179;
const SWIPE_THRESHOLD = 12;

export type DestinationDurationInputProps = {
  timeValue: string;
  timeUnit: DurationTimeUnit;
  onTimeValueChange: (value: string) => void;
  onTimeUnitChange: (unit: DurationTimeUnit) => void;
  readOnly?: boolean;
  onSetParentScrollEnabled?: (enabled: boolean) => void;
  /** Optional: parent measures this for swipe exclude zones (DestinationInputCardCopy). */
  unitSelectorWrapperRef?: React.RefObject<View | null>;
  onUnitSelectorLayout?: () => void;
};

export const DestinationDurationInput: React.FC<DestinationDurationInputProps> = ({
  timeValue,
  timeUnit,
  onTimeValueChange,
  onTimeUnitChange,
  readOnly = false,
  onSetParentScrollEnabled,
  unitSelectorWrapperRef,
  onUnitSelectorLayout,
}) => {
  const unitScrollRef = useRef<ScrollView>(null);
  const timeUnitIndex = TIME_UNITS.indexOf(timeUnit);

  const scrollToUnitIndex = useCallback((index: number, animated = true) => {
    const x = index * UNIT_ITEM_WIDTH;
    unitScrollRef.current?.scrollTo({ x, animated });
  }, []);

  const stepTimeUnit = useCallback(
    (direction: number) => {
      if (direction === 0) return;
      const currentIndex = TIME_UNITS.indexOf(timeUnit);
      const nextIndex = Math.max(0, Math.min(TIME_UNITS.length - 1, currentIndex + direction));
      if (nextIndex === currentIndex) return;
      const newUnit = TIME_UNITS[nextIndex];
      onTimeUnitChange(newUnit);
      scrollToUnitIndex(nextIndex);
    },
    [timeUnit, onTimeUnitChange, scrollToUnitIndex],
  );

  useEffect(() => {
    scrollToUnitIndex(timeUnitIndex, false);
  }, [timeUnitIndex, scrollToUnitIndex]);

  const handleTimeValueChange = (text: string) => {
    let cleanedText = text.replace(/[^0-9.]/g, '');
    const parts = cleanedText.split('.');

    if (parts.length > 2) {
      cleanedText = `${parts[0]}.${parts[1]}`;
    }

    if (cleanedText.includes('.')) {
      const [integerPart, decimalPart] = cleanedText.split('.');
      if (decimalPart && decimalPart.length > 0) {
        cleanedText = `${integerPart}.5`;
      }
    }

    onTimeValueChange(cleanedText);
  };

  const onSetParentScrollEnabledRef = useRef(onSetParentScrollEnabled);
  onSetParentScrollEnabledRef.current = onSetParentScrollEnabled;

  const unitPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Platform.OS !== 'web' && !readOnly,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (readOnly) return false;
          const { dx, dy } = gestureState;
          return Math.abs(dx) > Math.abs(dy) * 0.5 && Math.abs(dx) > 4;
        },
        onPanResponderGrant: () => {
          onSetParentScrollEnabledRef.current?.(false);
        },
        onPanResponderMove: () => {},
        onPanResponderRelease: (_, gestureState) => {
          const { dx } = gestureState;
          const direction = dx > SWIPE_THRESHOLD ? -1 : dx < -SWIPE_THRESHOLD ? 1 : 0;
          stepTimeUnit(direction);
          onSetParentScrollEnabledRef.current?.(true);
        },
        onPanResponderTerminate: () => {
          onSetParentScrollEnabledRef.current?.(true);
        },
      }),
    [readOnly, stepTimeUnit],
  );

  return (
    <View
      style={styles.timeInputContainer}
      {...(Platform.OS === 'web' && ({ dataSet: { swipeExclude: 'true' } } as any))}
    >
      <View style={styles.timeInputRow}>
        <View style={styles.timeInputBox}>
          <TextInput
            style={[styles.timeInput, readOnly && styles.inputReadOnly]}
            value={timeValue}
            onChangeText={handleTimeValueChange}
            placeholder="🕝 Time spent"
            placeholderTextColor="#A0A0A0"
            keyboardType="decimal-pad"
            editable={!readOnly}
          />
        </View>
        <View
          ref={unitSelectorWrapperRef}
          onLayout={onUnitSelectorLayout}
          style={[styles.unitCarouselContainer, readOnly && styles.unitCarouselReadOnly]}
          collapsable={false}
          {...unitPanResponder.panHandlers}
        >
          <ScrollView
            ref={unitScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={false}
            contentContainerStyle={[
              styles.unitCarouselContent,
              { paddingHorizontal: (UNIT_CAROUSEL_CONTAINER_WIDTH - UNIT_ITEM_WIDTH) / 2 },
            ]}
          >
            {TIME_UNITS.map((unit, i) => {
              const isSelected = i === timeUnitIndex;
              return (
                <View key={unit} style={[styles.unitCarouselItem, { width: UNIT_ITEM_WIDTH }]}>
                  <Text
                    style={[
                      styles.unitCarouselItemText,
                      isSelected ? styles.unitCarouselItemTextSelected : styles.unitCarouselItemTextFaded,
                      readOnly && styles.unitCarouselItemTextReadOnly,
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
  );
};

const styles = StyleSheet.create({
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
  unitCarouselItemTextSelected: { color: '#333333', fontWeight: '400' },
  unitCarouselItemTextFaded: { color: '#B0B0B0' },
  unitCarouselItemTextReadOnly: { color: '#999999' },
  unitCarouselGradientOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12 },
});
