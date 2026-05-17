import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Animated,
  Easing,
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
// Used when the amount is exactly 1 ("1 week" instead of "1 weeks").
const UNIT_LABELS_SINGULAR: Record<DurationTimeUnit, string> = {
  days: 'Day',
  weeks: 'Week',
  months: 'Month',
  years: 'Year',
};
const UNIT_ITEM_PADDING = 12; // half the gap between two unit words
const UNIT_ITEM_WIDTH_ESTIMATE = 58; // per-word width before it's measured
const UNIT_CAROUSEL_CONTAINER_WIDTH = 179;
const SWIPE_THRESHOLD = 12;

// The carousel loops endlessly. We fake it by rendering the 4 units many
// times over and keeping the user near the middle — realistically nobody
// swipes far enough to reach an end.
const UNIT_SETS = 15;
const RENDER_UNITS: DurationTimeUnit[] = Array.from(
  { length: UNIT_SETS },
  () => TIME_UNITS,
).flat();
const MIDDLE_SET_START = Math.floor(UNIT_SETS / 2) * TIME_UNITS.length;
const mod = (n: number, m: number) => ((n % m) + m) % m;

export type DestinationDurationInputProps = {
  timeValue: string;
  timeUnit: DurationTimeUnit;
  onTimeValueChange: (value: string) => void;
  onTimeUnitChange: (unit: DurationTimeUnit) => void;
  readOnly?: boolean;
  /** Height of the number box and unit carousel. Defaults to 56. */
  fieldHeight?: number;
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
  fieldHeight = 56,
  onSetParentScrollEnabled,
  unitSelectorWrapperRef,
  onUnitSelectorLayout,
}) => {
  // Singular labels ("Week") when the amount is exactly 1, plural otherwise.
  const unitLabels = parseFloat(timeValue) === 1 ? UNIT_LABELS_SINGULAR : UNIT_LABELS;

  // Measured carousel width — needed so the selected unit stays centred.
  const [unitContainerWidth, setUnitContainerWidth] = useState(UNIT_CAROUSEL_CONTAINER_WIDTH);
  // Measured width of each of the 4 unit words, so they can be spaced by
  // their edges (even gaps) rather than fixed slots (uneven gaps).
  const [itemWidths, setItemWidths] = useState<number[]>(() =>
    TIME_UNITS.map(() => UNIT_ITEM_WIDTH_ESTIMATE),
  );
  const setItemWidth = useCallback((index: number, w: number) => {
    setItemWidths((prev) => {
      if (Math.abs(prev[index] - w) < 0.5) return prev;
      const next = [...prev];
      next[index] = w;
      return next;
    });
  }, []);

  // Which rendered position is centred. It walks freely as the user swipes;
  // the unit it maps to wraps with `mod`, giving the endless loop.
  const [displayPos, setDisplayPos] = useState(
    () => MIDDLE_SET_START + TIME_UNITS.indexOf(timeUnit),
  );
  const displayPosRef = useRef(displayPos);
  displayPosRef.current = displayPos;
  const prevPosRef = useRef(displayPos);
  const slidingRef = useRef(false);

  // translateX that centres a given rendered position (widths are periodic).
  const targetFor = useCallback(
    (pos: number) => {
      const setWidth = itemWidths.reduce((a, b) => a + b, 0);
      const k = mod(pos, TIME_UNITS.length);
      const setIndex = Math.floor(pos / TIME_UNITS.length);
      let partial = 0;
      for (let j = 0; j < k; j++) partial += itemWidths[j];
      const center = setIndex * setWidth + partial + itemWidths[k] / 2;
      return unitContainerWidth / 2 - center;
    },
    [itemWidths, unitContainerWidth],
  );

  // translateX of the unit track — animating this gives the smooth slide.
  const scrollX = useRef(
    new Animated.Value(
      UNIT_CAROUSEL_CONTAINER_WIDTH / 2 -
        ((MIDDLE_SET_START + TIME_UNITS.indexOf(timeUnit)) * UNIT_ITEM_WIDTH_ESTIMATE +
          UNIT_ITEM_WIDTH_ESTIMATE / 2),
    ),
  ).current;

  const stepTimeUnit = useCallback(
    (direction: number) => {
      if (direction === 0) return;
      const next = displayPosRef.current + direction;
      if (next < 0 || next >= RENDER_UNITS.length) return;
      setDisplayPos(next);
      onTimeUnitChange(TIME_UNITS[mod(next, TIME_UNITS.length)]);
    },
    [onTimeUnitChange],
  );

  // If the unit is changed from outside (reset/open), recentre to the middle
  // set for that unit so the loop has room on both sides again.
  useEffect(() => {
    if (TIME_UNITS[mod(displayPosRef.current, TIME_UNITS.length)] === timeUnit) return;
    setDisplayPos(MIDDLE_SET_START + TIME_UNITS.indexOf(timeUnit));
  }, [timeUnit]);

  // Centre the selected unit. A ±1 swipe slides smoothly; anything else
  // (external recentre, width re-measure) snaps — but never over a running
  // slide, which would cut the animation short.
  useEffect(() => {
    const toValue = targetFor(displayPos);
    const delta = displayPos - prevPosRef.current;
    prevPosRef.current = displayPos;
    if (Math.abs(delta) === 1) {
      slidingRef.current = true;
      Animated.timing(scrollX, {
        toValue,
        duration: 340,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }).start(() => {
        slidingRef.current = false;
      });
      return;
    }
    if (slidingRef.current) return;
    scrollX.setValue(toValue);
  }, [displayPos, targetFor, scrollX]);

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
        <View style={[styles.timeInputBox, { height: fieldHeight }]}>
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
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setUnitContainerWidth(w);
            onUnitSelectorLayout?.();
          }}
          style={[
            styles.unitCarouselContainer,
            { height: fieldHeight },
            readOnly && styles.unitCarouselReadOnly,
          ]}
          collapsable={false}
          {...unitPanResponder.panHandlers}
        >
          <Animated.View
            style={[styles.unitCarouselTrack, { transform: [{ translateX: scrollX }] }]}
          >
            {RENDER_UNITS.map((unit, i) => {
              const isSelected = i === displayPos;
              return (
                <View
                  key={i}
                  onLayout={
                    i < TIME_UNITS.length
                      ? (e) => setItemWidth(i, e.nativeEvent.layout.width)
                      : undefined
                  }
                  style={[styles.unitCarouselItem, { height: fieldHeight }]}
                >
                  <Text
                    style={[
                      styles.unitCarouselItemText,
                      isSelected ? styles.unitCarouselItemTextSelected : styles.unitCarouselItemTextFaded,
                      readOnly && styles.unitCarouselItemTextReadOnly,
                    ]}
                  >
                    {unitLabels[unit]}
                  </Text>
                </View>
              );
            })}
          </Animated.View>
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
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 16, width: '100%' },
  timeInputBox: {
    flex: 30,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  timeInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 22,
    textAlign: 'center',
  },
  inputReadOnly: { opacity: 0.6, backgroundColor: '#F5F5F5' },
  unitCarouselContainer: {
    flex: 70,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  unitCarouselReadOnly: { opacity: 0.6, backgroundColor: '#F5F5F5' },
  unitCarouselTrack: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitCarouselItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: UNIT_ITEM_PADDING,
  },
  unitCarouselItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
  unitCarouselItemTextSelected: { color: '#333333', fontWeight: '600' },
  unitCarouselItemTextFaded: { color: '#B0B0B0' },
  unitCarouselItemTextReadOnly: { color: '#999999' },
  unitCarouselGradientOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 12 },
});
