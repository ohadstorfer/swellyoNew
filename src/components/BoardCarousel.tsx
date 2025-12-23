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
import { getScreenWidth, getScreenDimensions, useIsDesktopWeb, useScreenDimensions, BREAKPOINTS } from '../utils/responsive';

// Helper to detect if we're on desktop web (not mobile web) - kept for StyleSheet compatibility
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
  onActiveIndexChange?: (realIndex: number) => void; // Callback to notify parent of active index change
  availableBoardHeight?: number; // Available space between header text and dots - board will fill this space
}

export const BoardCarousel: React.FC<BoardCarouselProps> = ({
  boards,
  selectedBoardId,
  onBoardSelect,
  onActiveIndexChange,
  availableBoardHeight,
}) => {
  const flatListRef = useRef<FlatList<BoardType>>(null);
  const isDesktop = useIsDesktopWeb();
  const { width: screenWidth } = useScreenDimensions();
  const [carouselItemWidth, setCarouselItemWidth] = useState(getCarouselItemWidth());
  const initialRealIndex = boards.findIndex((b: BoardType) => b.id === selectedBoardId) || 0;
  
  // Calculate responsive board dimensions
  // If availableBoardHeight is provided, use it to fill the space between header and dots
  // Otherwise, use default responsive sizing based on screen width
  const getResponsiveImageHeight = () => {
    // If available height is provided, use it (this fills the space dynamically)
    if (availableBoardHeight && availableBoardHeight > 0) {
      return availableBoardHeight;
    }
    
    // Fallback to default responsive sizing based on screen width
    if (isDesktop) {
      return 500;
    } else {
      // Scale based on screen width
      // iPhone SE (320px): ~280px height
      // iPhone 12/13/14 (390px): ~350px height  
      // iPhone 14 Pro Max (430px): ~400px height
      // Default (450px+): 450px height
      if (screenWidth <= BREAKPOINTS.xs) {
        return 280; // iPhone SE and smaller
      } else if (screenWidth <= BREAKPOINTS.sm) {
        return 320; // iPhone 8, iPhone SE 2nd gen
      } else if (screenWidth <= BREAKPOINTS.md) {
        return 380; // iPhone 12/13/14 standard
      } else {
        return 450; // iPhone 14 Pro Max and larger
      }
    }
  };
  
  const baseImageHeight = getResponsiveImageHeight();
  
  // Calculate responsive carousel item minHeight
  const getResponsiveItemMinHeight = () => {
    if (isDesktop) return 550;
    
    // Scale proportionally with image height
    // Add padding for side boards that slide down
    const padding = baseImageHeight * 0.2; // Extra space for side boards
    return baseImageHeight + padding;
  };
  
  const carouselItemMinHeight = getResponsiveItemMinHeight();
  
  // Animated value for smooth scrolling
  const scrollX = useRef(new Animated.Value(0)).current;
  
  // Simple function to create a very long repeating array (infinite carousel)
  const INFINITE_SIZE = 1000; // Large enough to feel infinite
  const START_INDEX = Math.floor(INFINITE_SIZE / 2); // Start in the middle
  
  const infiniteData = React.useMemo(() => {
    if (boards.length === 0) return [];
    // Create a long array by repeating the boards
    return Array.from({ length: INFINITE_SIZE }, (_, i) => boards[i % boards.length]);
  }, [boards]);

  // Simple mapping: any index maps to a board using modulo
  const getRealIndex = (virtualIndex: number): number => {
    if (boards.length === 0) return 0;
    return virtualIndex % boards.length;
  };

  // Get virtual index for a real index (start in middle + offset)
  const getVirtualIndex = (realIndex: number): number => {
    return START_INDEX + realIndex;
  };

  // Initial virtual index (start in middle + initial real index)
  const initialVirtualIndex = START_INDEX + initialRealIndex;
  const [activeVirtualIndex, setActiveVirtualIndex] = useState(initialVirtualIndex);
  const [isScrolling, setIsScrolling] = useState(false);
  
  // Edge threshold - jump back to middle when we get too close to edges
  const EDGE_THRESHOLD = 100;

  // Update width on resize (web and native)
  React.useEffect(() => {
    const updateWidth = () => setCarouselItemWidth(getCarouselItemWidth());
    
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
      }
    } else {
      // On native, listen to Dimensions changes
      const subscription = Dimensions.addEventListener('change', () => {
        updateWidth();
      });
      return () => subscription?.remove();
    }
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null && !isScrolling) {
      const virtualIndex = viewableItems[0].index as number;
      setActiveVirtualIndex(virtualIndex);
      
      // Get real index once
      const realIndex = getRealIndex(virtualIndex);
      
      // Notify parent of active index change
      if (onActiveIndexChange) {
        onActiveIndexChange(realIndex);
      }
      
      // Check if we're near edges and need to jump back to middle
      if (virtualIndex < EDGE_THRESHOLD) {
        // Near the start, jump to middle with same real board
        const newVirtualIndex = START_INDEX + realIndex;
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: newVirtualIndex, animated: false });
          setActiveVirtualIndex(newVirtualIndex);
          scrollX.setValue(newVirtualIndex * carouselItemWidth);
        }, 50);
      } else if (virtualIndex > INFINITE_SIZE - EDGE_THRESHOLD) {
        // Near the end, jump to middle with same real board
        const newVirtualIndex = START_INDEX + realIndex;
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: newVirtualIndex, animated: false });
          setActiveVirtualIndex(newVirtualIndex);
          scrollX.setValue(newVirtualIndex * carouselItemWidth);
        }, 50);
      }
      
      // Always update the selected board
      onBoardSelect(boards[realIndex]);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const handleBoardPress = (index: number) => {
    if (index === activeVirtualIndex || isScrolling) return; // Don't do anything if already active or scrolling
    
    setIsScrolling(true);
    
    // If near edges, jump to middle first, then calculate target
    let targetIndex = index;
    if (index < EDGE_THRESHOLD || index > INFINITE_SIZE - EDGE_THRESHOLD) {
      // Near edge, use middle position with same real board
      const realIndex = getRealIndex(index);
      targetIndex = START_INDEX + realIndex;
    }
    
    setActiveVirtualIndex(targetIndex);
    const realIndex = getRealIndex(targetIndex);
    onBoardSelect(boards[realIndex]);

    // Animate scroll to the selected board - this creates the sliding effect
    if (flatListRef.current) {
      flatListRef.current.scrollToIndex({ index: targetIndex, animated: true });
      // Manually update scrollX to ensure interpolation works correctly
      Animated.timing(scrollX, {
        toValue: targetIndex * carouselItemWidth,
        duration: 300,
        useNativeDriver: false,
      }).start();
      setTimeout(() => setIsScrolling(false), 500);
        }
  };

  const renderBoard = ({ item, index }: { item: BoardType; index: number }) => {
    const isActive = index === activeVirtualIndex;
    const isLeft = index === activeVirtualIndex - 1;
    const isRight = index === activeVirtualIndex + 1;
    const isVisible = isActive || isLeft || isRight;
      
    // Don't render if not visible (optimization)
    const distance = Math.abs(index - activeVirtualIndex);
    if (!isVisible && distance > 1) {
      return <View style={[styles.carouselItem, { width: carouselItemWidth, minHeight: carouselItemMinHeight }]} />;
    }

    // Animated values based on scroll position for smooth transitions
    // scrollX from onScroll is contentOffset.x, which is the scroll position within the content
    // When index N is centered, scrollX = N * carouselItemWidth
    const inputRange = [
      (index - 1) * carouselItemWidth,
      index * carouselItemWidth,
      (index + 1) * carouselItemWidth,
    ];

    // Interpolate scale: center board is 1.0, side boards are 0.89 (matching Figma)
    const animatedScale = scrollX.interpolate({
      inputRange,
      outputRange: [0.89, 1, 0.89],
      extrapolate: 'clamp',
    });

    // Interpolate opacity: center board is 1.0, side boards are 0.3 (matching Figma)
    const animatedOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0.3, 1, 0.3],
      extrapolate: 'clamp',
    });

    // Interpolate vertical position: side boards slide down
    // Use the responsive baseImageHeight calculated at component level
    const centerBoardHeight = baseImageHeight;
    const sideBoardHeight = baseImageHeight * 0.89;
    const verticalOffsetValue = (centerBoardHeight - sideBoardHeight) + (baseImageHeight * 0.15);
    
    const animatedTranslateY = scrollX.interpolate({
      inputRange,
      outputRange: [verticalOffsetValue, 0, verticalOffsetValue],
      extrapolate: 'clamp',
    });

    // Image width - center is larger, matching Figma proportions
    // Use animated scale to determine width dynamically
    const centerImageWidth = carouselItemWidth * 1.7; // Center board is 170% of item width (increased from 1.5)
    // For image width, we'll use a static calculation based on current active state
    // since we need the actual width value, not an animated one
    const imageWidth = isActive 
      ? centerImageWidth // Center board
      : centerImageWidth * 0.89; // Side boards are 89% of center board size

    return (
      <View style={[styles.carouselItem, { width: carouselItemWidth, minHeight: carouselItemMinHeight }]}> 
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => handleBoardPress(index)}
          disabled={isScrolling}
          style={styles.boardTouchable}
        >
            <Animated.View
              style={[
                styles.boardWrapper,
              {
                transform: [
                  { scale: animatedScale },
                  { translateY: animatedTranslateY },
                ],
                opacity: animatedOpacity,
              },
              ]}
            >
        <Image
          source={{ uri: item.imageUrl }}
          style={[styles.boardImage, { width: imageWidth, height: baseImageHeight }]}
          resizeMode="contain"
        />
            </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  // Notify parent of active index changes
  React.useEffect(() => {
    if (onActiveIndexChange) {
      const currentRealIndex = getRealIndex(activeVirtualIndex);
      onActiveIndexChange(currentRealIndex);
    }
  }, [activeVirtualIndex, onActiveIndexChange]);

  // Ensure initial index is centered and initialize scrollX
  React.useEffect(() => {
    if (flatListRef.current && initialVirtualIndex >= 0) {
      // Initialize scrollX to match the initial scroll position
      // When index N is centered, scrollX = N * carouselItemWidth
      const initialScrollX = initialVirtualIndex * carouselItemWidth;
      scrollX.setValue(initialScrollX);
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: initialVirtualIndex, animated: false });
        // Update scrollX after scroll completes to ensure sync
        setTimeout(() => {
          scrollX.setValue(initialVirtualIndex * carouselItemWidth);
        }, 100);
      }, timeout);
    }
  }, []);

  // Keep scroll in sync with external selection
  React.useEffect(() => {
    const newRealIndex = boards.findIndex((b: BoardType) => b.id === selectedBoardId);
    if (newRealIndex >= 0 && flatListRef.current) {
      const currentRealIndex = getRealIndex(activeVirtualIndex);
      if (newRealIndex !== currentRealIndex) {
        setIsScrolling(true);
        const newVirtualIndex = getVirtualIndex(newRealIndex);
        setActiveVirtualIndex(newVirtualIndex);
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: newVirtualIndex, animated: true });
          setTimeout(() => setIsScrolling(false), 500);
      }, timeout);
    }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoardId, boards, activeVirtualIndex, carouselItemWidth, infiniteData.length]);

  const scrollToPrevious = () => {
    if (flatListRef.current) {
      setIsScrolling(true);
      let newVirtualIndex = activeVirtualIndex - 1;
      
      // If near edge, jump to middle with previous real board
      if (newVirtualIndex < EDGE_THRESHOLD) {
        const realIndex = getRealIndex(newVirtualIndex);
        newVirtualIndex = START_INDEX + realIndex;
      }
      
      setActiveVirtualIndex(newVirtualIndex);
      const realIndex = getRealIndex(newVirtualIndex);
      onBoardSelect(boards[realIndex]);
      flatListRef.current.scrollToIndex({ index: newVirtualIndex, animated: true });
      // Manually update scrollX to ensure interpolation works correctly
      Animated.timing(scrollX, {
        toValue: newVirtualIndex * carouselItemWidth,
          duration: 300,
        useNativeDriver: false,
      }).start();
      setTimeout(() => setIsScrolling(false), 500);
    }
  };

  const scrollToNext = () => {
    if (flatListRef.current) {
      setIsScrolling(true);
      let newVirtualIndex = activeVirtualIndex + 1;
      
      // If near edge, jump to middle with next real board
      if (newVirtualIndex > INFINITE_SIZE - EDGE_THRESHOLD) {
        const realIndex = getRealIndex(newVirtualIndex);
        newVirtualIndex = START_INDEX + realIndex;
      }
      
      setActiveVirtualIndex(newVirtualIndex);
      const realIndex = getRealIndex(newVirtualIndex);
      onBoardSelect(boards[realIndex]);
      flatListRef.current.scrollToIndex({ index: newVirtualIndex, animated: true });
      // Manually update scrollX to ensure interpolation works correctly
      Animated.timing(scrollX, {
        toValue: newVirtualIndex * carouselItemWidth,
          duration: 300,
        useNativeDriver: false,
      }).start();
      setTimeout(() => setIsScrolling(false), 500);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.carouselWrapperContainer}>
        <View style={styles.carouselWrapper}>
        {/* Show arrows only on desktop web */}
        {isDesktop && (
          <TouchableOpacity style={styles.arrowButton} onPress={scrollToPrevious} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={colors.textDark} />
          </TouchableOpacity>
        )}

        <FlatList
          ref={flatListRef}
          data={infiniteData}
          renderItem={({ item, index }) => renderBoard({ item, index })}
          keyExtractor={(item, index) => `board-${item.id}-${index}`}
          horizontal
          pagingEnabled={false}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialScrollIndex={initialVirtualIndex >= 0 ? initialVirtualIndex : START_INDEX}
          getItemLayout={(_, index) => ({ length: carouselItemWidth, offset: carouselItemWidth * index, index })}
          snapToAlignment="center"
          snapToInterval={carouselItemWidth}
          decelerationRate="fast"
          contentContainerStyle={styles.carouselContent}
          contentInsetAdjustmentBehavior="never"
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          scrollEventThrottle={16}
          onScrollToIndexFailed={(info) => {
            const wait = new Promise(resolve => setTimeout(resolve, 500));
            wait.then(() => {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
            });
          }}
          {...(Platform.OS === 'web' && { style: { overflowX: 'hidden' as any } as any })}
        />

        {/* Show arrows only on desktop web */}
        {isDesktop && (
          <TouchableOpacity style={[styles.arrowButton, styles.arrowButtonRight]} onPress={scrollToNext} activeOpacity={0.7}>
            <Ionicons name="chevron-forward" size={24} color={colors.textDark} />
          </TouchableOpacity>
        )}
      </View>
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
  carouselWrapperContainer: {
    width: '100%',
    position: 'relative',
    ...(isDesktopWeb() && {
      maxWidth: 700,
      alignSelf: 'center',
    }),
    ...(Platform.OS === 'web' && !isDesktopWeb() && {
      maxWidth: 600,
      alignSelf: 'center',
    }),
  },
  carouselWrapper: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    // @ts-ignore
    WebkitOverflowScrolling: 'touch',
    // @ts-ignore
    scrollBehavior: 'smooth',
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
    justifyContent: 'flex-start', // Align to top so center board is higher
    alignItems: 'center',
    paddingTop: spacing.md, // Top padding for center board
    // paddingBottom removed - labelContainer will be positioned absolutely below center board
    // minHeight is set dynamically via inline style
    ...(Platform.OS === 'web' && { paddingHorizontal: 0 }),
  },
  boardTouchable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  boardWrapper: {
    justifyContent: 'flex-start', // Align boards to top
    alignItems: 'center',
  },
  boardImage: {
    // Height is set dynamically via inline style based on screen size
    // @ts-ignore
    objectFit: 'contain' as any,
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