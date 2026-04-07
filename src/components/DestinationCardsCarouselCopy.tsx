import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Dimensions,
  Platform,
} from 'react-native';
import { type SwipeExcludeZoneRect } from './DestinationInputCard';
import { DestinationInputCardCopy, type DestinationInputCardCopyRef } from './DestinationInputCardCopy';
import { DestinationMapPickerCard, type DestinationMapPickerCardRef } from './DestinationMapPickerCard';
import { spacing } from '../styles/theme';

const FOCUS_NEXT_INPUT_DELAY_MS = 380;
type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

interface DestinationData {
  destination: string;
  areas: string[];
  timeInDays: number;
  timeInText: string;
}

interface DestinationCardsCarouselCopyProps {
  destinations: string[];
  onSubmit: (data: DestinationData[]) => void;
  isReadOnly?: boolean;
  initialData?: DestinationData[];
  fullWidth?: boolean;
  /** When true, use the map picker card (Google Maps) instead of text autocomplete. */
  useMapPickerCard?: boolean;
  /** Ref to parent ScrollView native gesture so vertical scroll can run simultaneously with horizontal pan. */
  parentScrollNativeRef?: React.RefObject<unknown> | null;
  /** Parent scroll gesture (kept for API compatibility, unused with native scroll). */
  parentScrollGesture?: unknown;
  /** Called when a TextInput inside a card receives focus (e.g. to scroll chat into view). */
  onInputFocus?: () => void;
}

export const DestinationCardsCarouselCopy: React.FC<DestinationCardsCarouselCopyProps> = ({
  destinations,
  onSubmit,
  isReadOnly = false,
  initialData,
  fullWidth = false,
  useMapPickerCard = true,
  parentScrollNativeRef,
  parentScrollGesture,
  onInputFocus,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [carouselScrollEnabled, setCarouselScrollEnabled] = useState(true);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const itemWidthRef = useRef(0);
  const destinationsLengthRef = useRef(0);
  const flatListWebRef = useRef<any>(null);
  const excludeZonesByIndexRef = useRef<Record<number, { timeUnit: SwipeExcludeZoneRect; areaInput: SwipeExcludeZoneRect }>>({});

  const initializeDestinationData = (): Record<string, DestinationData> => {
    if (initialData && initialData.length > 0) {
      const dataMap: Record<string, DestinationData> = {};
      initialData.forEach((dest) => {
        dataMap[dest.destination] = dest;
      });
      return dataMap;
    }
    return {};
  };

  const [destinationData, setDestinationData] = useState<Record<string, DestinationData>>(initializeDestinationData);
  const flatListRef = useRef<FlatList>(null);
  const cardRefsMap = useRef<Record<number, DestinationInputCardCopyRef | DestinationMapPickerCardRef | null>>({});
  const screenWidth = Dimensions.get('window').width;
  const PEEK = 24;
  const CARD_GAP = 4;
  const cardWidth = fullWidth
    ? screenWidth - 2 * PEEK
    : Math.min(328, screenWidth - 62);
  const itemWidth = fullWidth ? cardWidth + CARD_GAP : cardWidth + spacing.md;
  const carouselPaddingHorizontal = fullWidth ? PEEK : undefined;
  itemWidthRef.current = itemWidth;
  destinationsLengthRef.current = destinations.length;

  const handleCardDataChange = useCallback(
    (
      destination: string,
      data: { areas: string[]; timeInDays: number; timeInText: string }
    ) => {
      if (isReadOnly) return;
      setDestinationData((prev) => ({
        ...prev,
        [destination]: { destination, ...data },
      }));
    },
    [isReadOnly]
  );

  const isAllDataValid = () => {
    return destinations.every((dest) => {
      const data = destinationData[dest];
      return data && data.areas.length > 0 && data.timeInDays > 0;
    });
  };

  const handleSubmit = () => {
    if (!isAllDataValid()) return;
    const allData = destinations.map((dest) => destinationData[dest]).filter(Boolean);
    onSubmit(allData);
  };

  const scrollToIndex = (index: number) => {
    if (index >= 0 && index < destinations.length) {
      if (fullWidth) {
        flatListRef.current?.scrollToOffset({
          offset: index * itemWidth,
          animated: true,
        });
      } else {
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
        });
      }
      currentIndexRef.current = index;
      setCurrentIndex(index);
    }
  };

  const handleScrollEnd = useCallback(
    (event: any) => {
      if (destinations.length === 0) return;
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const nearestIndex = Math.max(
        0,
        Math.min(destinations.length - 1, Math.round(offsetX / itemWidth))
      );
      currentIndexRef.current = nearestIndex;
      setCurrentIndex(nearestIndex);
    },
    [destinations.length, itemWidth]
  );

  const scrollToNext = () => {
    if (currentIndex >= destinations.length - 1) return;
    const nextIdx = currentIndex + 1;
    scrollToIndex(nextIdx);
    setTimeout(() => {
      cardRefsMap.current[nextIdx]?.focusAreaInput?.();
    }, FOCUS_NEXT_INPUT_DELAY_MS);
  };

  const snapToOffsets =
    destinations.length > 0
      ? destinations.map((_, i) => i * itemWidth)
      : undefined;

  const listFooterComponent = fullWidth ? <View style={{ width: PEEK }} /> : undefined;

  const handleSetParentScrollEnabled = useCallback((enabled: boolean) => {
    setCarouselScrollEnabled(enabled);
  }, []);

  const onSwipeExcludeZonesLayout = useCallback(
    (index: number, zones: { timeUnit: SwipeExcludeZoneRect; areaInput: SwipeExcludeZoneRect }) => {
      excludeZonesByIndexRef.current[index] = zones;
    },
    []
  );

  const setFlatListRef = useCallback((node: FlatList | null) => {
    (flatListRef as React.MutableRefObject<FlatList | null>).current = node;
    if (Platform.OS === 'web' && node && typeof (node as any).getScrollableNode === 'function') {
      flatListWebRef.current = (node as any).getScrollableNode();
    } else {
      flatListWebRef.current = null;
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.carouselContainer}>
        <FlatList
          ref={setFlatListRef}
          data={destinations}
          scrollEnabled={carouselScrollEnabled}
          keyboardShouldPersistTaps="always"
          renderItem={({ item, index }) => {
            const cardData = destinationData[item];
            let initialTimeValue: string | undefined;
            let initialTimeUnit: TimeUnit | undefined;
            if (cardData?.timeInText) {
              const timeText = cardData.timeInText.toLowerCase();
              const match = timeText.match(/([\d.]+)\s*(day|week|month|year)s?/);
              if (match) {
                initialTimeValue = match[1];
                const unit = match[2];
                if (unit.startsWith('day')) initialTimeUnit = 'days';
                else if (unit.startsWith('week')) initialTimeUnit = 'weeks';
                else if (unit.startsWith('month')) initialTimeUnit = 'months';
                else if (unit.startsWith('year')) initialTimeUnit = 'years';
              }
            }
            const cardProps = {
              destination: item,
              onDataChange: (data: { areas: string[]; timeInDays: number; timeInText: string }) =>
                handleCardDataChange(item, data),
              currentIndex: index,
              totalCount: destinations.length,
              onNext: index < destinations.length - 1 ? scrollToNext : undefined,
              onSave: index === destinations.length - 1 ? handleSubmit : undefined,
              saveDisabled: index === destinations.length - 1 ? !isAllDataValid() : false,
              isReadOnly,
              initialAreas: cardData?.areas.join('\n'),
              initialTimeValue,
              initialTimeUnit,
              onSwipeExcludeZonesLayout,
              isCurrentCard: index === currentIndex,
              onSetParentScrollEnabled: handleSetParentScrollEnabled,
              onInputFocus,
            };
            return (
              <View
                style={[
                  styles.cardWrapper,
                  { width: cardWidth, marginRight: fullWidth ? CARD_GAP : spacing.md },
                ]}
              >
                {useMapPickerCard ? (
                  <DestinationMapPickerCard
                    ref={(r) => {
                      cardRefsMap.current[index] = r;
                    }}
                    {...cardProps}
                  />
                ) : (
                  <DestinationInputCardCopy
                    ref={(r) => {
                      cardRefsMap.current[index] = r;
                    }}
                    {...cardProps}
                  />
                )}
              </View>
            );
          }}
          keyExtractor={(item, index) => `destination-copy-${item}-${index}`}
          horizontal
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={itemWidth}
          snapToOffsets={snapToOffsets}
          snapToAlignment="start"
          onMomentumScrollEnd={handleScrollEnd}
          contentContainerStyle={[
            styles.carouselContent,
            fullWidth && styles.carouselContentFullWidth,
            carouselPaddingHorizontal !== undefined && {
              paddingHorizontal: carouselPaddingHorizontal,
            },
          ]}
          getItemLayout={(_, index) => ({
            length: itemWidth,
            offset: fullWidth ? PEEK + itemWidth * index : itemWidth * index,
            index,
          })}
          ListFooterComponent={listFooterComponent}
          {...(Platform.OS === 'web' && {
            style: {
              overflowX: 'auto' as any,
              overflowY: 'hidden' as any,
              WebkitOverflowScrolling: 'touch' as any,
            } as any,
            scrollEventThrottle: 16,
          })}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    
  },
  carouselContainer: {
    width: '100%',
    position: 'relative',
  },
  carouselContent: {
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  carouselContentFullWidth: {
    paddingHorizontal: 12,
  },
  cardWrapper: {
    marginRight: spacing.md,
  },
});