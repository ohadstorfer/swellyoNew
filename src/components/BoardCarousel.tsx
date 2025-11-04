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
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';

// Get screen width - update on resize for web
const getScreenWidth = () => Dimensions.get('window').width;

// On web, use a constrained width for better UX; on mobile, use full screen width
const getCarouselItemWidth = () => {
  const screenWidth = getScreenWidth();
  return Platform.OS === 'web' ? Math.min(screenWidth, 600) : screenWidth;
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
}: BoardCarouselProps) => {
  const flatListRef = useRef<FlatList<BoardType>>(null);
  const [carouselItemWidth, setCarouselItemWidth] = useState(getCarouselItemWidth());
  const [activeIndex, setActiveIndex] = useState(
    boards.findIndex((b: BoardType) => b.id === selectedBoardId) || 0
  );

  // Update carousel width on window resize (web)
  React.useEffect(() => {
    if (Platform.OS === 'web') {
      const updateWidth = () => {
        setCarouselItemWidth(getCarouselItemWidth());
      };
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

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const renderBoard = ({ item }: { item: BoardType }) => {
    const itemWidth = carouselItemWidth;
    const imageWidth = Platform.OS === 'web' 
      ? Math.min(itemWidth * 0.6, 400) 
      : getScreenWidth() * 0.5;
    
    return (
      <View style={[styles.carouselItem, { width: itemWidth }]}> 
        <Image
          source={{ uri: item.imageUrl }}
          style={[styles.boardImage, { width: imageWidth }]}
          resizeMode="contain"
        />
      </View>
    );
  };

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {boards.map((_board: BoardType, index: number) => (
        <View
          key={index}
          style={[
            styles.dot,
            index === activeIndex ? styles.dotActive : styles.dotInactive,
          ]}
        />
      ))}
    </View>
  );

  // Scroll to initial index on mount (especially important for web)
  React.useEffect(() => {
    if (flatListRef.current && activeIndex >= 0) {
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: activeIndex,
          animated: false,
          viewPosition: 0.5,
        });
      }, timeout);
    }
  }, []);

  // Update active index when selectedBoardId changes
  React.useEffect(() => {
    const newIndex = boards.findIndex((b: BoardType) => b.id === selectedBoardId);
    if (newIndex >= 0 && newIndex !== activeIndex && flatListRef.current) {
      setActiveIndex(newIndex);
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: newIndex,
          animated: Platform.OS !== 'web',
          viewPosition: 0.5,
        });
      }, timeout);
    }
  }, [selectedBoardId, boards, activeIndex]);

  const scrollToPrevious = () => {
    if (activeIndex > 0 && flatListRef.current) {
      const newIndex = activeIndex - 1;
      setActiveIndex(newIndex);
      onBoardSelect(boards[newIndex]);
      flatListRef.current.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
    }
  };

  const scrollToNext = () => {
    if (activeIndex < boards.length - 1 && flatListRef.current) {
      const newIndex = activeIndex + 1;
      setActiveIndex(newIndex);
      onBoardSelect(boards[newIndex]);
      flatListRef.current.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.carouselWrapper}>
        {Platform.OS === 'web' && activeIndex > 0 && (
          <TouchableOpacity
            style={styles.arrowButton}
            onPress={scrollToPrevious}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textDark} />
          </TouchableOpacity>
        )}

        <FlatList
          ref={flatListRef}
          data={boards}
          renderItem={renderBoard}
          keyExtractor={(item) => item.id.toString()}
          horizontal
          pagingEnabled={Platform.OS !== 'web'}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialScrollIndex={activeIndex >= 0 ? activeIndex : 0}
          getItemLayout={(data, index) => ({
            length: carouselItemWidth,
            offset: carouselItemWidth * index,
            index,
          })}
          snapToAlignment="center"
          snapToInterval={carouselItemWidth}
          decelerationRate="fast"
          contentContainerStyle={styles.carouselContent}
          onScrollToIndexFailed={(info) => {
            const wait = new Promise(resolve => setTimeout(resolve, 500));
            wait.then(() => {
              flatListRef.current?.scrollToOffset({ 
                offset: info.index * carouselItemWidth, 
                animated: false 
              });
            });
          }}
          {...(Platform.OS === 'web' && {
            // @ts-ignore - web-specific style prop
            style: { overflowX: 'hidden' as any },
          } as any)}
        />

        {Platform.OS === 'web' && activeIndex < boards.length - 1 && (
          <TouchableOpacity
            style={[styles.arrowButton, styles.arrowButtonRight]}
            onPress={scrollToNext}
            activeOpacity={0.7}
          >
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
    ...(Platform.OS === 'web' && {
      maxWidth: 600,
      alignSelf: 'center',
    }),
  },
  carouselWrapper: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    ...(Platform.OS === 'web' && {
      maxWidth: 600,
      alignSelf: 'center',
      // @ts-ignore - web-specific CSS
      WebkitOverflowScrolling: 'touch',
      // @ts-ignore
      scrollBehavior: 'smooth',
    }),
  },
  arrowButton: {
    position: 'absolute',
    left: Platform.OS === 'web' ? 10 : 0,
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
    right: Platform.OS === 'web' ? 10 : 0,
  },
  carouselContent: {
    alignItems: 'center',
    paddingVertical: Platform.OS === 'web' ? spacing.lg : 0,
    ...(Platform.OS === 'web' && {
      paddingLeft: 0,
      paddingRight: 0,
    }),
  },
  carouselItem: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    ...(Platform.OS === 'web' && {
      paddingHorizontal: 0,
    }),
  },
  boardImage: {
    height: 350,
    maxWidth: Platform.OS === 'web' ? 400 : undefined,
    ...(Platform.OS === 'web' && {
      // @ts-ignore
      objectFit: 'contain' as any,
      width: 400,
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
