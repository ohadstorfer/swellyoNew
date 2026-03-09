import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Dimensions,
  Platform,
  PanResponder,
} from 'react-native';
import { type SwipeExcludeZoneRect } from './DestinationInputCard';
import { DestinationInputCardCopy, type DestinationInputCardCopyRef } from './DestinationInputCardCopy';
import { DestinationMapPickerCard, type DestinationMapPickerCardRef } from './DestinationMapPickerCard';
import { spacing } from '../styles/theme';

const FOCUS_NEXT_INPUT_DELAY_MS = 380;
const DIRECTION_THRESHOLD = 10;
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
}

export const DestinationCardsCarouselCopy: React.FC<DestinationCardsCarouselCopyProps> = ({
  destinations,
  onSubmit,
  isReadOnly = false,
  initialData,
  fullWidth = false,
  useMapPickerCard = true,
  parentScrollNativeRef,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const scrollStartIndexRef = useRef(0);
  const itemWidthRef = useRef(0);
  const destinationsLengthRef = useRef(0);
  const lockedScrollOffset = useRef<number | null>(null);
  const isGestureActive = useRef(false);
  const hasHandledScrollEnd = useRef(false);
  const flatListWebRef = useRef<any>(null);
  const excludeZonesByIndexRef = useRef<Record<number, { timeUnit: SwipeExcludeZoneRect; areaInput: SwipeExcludeZoneRect }>>({});
  const touchStartInExcludeZoneRef = useRef(false);
  const webSwipeExcludeRef = useRef(false);
  const isPointInRect = (px: number, py: number, r: SwipeExcludeZoneRect) =>
    r.width > 0 && r.height > 0 && px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;

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

  const getScrollOffsetForIndex = (index: number) => index * itemWidth;

  const performLock = useCallback(() => {
    lockedScrollOffset.current = getScrollOffsetForIndex(currentIndexRef.current);
    if (Platform.OS === 'web' && flatListWebRef.current) {
      flatListWebRef.current.style.overflow = 'hidden';
      if (lockedScrollOffset.current !== null) {
        flatListWebRef.current.scrollLeft = lockedScrollOffset.current;
      }
    }
    if (flatListRef.current && lockedScrollOffset.current !== null) {
      flatListRef.current.scrollToOffset({
        offset: lockedScrollOffset.current,
        animated: false,
      });
    }
  }, [itemWidth]);

  const carouselPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      // Check exclude zones (time-unit picker)
      const fromWeb = Platform.OS === 'web' && webSwipeExcludeRef.current;
      let inExclude = fromWeb;
      if (!inExclude) {
        const zones = excludeZonesByIndexRef.current[currentIndexRef.current];
        if (zones) {
          inExclude = isPointInRect(evt.nativeEvent.pageX, evt.nativeEvent.pageY, zones.timeUnit);
        }
      }
      if (inExclude) return false;
      const { dx, dy } = gestureState;
      return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > DIRECTION_THRESHOLD;
    },
    onPanResponderGrant: () => {
      scrollStartIndexRef.current = currentIndexRef.current;
      isGestureActive.current = true;
      performLock();
    },
    onPanResponderMove: () => {
      if (lockedScrollOffset.current != null) {
        flatListRef.current?.scrollToOffset({
          offset: lockedScrollOffset.current,
          animated: false,
        });
        if (Platform.OS === 'web' && flatListWebRef.current) {
          flatListWebRef.current.scrollLeft = lockedScrollOffset.current;
        }
      }
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gestureState) => {
      const hadLock = isGestureActive.current;
      isGestureActive.current = false;
      if (!hadLock) return;
      if (hasHandledScrollEnd.current) {
        if (Platform.OS === 'web' && flatListWebRef.current) {
          flatListWebRef.current.style.overflow = 'auto';
        }
        return;
      }
      const deltaX = gestureState.dx;
      const deltaY = gestureState.dy;
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
      const minSwipeDistance = 5;
      if (isHorizontalSwipe && Math.abs(deltaX) > minSwipeDistance) {
        const start = scrollStartIndexRef.current;
        let targetIndex = start;
        if (deltaX < 0) targetIndex = Math.min(destinations.length - 1, start + 1);
        else targetIndex = Math.max(0, start - 1);
        targetIndex = Math.max(0, Math.min(destinations.length - 1, targetIndex));
        hasHandledScrollEnd.current = true;
        const targetOffset = getScrollOffsetForIndex(targetIndex);
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
        flatListRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
        if (targetIndex > start) {
          setTimeout(() => {
            cardRefsMap.current[targetIndex]?.focusAreaInput?.();
          }, FOCUS_NEXT_INPUT_DELAY_MS);
        }
        if (Platform.OS === 'web' && flatListWebRef.current) {
          setTimeout(() => {
            flatListWebRef.current.style.overflow = 'auto';
          }, 300);
        }
      } else if (Platform.OS === 'web' && flatListWebRef.current) {
        flatListWebRef.current.style.overflow = 'auto';
      }
      setTimeout(() => { hasHandledScrollEnd.current = false; }, 350);
    },
    onPanResponderTerminate: () => {
      const hadLock = isGestureActive.current;
      isGestureActive.current = false;
      touchStartInExcludeZoneRef.current = false;
      webSwipeExcludeRef.current = false;
      lockedScrollOffset.current = null;
      hasHandledScrollEnd.current = false;
      if (hadLock && Platform.OS === 'web' && flatListWebRef.current) {
        flatListWebRef.current.style.overflow = 'auto';
      }
    },
  }), [performLock, destinations.length, itemWidth]);

  const handleWebTouchStartCapture = useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    const target = event.nativeEvent?.target ?? event.target;
    webSwipeExcludeRef.current = !!target?.closest?.('[data-swipe-exclude]');
  }, []);

  const handleScrollEnd = useCallback(
    (event: any) => {
      if (destinations.length === 0) return;
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const cur = scrollStartIndexRef.current;
      const curOffset = cur * itemWidth;
      const threshold = itemWidth * 0.25;
      let targetIndex = cur;
      if (offsetX > curOffset + threshold && cur + 1 < destinations.length) {
        targetIndex = cur + 1;
      } else if (offsetX < curOffset - threshold && cur > 0) {
        targetIndex = cur - 1;
      }
      targetIndex = Math.max(cur - 1, Math.min(cur + 1, targetIndex));
      targetIndex = Math.max(0, Math.min(destinations.length - 1, targetIndex));
      if (targetIndex !== cur) {
        flatListRef.current?.scrollToOffset({
          offset: targetIndex * itemWidth,
          animated: true,
        });
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
      }
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

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const index = viewableItems[0].index;
      if (index != null) {
        setCurrentIndex(index);
      }
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const snapToOffsets =
    destinations.length > 0
      ? destinations.map((_, i) => i * itemWidth)
      : undefined;

  const listFooterComponent = fullWidth ? <View style={{ width: PEEK }} /> : undefined;

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
      <View
        style={styles.carouselContainer}
        {...(Platform.OS === 'web' && { onTouchStartCapture: handleWebTouchStartCapture } as any)}
      >
        <View {...carouselPanResponder.panHandlers}>
          <FlatList
          ref={setFlatListRef}
          data={destinations}
          scrollEnabled={false}
          disableIntervalMomentum
          decelerationRate={0}
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
          onScrollBeginDrag={() => {
            scrollStartIndexRef.current = currentIndexRef.current;
          }}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.md,
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
