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
import Svg, { Path, Circle, G, Defs, ClipPath, Rect } from 'react-native-svg';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';

const getScreenWidth = () => Dimensions.get('window').width;

export interface VideoLevel {
  id: number;
  name: string;
  thumbnailUrl: string;
  videoUrl?: string;
}

interface VideoCarouselProps {
  videos: VideoLevel[];
  selectedVideoId: number;
  onVideoSelect: (video: VideoLevel) => void;
}

export const VideoCarousel: React.FC<VideoCarouselProps> = ({
  videos,
  selectedVideoId,
  onVideoSelect,
}) => {
  const flatListRef = useRef<FlatList<VideoLevel>>(null);
  const initialIndex = (() => {
    const idx = videos.findIndex((v: VideoLevel) => v.id === selectedVideoId);
    return idx >= 0 ? idx : 0;
  })();
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      const index = viewableItems[0].index as number;
      const clamped = Math.min(Math.max(index, 0), Math.max(videos.length - 1, 0));
      setActiveIndex(clamped);
      if (videos[clamped]) onVideoSelect(videos[clamped]);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  // Scroll to initial index
  React.useEffect(() => {
    if (flatListRef.current && activeIndex >= 0) {
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: Math.min(Math.max(activeIndex, 0), Math.max(videos.length - 1, 0)),
          animated: false
        });
      }, timeout);
    }
  }, [videos?.length]);

  // Keep in sync if parent selection changes
  React.useEffect(() => {
    const idx = videos.findIndex(v => v.id === selectedVideoId);
    const newIndex = idx >= 0 ? idx : 0;
    if (newIndex !== activeIndex) {
      setActiveIndex(newIndex);
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: Platform.OS !== 'web' });
    }
  }, [selectedVideoId, videos]);

  const renderThumbnail = ({ item, index }: { item: VideoLevel; index: number }) => {
    const isActive = index === activeIndex;
    return (
      <TouchableOpacity
        onPress={() => {
          setActiveIndex(index);
          onVideoSelect(item);
          flatListRef.current?.scrollToIndex({ index, animated: true });
        }}
        style={[
          styles.thumbnail,
          isActive && styles.thumbnailActive,
        ]}
      >
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={[
            styles.thumbnailImage,
            !isActive && styles.thumbnailImageInactive,
          ]}
          resizeMode="cover"
        />
        {isActive && <View style={styles.activeBorder} />}
      </TouchableOpacity>
    );
  };

  const renderDots = () => (
    <View style={styles.dotsContainer}>
      {videos.map((_video: VideoLevel, index: number) => (
        <View
          key={index}
          style={[styles.dot, index === activeIndex ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  );

  if (!videos || videos.length === 0) {
    return <View style={{ alignItems: 'center', padding: spacing.lg }}><Text>No videos available</Text></View>;
  }
  const safeIndex = Math.min(Math.max(activeIndex, 0), videos.length - 1);
  const selectedVideo = videos[safeIndex] || videos[0];

  return (
    <View style={styles.container}>
      {/* Main Video Display */}
      <View style={styles.mainVideoContainer}>
        <View style={styles.videoWrapper}>
          <Image
            source={{ uri: selectedVideo.thumbnailUrl }}
            style={styles.mainVideo}
            resizeMode="cover"
          />
          
          {/* Gradient Overlay */}
          <View style={styles.gradientOverlay} />
          
          {/* Frame Border SVG */}
          <Svg style={styles.frameBorder} width="100%" height="100%" viewBox="0 0 344 328" fill="none">
            <Path 
              d="M86.8411 2H26C12.7452 2 2 12.7452 2 26V82.9884M256.523 2H317.365C330.619 2 341.365 12.7452 341.365 26V82.9884M341.365 244.965V301.953C341.365 315.208 330.619 325.953 317.365 325.953H256.523M86.8411 325.953H26C12.7452 325.953 2 315.208 2 301.953V244.965" 
              stroke="white" 
              strokeWidth="4"
            />
          </Svg>
          
          {/* Recording Indicator */}
          <Svg style={styles.recIcon} width="11" height="16" viewBox="0 0 11 16" fill="none">
            <Circle cx="5" cy="8" r="5" fill="#EB4C43"/>
          </Svg>
          
          {/* Video Title */}
          <View style={styles.titleContainer}>
            <Text style={styles.videoTitle}>{selectedVideo.name}</Text>
          </View>
        </View>
      </View>

      {/* Thumbnails Carousel */}
      <View style={styles.thumbnailsSection}>
        <View style={styles.thumbnailsWrapper}>
          <FlatList
            ref={flatListRef}
            data={videos}
            renderItem={renderThumbnail}
            keyExtractor={(item) => item.id.toString()}
            horizontal
            showsHorizontalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            contentContainerStyle={styles.thumbnailsList}
            snapToInterval={Platform.OS === 'web' ? undefined : 110}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              length: 110,
              offset: 110 * index,
              index,
            })}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                flatListRef.current?.scrollToOffset({ 
                  offset: info.index * 110, 
                  animated: false 
                });
              }, 500);
            }}
          />
        </View>
        
        {/* Dots Indicator */}
        {renderDots()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.xl,
  },
  mainVideoContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  videoWrapper: {
    width: Platform.OS === 'web' ? Math.min(getScreenWidth() - 52, 500) : getScreenWidth() - 52,
    aspectRatio: 340 / 324,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  mainVideo: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  frameBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  recIcon: {
    position: 'absolute',
    top: 31,
    right: 31,
  },
  titleContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  videoTitle: {
    color: '#FFF',
    fontFamily: 'Montserrat',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  thumbnailsSection: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.lg,
  },
  thumbnailsWrapper: {
    width: '100%',
  },
  thumbnailsList: {
    paddingHorizontal: Platform.OS === 'web' ? spacing.lg : (getScreenWidth() - 110 * 3 - 24) / 2,
    gap: 12,
  },
  thumbnail: {
    width: 98,
    height: 66,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnailActive: {
    width: 119,
    height: 80,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailImageInactive: {
    opacity: 0.5,
  },
  activeBorder: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 8,
    borderWidth: 4,
    borderColor: '#05BCD3',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
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
});
