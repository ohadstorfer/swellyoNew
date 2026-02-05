import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { DestinationInputCard } from './DestinationInputCard';
import { colors, spacing, borderRadius } from '../styles/theme';

interface DestinationData {
  destination: string;
  areas: string[];
  timeInDays: number;
  timeInText: string;
}

interface DestinationCardsCarouselProps {
  destinations: string[];
  onSubmit: (data: DestinationData[]) => void;
}

export const DestinationCardsCarousel: React.FC<DestinationCardsCarouselProps> = ({
  destinations,
  onSubmit,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [destinationData, setDestinationData] = useState<Record<string, DestinationData>>({});
  const flatListRef = useRef<FlatList>(null);
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = Math.min(328, screenWidth - 62); // 328px from Figma, with padding

  // Update destination data when individual card data changes
  const handleCardDataChange = useCallback((destination: string, data: {
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }) => {
    setDestinationData(prev => ({
      ...prev,
      [destination]: {
        destination,
        ...data,
      },
    }));
  }, []);

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
      flatListRef.current?.scrollToIndex({ index, animated: true });
      setCurrentIndex(index);
    }
  };

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

  return (
    <View style={styles.container}>
      {/* Cards Carousel */}
      <View style={styles.carouselContainer}>
        <FlatList
          ref={flatListRef}
          data={destinations}
          renderItem={({ item, index }) => (
            <View style={[styles.cardWrapper, { width: cardWidth }]}>
              <DestinationInputCard
                destination={item}
                onDataChange={(data) => handleCardDataChange(item, data)}
                currentIndex={index}
                totalCount={destinations.length}
                onPrevious={scrollToPrevious}
                onNext={scrollToNext}
              />
            </View>
          )}
          keyExtractor={(item, index) => `destination-${item}-${index}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + spacing.md}
          decelerationRate="fast"
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={styles.carouselContent}
          getItemLayout={(_, index) => ({
            length: cardWidth + spacing.md,
            offset: (cardWidth + spacing.md) * index,
            index,
          })}
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

      {/* Submit Button */}
      <TouchableOpacity
        style={[
          styles.submitButton,
          !isAllDataValid() && styles.submitButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={!isAllDataValid()}
      >
        <Text style={styles.submitButtonText}>Save All</Text>
      </TouchableOpacity>
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
    marginBottom: spacing.md,
  },
  carouselContent: {
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  cardWrapper: {
    marginRight: spacing.md,
  },
  submitButton: {
    backgroundColor: '#B72DF2',
    borderRadius: borderRadius.medium,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 200,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
});
