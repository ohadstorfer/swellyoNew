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
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
  Extrapolate,
  SharedValue,
} from 'react-native-reanimated';
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
  const initialRealIndex = boards.findIndex((b: BoardType) => b.id === selectedBoardId) || 0;
  
  // Create infinite data array: [last, ...boards, first]
  // This allows seamless looping
  const infiniteData = React.useMemo(() => {
    if (boards.length === 0) return [];
    const lastBoard = boards[boards.length - 1];
    const firstBoard = boards[0];
    return [lastBoard, ...boards, firstBoard];
  }, [boards]);

  // Map virtual index (in infiniteData) to real index (in boards)
  const getRealIndex = (virtualIndex: number): number => {
    if (virtualIndex === 0) return boards.length - 1; // First item is last board
    if (virtualIndex === infiniteData.length - 1) return 0; // Last item is first board
    return virtualIndex - 1; // Middle items map directly
  };

  // Map real index to virtual index
  const getVirtualIndex = (realIndex: number): number => {
    return realIndex + 1; // +1 because first item is the duplicate last board
  };

  // Initial virtual index (accounting for the duplicate at the start)
  const initialVirtualIndex = getVirtualIndex(initialRealIndex);
  const [activeVirtualIndex, setActiveVirtualIndex] = useState(initialVirtualIndex);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [targetIndexForVisibility, setTargetIndexForVisibility] = useState(initialVirtualIndex);
  
  // Shared values for animation
  const animationProgress = useSharedValue(0);
  const previousActiveIndex = useRef(initialVirtualIndex);
  const targetActiveIndex = useSharedValue(initialVirtualIndex);
  
  // Create shared value for activeVirtualIndex to avoid React state in worklets
  const activeVirtualIndexShared = useSharedValue(initialVirtualIndex);
  
  // Sync shared value with React state
  React.useEffect(() => {
    activeVirtualIndexShared.value = activeVirtualIndex;
  }, [activeVirtualIndex]);
  
  // Initialize target to match current state
  React.useEffect(() => {
    targetActiveIndex.value = initialVirtualIndex;
    activeVirtualIndexShared.value = initialVirtualIndex;
  }, []);

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

  // Track if we're manually handling a wrap (to prevent onViewableItemsChanged from interfering)
  const isManualWrapRef = useRef(false);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // Don't process viewable items changes if we're animating or manually handling a wrap
    if (isAnimating || isScrolling || isManualWrapRef.current) {
      return;
    }
    
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      const virtualIndex = viewableItems[0].index as number;
      
      // Handle infinite loop: jump to real item when at edges
      // This only triggers for user swipe gestures (not button presses)
      if (virtualIndex === 0) {
        // At duplicate last board, jump to real last board
        setTimeout(() => {
          const realLastIndex = boards.length - 1;
          const realLastVirtualIndex = getVirtualIndex(realLastIndex);
          
          // Update shared values first
          activeVirtualIndexShared.value = realLastVirtualIndex;
          targetActiveIndex.value = realLastVirtualIndex;
          previousActiveIndex.current = realLastVirtualIndex;
          
          // Then React state
          setActiveVirtualIndex(realLastVirtualIndex);
          flatListRef.current?.scrollToIndex({ index: realLastVirtualIndex, animated: false });
          onBoardSelect(boards[realLastIndex]);
        }, 50);
      } else if (virtualIndex === infiniteData.length - 1) {
        // At duplicate first board, jump to real first board
        setTimeout(() => {
          const realFirstVirtualIndex = getVirtualIndex(0);
          
          // Update shared values first
          activeVirtualIndexShared.value = realFirstVirtualIndex;
          targetActiveIndex.value = realFirstVirtualIndex;
          previousActiveIndex.current = realFirstVirtualIndex;
          
          // Then React state
          setActiveVirtualIndex(realFirstVirtualIndex);
          flatListRef.current?.scrollToIndex({ index: realFirstVirtualIndex, animated: false });
          onBoardSelect(boards[0]);
        }, 50);
      } else {
        // Normal case: map virtual index to real index
        setActiveVirtualIndex(virtualIndex);
        const realIndex = getRealIndex(virtualIndex);
        onBoardSelect(boards[realIndex]);
      }
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  // Separate component for board item to allow hooks
  const BoardItem: React.FC<{
    item: BoardType;
    index: number;
    activeVirtualIndexShared: SharedValue<number>;
    previousActiveIndex: number;
    carouselItemWidth: number;
    infiniteData: BoardType[];
    boards: BoardType[];
    animationProgress: SharedValue<number>;
    targetActiveIndex: SharedValue<number>;
    onPress: () => void;
    isAnimating: boolean;
    isActive: boolean;
    isLeft: boolean;
    isRight: boolean;
    isVisible: boolean;
  }> = ({
    item,
    index,
    activeVirtualIndexShared,
    previousActiveIndex,
    carouselItemWidth,
    infiniteData,
    boards,
    animationProgress,
    targetActiveIndex,
    onPress,
    isAnimating,
    isActive,
    isLeft,
    isRight,
  }) => {
    // Calculate start position (relative to previous active index)
    // When calculating positions, treat duplicates as their real equivalent
    const calculatePositionHelper = (fromIdx: number, toIdx: number): number => {
      if (toIdx === fromIdx) return 0;
      
      // Convert duplicates to their equivalent real indices for position calculation
      // This ensures boards at index 0 and boards.length are treated as the same position
      const normalizeIndex = (idx: number): number => {
        if (idx === 0) return boards.length; // Duplicate last -> real last
        if (idx === infiniteData.length - 1) return 1; // Duplicate first -> real first
        return idx;
      };
      
      const normalizedFrom = normalizeIndex(fromIdx);
      const normalizedTo = normalizeIndex(toIdx);
      
      const diff = normalizedTo - normalizedFrom;
      const absDiff = Math.abs(diff);
      
      // For normalized indices (1 to boards.length), use simple wrap-around
      // boards.length is the count of real boards
      if (absDiff > boards.length / 2) {
        if (diff > 0) {
          return diff - boards.length;
        } else {
          return diff + boards.length;
        }
      }
      
      return diff;
    };
    
    const startPosition = calculatePositionHelper(previousActiveIndex, index);

    // Animated styles using reanimated
    const animatedStyle = useAnimatedStyle(() => {
      // ALWAYS use shared values inside worklet - never React state
      // This prevents blinks when parent re-renders during animation
      const currentActiveIndex = activeVirtualIndexShared.value;
      const isAnimatingCheck = animationProgress.value > 0.001;
      const isNearCompletion = animationProgress.value >= 0.99;
      const animationJustCompleted = animationProgress.value === 0 && targetActiveIndex.value !== currentActiveIndex;
      
      // Use targetActiveIndex when:
      // 1. Animation is near completion (>= 0.99) - ensures smooth transition
      // 2. Animation just completed (progress = 0 but state hasn't synced) - prevents flicker
      // 3. Not animating and target doesn't match state - ensures consistency during re-renders
      const effectiveActiveIndex = (isNearCompletion || animationJustCompleted || (!isAnimatingCheck && targetActiveIndex.value !== currentActiveIndex)) 
        ? targetActiveIndex.value 
        : currentActiveIndex;
      
      // Helper function to calculate position considering wrap-around
      // Treat duplicates as their real equivalent for consistent positioning
      const calculatePosition = (fromIndex: number, toIndex: number): number => {
        if (toIndex === fromIndex) {
          return 0;
        }
        
        'worklet';
        
        // Convert duplicates to their equivalent real indices
        // This ensures index 0 and boards.length are treated as the same position
        const normalizeIndex = (idx: number): number => {
          if (idx === 0) return boards.length; // Duplicate last -> real last
          if (idx === infiniteData.length - 1) return 1; // Duplicate first -> real first
          return idx;
        };
        
        const normalizedFrom = normalizeIndex(fromIndex);
        const normalizedTo = normalizeIndex(toIndex);
        
        const diff = normalizedTo - normalizedFrom;
        const absDiff = Math.abs(diff);
        
        // For normalized indices (1 to boards.length), use simple wrap-around
        if (absDiff > boards.length / 2) {
          if (diff > 0) {
            return diff - boards.length;
          } else {
            return diff + boards.length;
          }
        }
        
        return diff;
      };
      
      // Calculate current position relative to effective active index (for non-animating state)
      const currentPositionRelative = calculatePosition(effectiveActiveIndex, index);
      
      // Calculate end position relative to target index (for animating state)
      const endPosition = calculatePosition(targetActiveIndex.value, index);
      
      // Check if we're currently animating
      // Use a threshold that ensures we use animated values until animation fully completes
      // When progress = 1.0, we're still animating and should use end values
      // Only when progress = 0 (after reset) do we switch to non-animating state
      const isAnimating = animationProgress.value > 0.001;
      
      // When not animating, use static values based on current position
      // When animating, interpolate smoothly
      let scale: number;
      let opacity: number;
      let translateX: number;
      
      if (!isAnimating) {
        // Not animating: Use currentPositionRelative which is now calculated with effectiveActiveIndex
        // effectiveActiveIndex uses targetActiveIndex when state hasn't synced, ensuring exact match
        // This prevents blink because currentPositionRelative will match endPosition exactly
        if (currentPositionRelative === 0) {
          scale = 1.0;
          opacity = 1.0;
        } else {
          scale = 0.8;
          opacity = 0.3;
        }
        translateX = 0;
      } else {
        // Animating: interpolate all values smoothly from start to end
        // Calculate start scale and opacity based on start position
        const startScale = startPosition === 0 ? 1.0 : 0.8;
        const startOpacity = startPosition === 0 ? 1.0 : 0.3;
        
        // Calculate end scale and opacity based on endPosition (target position)
        // endPosition is calculated relative to targetActiveIndex.value, which is the final destination
        // IMPORTANT: Use endPosition (not currentPositionRelative) to ensure animation ends with correct values
        // currentPositionRelative uses effectiveActiveIndex which might still be old during animation
        const endScale = endPosition === 0 ? 1.0 : 0.8;
        const endOpacity = endPosition === 0 ? 1.0 : 0.3;
        
        // When animation is at completion (>= 0.99), use exact end values to prevent flicker
        // This ensures smooth transition when switching to non-animating state
        if (animationProgress.value >= 0.99) {
          scale = endScale;
          opacity = endOpacity;
        } else {
          // Interpolate scale and opacity to reach exact end values
          // Accelerate the style animation so it completes at 95% of movement animation
          // This ensures the size reaches the destination size BEFORE the board physically arrives
          // Map animationProgress [0, 1] to styleProgress [0, 1] where 1.0 is reached at 0.95 of animation
          const styleProgress = interpolate(
            animationProgress.value,
            [0, 0.95, 1],
            [0, 1, 1],
            Extrapolate.CLAMP
          );
          
          scale = interpolate(
            styleProgress,
            [0, 1],
            [startScale, endScale],
            Extrapolate.CLAMP
          );
          
          opacity = interpolate(
            styleProgress,
            [0, 1],
            [startOpacity, endOpacity],
            Extrapolate.CLAMP
          );
        }
        
        // Interpolate translateX for smooth movement during animation
        translateX = interpolate(
          animationProgress.value,
          [0, 1],
          [(startPosition - currentPositionRelative) * carouselItemWidth, (endPosition - currentPositionRelative) * carouselItemWidth],
          Extrapolate.CLAMP
        );
      }
      
      // Vertical offset for side boards (to align bottoms)
      // Only apply offset when scale is less than 1.0 (side boards)
      const baseImageHeight = isDesktopWeb() ? 500 : 450;
      const verticalOffset = scale >= 1.0 
        ? 0 
        : baseImageHeight * (1 - scale);
      
      return {
        transform: [
          { translateX },
          { scale },
          { translateY: verticalOffset },
        ],
        opacity,
      };
    }, [carouselItemWidth, index, infiniteData.length, boards.length]);

    // Image width - use consistent base width for all boards
    // The scale transform handles size differences, so we use the same base width
    // This prevents size changes when isActive updates asynchronously after animation
    const centerImageWidth = carouselItemWidth * 1.8; // Center board is 180% of item width
    // Always use centerImageWidth as base - scale transform handles size differences
    const imageWidth = centerImageWidth;

    // For centered board, make touchable area smaller (just around the board image)
    // For side boards, use full width for easier tapping
    const touchableWidth = isActive 
      ? imageWidth * 1.1 // Centered board: slightly wider than image (10% padding)
      : carouselItemWidth; // Side boards: full width of carousel item

    // Position touchable areas: left board aligns left, right board aligns right, center is centered
    const touchableAlignment = isLeft 
      ? { alignSelf: 'flex-start' as const } // Left board: align to left edge
      : isRight 
      ? { alignSelf: 'flex-end' as const } // Right board: align to right edge
      : { alignSelf: 'center' as const }; // Centered board: center it

    return (
      <View style={[styles.carouselItem, { width: carouselItemWidth }]}> 
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          disabled={isAnimating}
          style={[
            styles.boardTouchable,
            { 
              width: touchableWidth, 
              height: '100%',
              ...touchableAlignment,
            }
          ]}
        >
          <View style={styles.boardContainer}>
            <Animated.View
              style={[
                styles.boardWrapper,
                animatedStyle,
              ]}
            >
        <Image
          source={{ uri: item.imageUrl }}
          style={[styles.boardImage, { width: imageWidth }]}
          resizeMode="contain"
        />
            </Animated.View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderBoard = ({ item, index }: { item: BoardType; index: number }) => {
    // Use targetIndexForVisibility during animation to determine visibility
    // This ensures the new board that should appear is visible during animation
    const effectiveIndexForVisibility = isAnimating ? targetIndexForVisibility : activeVirtualIndex;
    
    const isActive = index === activeVirtualIndex;
    const isLeft = index === effectiveIndexForVisibility - 1 || (effectiveIndexForVisibility === 0 && index === infiniteData.length - 1);
    const isRight = index === effectiveIndexForVisibility + 1 || (effectiveIndexForVisibility === infiniteData.length - 1 && index === 0);
    const isVisible = index === effectiveIndexForVisibility || isLeft || isRight;
    
    // Don't render if not visible (optimization)
    // Account for wrapping in infinite loop
    // Use effectiveIndexForVisibility for distance calculation too
    const distance = Math.min(
      Math.abs(index - effectiveIndexForVisibility),
      Math.abs(index - effectiveIndexForVisibility + infiniteData.length),
      Math.abs(index - effectiveIndexForVisibility - infiniteData.length)
    );
    if (!isVisible && distance > 1) {
      return <View style={[styles.carouselItem, { width: carouselItemWidth }]} />;
    }

    const handleBoardPress = () => {
      if (index !== activeVirtualIndex && !isAnimating && flatListRef.current) {
        setIsAnimating(true);
        setIsScrolling(true);
        
        // Mark that this is an internal animation to prevent useEffect from interfering
        isInternalAnimationRef.current = true;
        
        // Animate to the clicked index first (even if it's a duplicate)
        // After animation, we'll jump to the real item if needed
        const targetIndex = index;
        
        // Determine if we need to wrap after animation
        let needsWrapAfterAnimation = false;
        let wrapTargetIndex = targetIndex;
        if (index === 0) {
          // Clicked on duplicate last board (index 0), will wrap to real last board after animation
          needsWrapAfterAnimation = true;
          wrapTargetIndex = boards.length; // This is the real last board in infiniteData
          isManualWrapRef.current = true; // Prevent onViewableItemsChanged from interfering
        } else if (index === infiniteData.length - 1) {
          // Clicked on duplicate first board (last index), will wrap to real first board after animation
          needsWrapAfterAnimation = true;
          wrapTargetIndex = 1; // This is the real first board in infiniteData
          isManualWrapRef.current = true; // Prevent onViewableItemsChanged from interfering
        }
        
        // Call onBoardSelect with the REAL board (not duplicate)
        const realIndexForCallback = needsWrapAfterAnimation ? getRealIndex(wrapTargetIndex) : getRealIndex(targetIndex);
        onBoardSelect(boards[realIndexForCallback]);
        
        // Update previous and target indices before starting animation
        // Update shared values FIRST to ensure worklet sees correct values
        previousActiveIndex.current = activeVirtualIndex;
        targetActiveIndex.value = targetIndex;
        activeVirtualIndexShared.value = targetIndex; // Update shared value immediately
        setTargetIndexForVisibility(targetIndex); // Update visibility state immediately
        
        // Scroll FlatList to new position BEFORE starting animation
        // This ensures FlatList position matches the animated position from the start
        // Use requestAnimationFrame to ensure it happens in the next frame
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToIndex({ index: targetIndex, animated: false });
        });
        
        // Start animation
        animationProgress.value = 0;
        animationProgress.value = withTiming(
          1,
          {
            duration: 300, // 300ms for smooth animation
            easing: Easing.inOut(Easing.ease), // Ease-in-out for smooth feel
          },
          (finished) => {
            if (finished) {
              // Reset animation progress FIRST (before any state changes)
              animationProgress.value = 0;
              
              // If we animated to a duplicate, we need to wrap to the real item
              if (needsWrapAfterAnimation) {
                const realItemIndex = wrapTargetIndex;
                
                // Store wrap info for visual stability
                isWrappingRef.current = true;
                wrapFromIndex.current = targetIndex;
                wrapToIndex.current = realItemIndex;
                
                // Silently update FlatList scroll position to the real item
                // This must happen BEFORE updating shared values to prevent visual jumps
                requestAnimationFrame(() => {
                  if (flatListRef.current) {
                    flatListRef.current.scrollToIndex({ index: realItemIndex, animated: false });
                  }
                  
                  // Now update all state values to point to the real item
                  // Do this in the same frame as the scroll to keep everything in sync
                  activeVirtualIndexShared.value = realItemIndex;
                  targetActiveIndex.value = realItemIndex;
                  setActiveVirtualIndex(realItemIndex);
                  setTargetIndexForVisibility(realItemIndex);
                  previousActiveIndex.current = realItemIndex;
                  
                  // Clear wrapping state after a brief delay
                  setTimeout(() => {
                    isWrappingRef.current = false;
                    wrapFromIndex.current = null;
                    wrapToIndex.current = null;
                    isManualWrapRef.current = false;
                  }, 50);
                });
              } else {
                // Normal case: just update state
                activeVirtualIndexShared.value = targetIndex;
                targetActiveIndex.value = targetIndex;
                setActiveVirtualIndex(targetIndex);
                setTargetIndexForVisibility(targetIndex);
                previousActiveIndex.current = targetIndex;
              }
              
              setIsAnimating(false);
              
              // Clear the flag after animation completes
              setTimeout(() => {
                isInternalAnimationRef.current = false;
              }, 150);
              
              setTimeout(() => setIsScrolling(false), 100);
            }
          }
        );
      }
    };

    return (
      <BoardItem
        item={item}
        index={index}
        activeVirtualIndexShared={activeVirtualIndexShared}
        previousActiveIndex={previousActiveIndex.current}
        carouselItemWidth={carouselItemWidth}
        infiniteData={infiniteData}
        boards={boards}
        animationProgress={animationProgress}
        targetActiveIndex={targetActiveIndex}
        onPress={handleBoardPress}
        isAnimating={isAnimating}
        isActive={isActive}
        isLeft={isLeft}
        isRight={isRight}
        isVisible={isVisible}
      />
    );
  };

  const renderDots = () => {
    const currentRealIndex = getRealIndex(activeVirtualIndex);
    return (
    <View style={styles.dotsContainer}>
      {boards.map((_board: BoardType, index: number) => (
        <View
          key={index}
            style={[styles.dot, index === currentRealIndex ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  );
  };

  // Ensure initial index is centered
  React.useEffect(() => {
    if (flatListRef.current && initialVirtualIndex >= 0) {
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: initialVirtualIndex, animated: false });
      }, timeout);
    }
  }, []);

  // Keep scroll in sync with external selection
  // Skip this effect if we're animating or the change is from our own animation
  const isInternalAnimationRef = useRef(false);
  
  React.useEffect(() => {
    // Don't sync if we're currently animating (prevents interference with our animation)
    if (isAnimating) {
      return;
    }
    
    const newRealIndex = boards.findIndex((b: BoardType) => b.id === selectedBoardId);
    if (newRealIndex >= 0 && flatListRef.current) {
      const currentRealIndex = getRealIndex(activeVirtualIndex);
      const newVirtualIndex = getVirtualIndex(newRealIndex);
      
      // Check if this change is from our own animation (matches our target)
      const isFromOurAnimation = newVirtualIndex === targetActiveIndex.value || isInternalAnimationRef.current;
      
      // Reset the flag if it was set
      if (isInternalAnimationRef.current) {
        isInternalAnimationRef.current = false;
      }
      
      // Only sync if the selection actually changed and it's NOT from our own animation
      if (newRealIndex !== currentRealIndex && !isFromOurAnimation) {
        // This is an external change, sync to it
        setIsScrolling(true);
        // Update shared values FIRST
        activeVirtualIndexShared.value = newVirtualIndex;
        targetActiveIndex.value = newVirtualIndex;
        // Then update React state
        setActiveVirtualIndex(newVirtualIndex);
        setTargetIndexForVisibility(newVirtualIndex);
        previousActiveIndex.current = newVirtualIndex;
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
    if (flatListRef.current && !isAnimating) {
      setIsAnimating(true);
      setIsScrolling(true);
      isInternalAnimationRef.current = true; // Mark as internal animation
      
      let targetIndex = activeVirtualIndex - 1;
      
      // Determine if we need to wrap after animation
      let needsWrapAfterAnimation = false;
      let wrapTargetIndex = targetIndex;
      
      // If going backwards from real first board (index 1), go to duplicate last board, then wrap
      if (targetIndex <= 0) {
        targetIndex = 0; // Animate to duplicate last board
        needsWrapAfterAnimation = true;
        wrapTargetIndex = boards.length; // Wrap to real last board
        isManualWrapRef.current = true; // Prevent onViewableItemsChanged from interfering
      }
      
      // Update previous and target indices before starting animation
      previousActiveIndex.current = activeVirtualIndex;
      targetActiveIndex.value = targetIndex;
      
      // Call onBoardSelect with the REAL board (not duplicate)
      const realIndexForCallback = needsWrapAfterAnimation ? getRealIndex(wrapTargetIndex) : getRealIndex(targetIndex);
      onBoardSelect(boards[realIndexForCallback]);
      
      // Start animation
      animationProgress.value = 0;
      animationProgress.value = withTiming(
        1,
        {
          duration: 300,
          easing: Easing.inOut(Easing.ease),
        },
        (finished) => {
          if (finished) {
            // Reset animation progress FIRST
            animationProgress.value = 0;
            
            // If we animated to a duplicate, wrap to the real item
            if (needsWrapAfterAnimation) {
              const realItemIndex = wrapTargetIndex;
              
              // Silently update FlatList scroll position to the real item
              requestAnimationFrame(() => {
                if (flatListRef.current) {
                  flatListRef.current.scrollToIndex({ index: realItemIndex, animated: false });
                }
                
                // Update all state values to point to the real item in the same frame
                activeVirtualIndexShared.value = realItemIndex;
                targetActiveIndex.value = realItemIndex;
                setActiveVirtualIndex(realItemIndex);
                setTargetIndexForVisibility(realItemIndex);
                previousActiveIndex.current = realItemIndex;
                
                // Clear wrap flag
                setTimeout(() => {
                  isManualWrapRef.current = false;
                }, 50);
              });
            } else {
              // Normal case: just update state
              activeVirtualIndexShared.value = targetIndex;
              targetActiveIndex.value = targetIndex;
              setActiveVirtualIndex(targetIndex);
              setTargetIndexForVisibility(targetIndex);
              previousActiveIndex.current = targetIndex;
            }
            
            setIsAnimating(false);
            
            // Clear the flag after animation completes
            setTimeout(() => {
              isInternalAnimationRef.current = false;
            }, 150);
            
            setTimeout(() => setIsScrolling(false), 100);
          }
        }
      );
    }
  };

  const scrollToNext = () => {
    if (flatListRef.current && !isAnimating) {
      setIsAnimating(true);
      setIsScrolling(true);
      isInternalAnimationRef.current = true; // Mark as internal animation
      
      let targetIndex = activeVirtualIndex + 1;
      
      // Determine if we need to wrap after animation
      let needsWrapAfterAnimation = false;
      let wrapTargetIndex = targetIndex;
      
      // If going forward from real last board (index boards.length), go to duplicate first board, then wrap
      if (targetIndex >= boards.length + 1) {
        targetIndex = infiniteData.length - 1; // Animate to duplicate first board
        needsWrapAfterAnimation = true;
        wrapTargetIndex = 1; // Wrap to real first board
        isManualWrapRef.current = true; // Prevent onViewableItemsChanged from interfering
      }
      
      // Update previous and target indices before starting animation
      previousActiveIndex.current = activeVirtualIndex;
      targetActiveIndex.value = targetIndex;
      
      // Call onBoardSelect with the REAL board (not duplicate)
      const realIndexForCallback = needsWrapAfterAnimation ? getRealIndex(wrapTargetIndex) : getRealIndex(targetIndex);
      onBoardSelect(boards[realIndexForCallback]);
      
      // Start animation
      animationProgress.value = 0;
      animationProgress.value = withTiming(
        1,
        {
          duration: 300,
          easing: Easing.inOut(Easing.ease),
        },
        (finished) => {
          if (finished) {
            // Reset animation progress FIRST
            animationProgress.value = 0;
            
            // If we animated to a duplicate, wrap to the real item
            if (needsWrapAfterAnimation) {
              const realItemIndex = wrapTargetIndex;
              
              // Silently update FlatList scroll position to the real item
              requestAnimationFrame(() => {
                if (flatListRef.current) {
                  flatListRef.current.scrollToIndex({ index: realItemIndex, animated: false });
                }
                
                // Update all state values to point to the real item in the same frame
                activeVirtualIndexShared.value = realItemIndex;
                targetActiveIndex.value = realItemIndex;
                setActiveVirtualIndex(realItemIndex);
                setTargetIndexForVisibility(realItemIndex);
                previousActiveIndex.current = realItemIndex;
                
                // Clear wrap flag
                setTimeout(() => {
                  isManualWrapRef.current = false;
                }, 50);
              });
            } else {
              // Normal case: just update state
              activeVirtualIndexShared.value = targetIndex;
              targetActiveIndex.value = targetIndex;
              setActiveVirtualIndex(targetIndex);
              setTargetIndexForVisibility(targetIndex);
              previousActiveIndex.current = targetIndex;
            }
            
            setIsAnimating(false);
            
            // Clear the flag after animation completes
            setTimeout(() => {
              isInternalAnimationRef.current = false;
            }, 150);
            
            setTimeout(() => setIsScrolling(false), 100);
          }
        }
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.carouselWrapper}>
        {/* Show arrows only on desktop web */}
        {isDesktopWeb() && (
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
          initialScrollIndex={initialVirtualIndex >= 0 ? initialVirtualIndex : 1}
          getItemLayout={(_, index) => ({ length: carouselItemWidth, offset: carouselItemWidth * index, index })}
          snapToAlignment="center"
          snapToInterval={carouselItemWidth}
          decelerationRate="fast"
          contentContainerStyle={styles.carouselContent}
          contentInsetAdjustmentBehavior="never"
          onScrollToIndexFailed={(info) => {
            const wait = new Promise(resolve => setTimeout(resolve, 500));
            wait.then(() => {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
            });
          }}
          {...(Platform.OS === 'web' && { style: { overflowX: 'hidden' as any } as any })}
        />

        {/* Show arrows only on desktop web */}
        {isDesktopWeb() && (
          <TouchableOpacity style={[styles.arrowButton, styles.arrowButtonRight]} onPress={scrollToNext} activeOpacity={0.7}>
            <Ionicons name="chevron-forward" size={24} color={colors.textDark} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.labelContainer}>
        {renderDots()}
        <Text style={styles.boardName}>{boards[getRealIndex(activeVirtualIndex)]?.name || ''}</Text>
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
    justifyContent: 'flex-end', // Align boards to bottom to match dots alignment
    alignItems: 'center',
    paddingBottom: spacing.md + 8, // Align with dots (spacing.md marginTop of labelContainer + small gap)
    minHeight: 500, // Ensure full height for touchable area
    ...(isDesktopWeb() && {
      minHeight: 550, // Larger on desktop
      paddingBottom: spacing.md + 10,
    }),
    ...(Platform.OS === 'web' && { paddingHorizontal: 0 }),
  },
  boardContainer: {
    position: 'absolute' as any,
    bottom: spacing.md + 8, // Align with dots
    left: 0,
    right: 0,
    alignItems: 'center',
    ...(isDesktopWeb() && {
      bottom: spacing.md + 10,
    }),
  },
  boardWrapper: {
    justifyContent: 'flex-end', // Align board image to bottom
    alignItems: 'center',
  },
  boardTouchable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 500, // Ensure minimum touchable height
    ...(isDesktopWeb() && {
      minHeight: 550, // Larger on desktop
    }),
  },
  boardImage: {
    height: 450, // Much bigger boards
    ...(isDesktopWeb() && {
      height: 500, // Even larger on desktop
      // @ts-ignore
      objectFit: 'contain' as any,
    }),
    ...(Platform.OS === 'web' && !isDesktopWeb() && {
      height: 450,
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
