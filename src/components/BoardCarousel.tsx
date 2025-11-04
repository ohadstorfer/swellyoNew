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

const SCREEN_WIDTH = Dimensions.get('window').width;
const CAROUSEL_ITEM_WIDTH = Platform.OS === 'web' ? Math.min(SCREEN_WIDTH, 600) : SCREEN_WIDTH;

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
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(
    boards.findIndex((b: BoardType) => b.id === selectedBoardId) || 0
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      const index = viewableItems[0].index;
      setActiveIndex(index);
      onBoardSelect(boards[index]);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const renderBoard = ({ item }: { item: BoardType }) => {
    const imageWidth = Platform.OS === 'web' ? Math.min(CAROUSEL_ITEM_WIDTH * 0.6, 400) : SCREEN_WIDTH * 0.5;
    return (
      <View style={[styles.carouselItem, { width: CAROUSEL_ITEM_WIDTH }]}>
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
      {boards.map((_, index: number) => (
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

  const scrollToPrevious = () => {
    if (activeIndex > 0 && flatListRef.current) {
      const newIndex = activeIndex - 1;
      flatListRef.current.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
    }
  };

  const scrollToNext = () => {
    if (activeIndex < boards.length - 1 && flatListRef.current) {
      const newIndex = activeIndex + 1;
      flatListRef.current.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
    }
  };

  React.useEffect(() => {
    if (flatListRef.current && activeIndex >= 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: activeIndex, animated: false, viewPosition: 0.5 });
      }, Platform.OS === 'web' ? 300 : 100);
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.carouselWrapper}>
        {Platform.OS === 'web' && activeIndex > 0 && (
          <TouchableOpacity style={styles.arrowButton} onPress={scrollToPrevious} activeOpacity={0.7}>
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
          getItemLayout={(_, index) => ({
            length: CAROUSEL_ITEM_WIDTH,
            offset: CAROUSEL_ITEM_WIDTH * index,
            index,
          })}
          snapToAlignment="center"
          snapToInterval={CAROUSEL_ITEM_WIDTH}
          decelerationRate="fast"
          contentContainerStyle={styles.carouselContent}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToOffset({ offset: info.index * CAROUSEL_ITEM_WIDTH, animated: false });
            }, 500);
          }}
        />
        {Platform.OS === 'web' && activeIndex < boards.length - 1 && (
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
    ...(Platform.OS === 'web' && { maxWidth: 600, alignSelf: 'center' }),
  },
  carouselWrapper: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    ...(Platform.OS === 'web' && { maxWidth: 600, alignSelf: 'center' }),
  },
  carouselContent: {
    alignItems: 'center',
    paddingVertical: Platform.OS === 'web' ? spacing.lg : 0,
  },
  carouselItem: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  boardImage: {
    height: 350,
    maxWidth: Platform.OS === 'web' ? 400 : undefined,
  },
  labelContainer: {
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: '#0788B0',
  },
  dotInactive: {
    width: 8,
    backgroundColor: '#CFCFCF',
  },
  boardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
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
});

