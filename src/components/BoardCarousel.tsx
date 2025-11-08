import React, { useRef, useState } from 'react';
import {
  View,
  FlatList,
  Image,
  Dimensions,
  StyleSheet,
  ViewToken,
  Platform,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';

// Helpers for sizing
const getScreenWidth = () => Dimensions.get('window').width;

// Helper to detect if we're on desktop web (not mobile web)
const isDesktopWeb = () => {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return window.innerWidth > 768; // Desktop breakpoint
};

const getCarouselItemWidth = () => {
  const screenWidth = getScreenWidth();
  if (isDesktopWeb()) {
    // On desktop, use a fixed max width and calculate from that
    const maxCarouselWidth = 700;
    return maxCarouselWidth / 3;
  }
  // Each item takes 1/3 of the screen width to show 3 items at once
  return screenWidth / 3;
};

export interface BoardType {
  id: number;
  name: string;
  imageUrl: string;
}

interface BoardCarouselProps {
  boards: BoardType[];
  selectedBoardId: number;
  onBoardSelect: (board: BoardType) => void;
}

export const BoardCarousel: React.FC<BoardCarouselProps> = ({
  boards,
  selectedBoardId,
  onBoardSelect,
}) => {
  const flatListRef = useRef<FlatList<BoardType>>(null);
  const [carouselItemWidth, setCarouselItemWidth] = useState(getCarouselItemWidth());
  const [activeIndex, setActiveIndex] = useState(
    boards.findIndex((b: BoardType) => b.id === selectedBoardId) || 0
  );

  // Update width on resize (web)
  React.useEffect(() => {
    if (Platform.OS === 'web') {
      const updateWidth = () => setCarouselItemWidth(getCarouselItemWidth());
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
      }
    }
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      const index = viewableItems[0].index as number;
      setActiveIndex(index);
      onBoardSelect(boards[index]);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const renderBoard = ({ item, index }: { item: BoardType; index: number }) => {
    const isActive = index === activeIndex;
    const isLeft = index === activeIndex - 1;
    const isRight = index === activeIndex + 1;
    const isVisible = isActive || isLeft || isRight;
    
    // Don't render if not visible (optimization)
    if (!isVisible && Math.abs(index - activeIndex) > 1) {
      return <View style={[styles.carouselItem, { width: carouselItemWidth }]} />;
    }

    // Size and opacity based on position
    const scale = isActive ? 1 : 0.8; // Side boards are 70% size
    const opacity = isActive ? 1 : 0.7; // Side boards are 50% opacity
    
    // Image width - center is larger
    const imageWidth = isActive 
      ? carouselItemWidth * 1.2 // Center board is 120% of item width
      : carouselItemWidth * 1; // Side boards are 84% of item width (0.7 * 1.2)

    return (
      <View style={[styles.carouselItem, { width: carouselItemWidth }]}>
        <Animated.View
          style={[
            styles.boardWrapper,
            {
              transform: [{ scale }],
              opacity,
            },
          ]}
        >
          <Image
            source={{ uri: item.imageUrl }}
            style={[styles.boardImage, { width: imageWidth }]}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
    );
  };

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {boards.map((_board: BoardType, index: number) => (
        <View
          key={index}
          style={[styles.dot, index === activeIndex ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  );

  // Ensure initial index is centered
  React.useEffect(() => {
    if (flatListRef.current && activeIndex >= 0) {
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        // Calculate offset to center the item (accounting for padding)
        const offset = activeIndex * carouselItemWidth;
        flatListRef.current?.scrollToOffset({ offset, animated: false });
      }, timeout);
    }
  }, []);

  // Keep scroll in sync with external selection
  React.useEffect(() => {
    const newIndex = boards.findIndex((b: BoardType) => b.id === selectedBoardId);
    if (newIndex >= 0 && newIndex !== activeIndex && flatListRef.current) {
      setActiveIndex(newIndex);
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        const offset = newIndex * carouselItemWidth;
        flatListRef.current?.scrollToOffset({ offset, animated: true });
      }, timeout);
    }
  }, [selectedBoardId, boards, activeIndex, carouselItemWidth]);

  const scrollToPrevious = () => {
    if (activeIndex > 0 && flatListRef.current) {
      const newIndex = activeIndex - 1;
      setActiveIndex(newIndex);
      onBoardSelect(boards[newIndex]);
      const offset = newIndex * carouselItemWidth;
      flatListRef.current.scrollToOffset({ offset, animated: true });
    }
  };

  const scrollToNext = () => {
    if (activeIndex < boards.length - 1 && flatListRef.current) {
      const newIndex = activeIndex + 1;
      setActiveIndex(newIndex);
      onBoardSelect(boards[newIndex]);
      const offset = newIndex * carouselItemWidth;
      flatListRef.current.scrollToOffset({ offset, animated: true });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.carouselWrapper}>
        {activeIndex > 0 && (
          <TouchableOpacity style={styles.arrowButton} onPress={scrollToPrevious} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={colors.textDark} />
          </TouchableOpacity>
        )}

        <FlatList
          ref={flatListRef}
          data={boards}
          renderItem={({ item, index }) => renderBoard({ item, index })}
          keyExtractor={(item) => item.id.toString()}
          horizontal
          pagingEnabled={false}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialScrollIndex={activeIndex >= 0 ? activeIndex : 0}
          getItemLayout={(_, index) => ({ length: carouselItemWidth, offset: carouselItemWidth * index, index })}
          snapToAlignment="center"
          snapToInterval={carouselItemWidth}
          decelerationRate="fast"
          contentContainerStyle={styles.carouselContent}
          // Add padding to center the first and last items
          contentInsetAdjustmentBehavior="never"
          onScrollToIndexFailed={(info) => {
            const wait = new Promise(resolve => setTimeout(resolve, 500));
            wait.then(() => {
              flatListRef.current?.scrollToOffset({ offset: info.index * carouselItemWidth, animated: false });
            });
          }}
          {...(Platform.OS === 'web' && { style: { overflowX: 'hidden' as any } as any })}
        />

        {activeIndex < boards.length - 1 && (
          <TouchableOpacity style={[styles.arrowButton, styles.arrowButtonRight]} onPress={scrollToNext} activeOpacity={0.7}>
            <Ionicons name="chevron-forward" size={24} color={colors.textDark} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.labelContainer}>
        {renderDots()}
        <Text style={styles.boardName}>{boards[activeIndex]?.name || ''}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    ...(isDesktopWeb() && {
      maxWidth: 700,
      alignSelf: 'center',
    }),
    ...(Platform.OS === 'web' && !isDesktopWeb() && {
      // Mobile web: keep original behavior
      maxWidth: 600,
      alignSelf: 'center',
    }),
  },
  carouselWrapper: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    ...(isDesktopWeb() && {
      maxWidth: 700,
      alignSelf: 'center',
      // @ts-ignore
      WebkitOverflowScrolling: 'touch',
      // @ts-ignore
      scrollBehavior: 'smooth',
    }),
    ...(Platform.OS === 'web' && !isDesktopWeb() && {
      // Mobile web: keep original behavior
      maxWidth: 600,
      alignSelf: 'center',
      // @ts-ignore
      WebkitOverflowScrolling: 'touch',
      // @ts-ignore
      scrollBehavior: 'smooth',
    }),
  },
  arrowButton: {
    position: 'absolute',
    left: 10,
    top: '50%',
    marginTop: -20,
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    ...(Platform.OS === 'web' && { cursor: 'pointer' as any }),
  },
  arrowButtonRight: {
    left: 'auto',
    right: 10,
  },
  carouselContent: {
    alignItems: 'center',
    paddingVertical: Platform.OS === 'web' ? spacing.lg : 0,
    // Add horizontal padding to center items properly (one item width on each side)
    paddingLeft: getCarouselItemWidth(),
    paddingRight: getCarouselItemWidth(),
  },
  carouselItem: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    ...(Platform.OS === 'web' && { paddingHorizontal: 0 }),
  },
  boardWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  boardImage: {
    height: 350,
    ...(isDesktopWeb() && {
      height: 400, // Slightly larger on desktop
      // @ts-ignore
      objectFit: 'contain' as any,
    }),
    ...(Platform.OS === 'web' && !isDesktopWeb() && {
      // Mobile web: keep original
      // @ts-ignore
      objectFit: 'contain' as any,
    }),
  },
  labelContainer: {
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm as any,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6 as any,
    marginBottom: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.dotActive || '#0788B0',
  },
  dotInactive: {
    width: 8,
    backgroundColor: colors.dotInactive || '#CFCFCF',
  },
  boardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
});
