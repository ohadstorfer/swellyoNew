import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  Image,
  Dimensions,
  StyleSheet,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ViewToken,
} from 'react-native';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CAROUSEL_ITEM_WIDTH = SCREEN_WIDTH;

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
    boards.findIndex(b => b.id === selectedBoardId) || 0
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

  const renderBoard = ({ item }: { item: BoardType }) => (
    <View style={styles.carouselItem}>
      <Image
        source={{ uri: item.imageUrl }}
        style={styles.boardImage}
        resizeMode="contain"
      />
    </View>
  );

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {boards.map((_, index) => (
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

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={boards}
        renderItem={renderBoard}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialScrollIndex={activeIndex}
        getItemLayout={(data, index) => ({
          length: CAROUSEL_ITEM_WIDTH,
          offset: CAROUSEL_ITEM_WIDTH * index,
          index,
        })}
        snapToAlignment="center"
        decelerationRate="fast"
      />
      
      <View style={styles.labelContainer}>
        {renderDots()}
        <Text style={styles.boardName}>{boards[activeIndex]?.name}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carouselItem: {
    width: CAROUSEL_ITEM_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  boardImage: {
    width: SCREEN_WIDTH * 0.5,
    height: 350,
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
});
