import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Dimensions,
  Platform,
  PanResponder,
} from 'react-native';
import { DestinationInputCard } from './DestinationInputCard';
import { spacing } from '../styles/theme';

type TimeUnit = 'days' | 'weeks' | 'months' | 'years';

interface DestinationData {
  destination: string;
  areas: string[];
  timeInDays: number;
  timeInText: string;
}

interface DestinationCardsCarouselProps {
  destinations: string[];
  onSubmit: (data: DestinationData[]) => void;
  isReadOnly?: boolean;
  initialData?: DestinationData[];
  /** When true, carousel uses full screen width (no horizontal padding from parent). */
  fullWidth?: boolean;
}

export const DestinationCardsCarousel: React.FC<DestinationCardsCarouselProps> = ({
  destinations,
  onSubmit,
  isReadOnly = false,
  initialData,
  fullWidth = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  // Index at gesture start so swipe threshold is relative to where the user started, not viewability.
  const scrollStartIndexRef = useRef(0);
  const itemWidthRef = useRef(0);
  const destinationsLengthRef = useRef(0);

  // Initialize destination data from initialData if provided (read-only mode)
  const initializeDestinationData = (): Record<string, DestinationData> => {
    if (initialData && initialData.length > 0) {
      const dataMap: Record<string, DestinationData> = {};
      initialData.forEach(dest => {
        dataMap[dest.destination] = dest;
      });
      return dataMap;
    }
    return {};
  };
  
  const [destinationData, setDestinationData] = useState<Record<string, DestinationData>>(initializeDestinationData);
  const flatListRef = useRef<FlatList>(null);
  const screenWidth = Dimensions.get('window').width;
  // Full-width carousel rules: (1) The current card is always at the horizontal center of the
  // screen and not affected by other cards. (2) Next/previous cards show a small peek (PEEK)
  // on the sides when present; if there is no next or previous card, the centered card's
  // position is unchanged (first: only right peek, last: only left peek).
  const PEEK = 24;
  const CARD_GAP = 4;
  const cardWidth = fullWidth
    ? screenWidth - 2 * PEEK
    : Math.min(328, screenWidth - 62);
  const itemWidth = fullWidth ? cardWidth + CARD_GAP : cardWidth + spacing.md;
  const carouselPaddingHorizontal = fullWidth ? PEEK : undefined;
  itemWidthRef.current = itemWidth;
  destinationsLengthRef.current = destinations.length;

  // Update destination data when individual card data changes (only if not read-only)
  const handleCardDataChange = useCallback((destination: string, data: {
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }) => {
    if (isReadOnly) return; // Don't update data in read-only mode
    
    setDestinationData(prev => ({
      ...prev,
      [destination]: {
        destination,
        ...data,
      },
    }));
  }, [isReadOnly]);

  // Check if all cards have valid data
  const isAllDataValid = () => {
    return destinations.every(dest => {
      const data = destinationData[dest];
      return data && data.areas.length > 0 && data.timeInDays > 0;
    });
  };

  const handleSubmit = () => {
    if (!isAllDataValid()) {
      return;
    }

    const allData = destinations.map(dest => destinationData[dest]).filter(Boolean);
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

  // Full-width: swipe does exactly the same as Next/Previous (one card, same animation, no free scroll).
  // Native scroll is disabled; PanResponder detects swipe and we call the same scrollToOffset as the buttons.
  const SWIPE_THRESHOLD = 40;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dx }) => Math.abs(dx) > 10,
      onPanResponderRelease: (_, { dx }) => {
        const cur = currentIndexRef.current;
        const len = destinationsLengthRef.current;
        const iw = itemWidthRef.current;
        if (len === 0) return;
        if (dx < -SWIPE_THRESHOLD && cur < len - 1) {
          const nextIndex = cur + 1;
          flatListRef.current?.scrollToOffset({ offset: nextIndex * iw, animated: true });
          currentIndexRef.current = nextIndex;
          setCurrentIndex(nextIndex);
        } else if (dx > SWIPE_THRESHOLD && cur > 0) {
          const prevIndex = cur - 1;
          flatListRef.current?.scrollToOffset({ offset: prevIndex * iw, animated: true });
          currentIndexRef.current = prevIndex;
          setCurrentIndex(prevIndex);
        }
      },
    })
  ).current;

  // Non-fullWidth: optional snap on scroll end (keep for non-fullWidth if needed later)
  const handleScrollEnd = useCallback(
    (event: any) => {
      if (fullWidth || destinations.length === 0) return;
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
      if (targetIndex !== cur) {
        flatListRef.current?.scrollToOffset({
          offset: targetIndex * itemWidth,
          animated: true,
        });
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
      }
    },
    [fullWidth, destinations.length, itemWidth]
  );

  const scrollToPrevious = () => {
    if (currentIndex > 0) {
      scrollToIndex(currentIndex - 1);
    }
  };

  const scrollToNext = () => {
    if (currentIndex < destinations.length - 1) {
      scrollToIndex(currentIndex + 1);
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const index = viewableItems[0].index;
      if (index !== null && index !== undefined) {
        setCurrentIndex(index);
      }
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  // When fullWidth, we don't use snapToOffsets: swipe is handled in onScrollEndDrag/onMomentumScrollEnd
  // and we snap only to next or previous card (same movement as Next/Previous buttons).
  const snapToOffsets = !fullWidth && destinations.length > 0
    ? destinations.map((_, i) => i * itemWidth)
    : undefined;

  // Right spacer so total content width is 2*PEEK + n*itemWidth and last card can scroll to center
  const listFooterComponent = fullWidth ? (
    <View style={{ width: PEEK }} />
  ) : undefined;

  return (
    <View style={styles.container}>
      {/* Cards Carousel */}
      <View
        style={styles.carouselContainer}
        {...(fullWidth ? panResponder.panHandlers : {})}
      >
        <FlatList
          ref={flatListRef}
          data={destinations}
          scrollEnabled={!fullWidth}
          renderItem={({ item, index }) => {
            const cardData = destinationData[item];
            // Parse timeInText to extract value and unit
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
            return (
              <View style={[
                styles.cardWrapper,
                { width: cardWidth, marginRight: fullWidth ? CARD_GAP : spacing.md },
              ]}>
                <DestinationInputCard
                  destination={item}
                  onDataChange={(data) => handleCardDataChange(item, data)}
                  currentIndex={index}
                  totalCount={destinations.length}
                  onNext={index < destinations.length - 1 ? scrollToNext : undefined}
                  onSave={index === destinations.length - 1 ? handleSubmit : undefined}
                  saveDisabled={index === destinations.length - 1 ? !isAllDataValid() : false}
                  isReadOnly={isReadOnly}
                  initialAreas={cardData?.areas.join(', ')}
                  initialTimeValue={initialTimeValue}
                  initialTimeUnit={initialTimeUnit}
                />
              </View>
            );
          }}
          keyExtractor={(item, index) => `destination-${item}-${index}`}
          horizontal
          pagingEnabled={!fullWidth}
          showsHorizontalScrollIndicator={false}
          snapToInterval={fullWidth ? undefined : itemWidth}
          snapToOffsets={snapToOffsets}
          snapToAlignment={fullWidth ? 'start' : 'start'}
          decelerationRate="fast"
          onScrollBeginDrag={() => { scrollStartIndexRef.current = currentIndexRef.current; }}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={[
            styles.carouselContent,
            fullWidth && styles.carouselContentFullWidth,
            carouselPaddingHorizontal !== undefined && { paddingHorizontal: carouselPaddingHorizontal },
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
