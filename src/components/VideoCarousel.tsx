import React, { useRef, useState } from 'react';
import {
  View,
  FlatList,
  Image,
  Dimensions,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
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
  type ReorderedVideoItem = { item: VideoLevel; originalIndex: number };
  const flatListRef = useRef<FlatList<ReorderedVideoItem>>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Reorder videos array so selected item is in the middle
  const getReorderedVideos = React.useMemo((): ReorderedVideoItem[] => {
    const selectedIndex = videos.findIndex(v => v.id === selectedVideoId);
    if (selectedIndex < 0) {
      // If not found, return original order
      return videos.map((item, idx) => ({ item, originalIndex: idx }));
    }
    
    // Create array with selected item in the middle
    const middleIndex = Math.floor(videos.length / 2);
    const reordered: ReorderedVideoItem[] = [];
    
    // We want: reordered[middleIndex] = videos[selectedIndex]
    // Calculate how many positions to shift: we need selectedIndex to end up at middleIndex
    // If selectedIndex is 0 and middleIndex is 2, we need to shift right by 2
    // So: reordered[i] = videos[(i - (middleIndex - selectedIndex) + videos.length) % videos.length]
    const shift = middleIndex - selectedIndex;
    
    for (let i = 0; i < videos.length; i++) {
      // Calculate which original index should be at position i in reordered array
      const originalIdx = (i - shift + videos.length) % videos.length;
      reordered.push({
        item: videos[originalIdx],
        originalIndex: originalIdx,
      });
    }
    
    // Verify: reordered[middleIndex] should be videos[selectedIndex]
    // reordered[middleIndex] = videos[(middleIndex - shift + videos.length) % videos.length]
    // = videos[(middleIndex - (middleIndex - selectedIndex) + videos.length) % videos.length]
    // = videos[(selectedIndex + videos.length) % videos.length] = videos[selectedIndex] ✓
    
    return reordered;
  }, [videos, selectedVideoId]);

  const middleIndex = Math.floor(videos.length / 2);
  
  // Get the selected video directly from selectedVideoId
  const selectedVideo = React.useMemo(() => {
    return videos.find(v => v.id === selectedVideoId) || videos[0];
  }, [videos, selectedVideoId]);

  // Scroll to middle index when videos are reordered
  React.useEffect(() => {
    if (flatListRef.current && getReorderedVideos.length > 0) {
      const timeout = Platform.OS === 'web' ? 300 : 100;
      setTimeout(() => {
        const middleIdx = Math.floor(getReorderedVideos.length / 2);
        try {
          flatListRef.current?.scrollToIndex({
            index: middleIdx,
            animated: false,
            viewPosition: 0.5,
          });
        } catch (error) {
          // Fallback if scrollToIndex fails
          const baseWidth = 98;
          const gap = 12;
          const offset = middleIdx * (baseWidth + gap);
          flatListRef.current?.scrollToOffset({
            offset,
            animated: false,
          });
        }
      }, timeout);
    }
  }, [selectedVideoId, videos, containerWidth, getReorderedVideos]);

  const renderThumbnail = ({ item, index }: { item: ReorderedVideoItem; index: number }) => {
    // The middle item should be the selected one - verify by checking if it matches selectedVideoId
    const isActive = item.item.id === selectedVideoId;
    
    return (
      <TouchableOpacity
        onPress={() => {
          // Update selection - this will trigger reordering via getReorderedVideos
          onVideoSelect(item.item);
        }}
        style={[
          styles.thumbnail,
          isActive && styles.thumbnailActive,
        ]}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: item.item.thumbnailUrl }}
          style={styles.thumbnailImage}
          resizeMode="cover"
        />
        {isActive && <View style={styles.activeBorder} />}
      </TouchableOpacity>
    );
  };

  const renderDots = () => {
    const selectedIndex = videos.findIndex(v => v.id === selectedVideoId);
    return (
      <View style={styles.dotsContainer}>
        {videos.map((_video: VideoLevel, index: number) => (
          <View
            key={index}
            style={[styles.dot, index === selectedIndex ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>
    );
  };

  if (!videos || videos.length === 0) {
    return <View style={{ alignItems: 'center', padding: spacing.lg }}><Text>No videos available</Text></View>;
  }

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
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)']}
            locations={[0.80097, 0.25243]}
            start={{ x: 0, y: 0.80097 }}
            end={{ x: 0, y: 0.25243 }}
            style={styles.gradientOverlay}
          />
          
          {/* Frame Border SVG */}
          <Svg style={styles.frameBorder} width="100%" height="100%" viewBox="0 0 344 328" fill="none" preserveAspectRatio="none">
            <Path 
              d="M86.8411 2H26C12.7452 2 2 12.7452 2 26V82.9884M256.523 2H317.365C330.619 2 341.365 12.7452 341.365 26V82.9884M341.365 244.965V301.953C341.365 315.208 330.619 325.953 317.365 325.953H256.523M86.8411 325.953H26C12.7452 325.953 2 315.208 2 301.953V244.965" 
              stroke="white" 
              strokeWidth="4"
            />
          </Svg>
          
          {/* Recording Indicator */}
          <View style={styles.recIcon}>
            <Svg width="11" height="15.43" viewBox="0 0 11 15.43" fill="none">
              <Circle cx="5" cy="7.715" r="5" fill="#EB4C43"/>
            </Svg>
          </View>
          
          {/* Video Title */}
          <View style={styles.titleContainer}>
            <Text style={styles.videoTitle}>{selectedVideo.name}</Text>
          </View>
        </View>
      </View>

      {/* Thumbnails Carousel */}
      <View style={styles.thumbnailsSection}>
        <View 
          style={styles.thumbnailsWrapper}
          onLayout={(event) => {
            const { width } = event.nativeEvent.layout;
            if (width > 0 && width !== containerWidth) {
              setContainerWidth(width);
            }
          }}
          collapsable={false}
        >
          <FlatList
            ref={flatListRef}
            data={getReorderedVideos}
            renderItem={renderThumbnail}
            keyExtractor={(item, index) => `video-${item.originalIndex}-${index}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.floor(getReorderedVideos.length / 2)}
            getItemLayout={(_, index) => {
              const baseWidth = 98;
              const gap = 12;
              return {
                length: baseWidth + gap,
                offset: index * (baseWidth + gap),
                index,
              };
            }}
            snapToAlignment="center"
            snapToInterval={Platform.OS === 'web' ? undefined : 110}
            decelerationRate="fast"
            contentContainerStyle={[
              styles.thumbnailsList,
              containerWidth > 0 && {
                // Add padding to allow items to scroll to center
                // Padding should be (containerWidth - activeItemWidth) / 2
                paddingLeft: Platform.OS === 'web' 
                  ? spacing.lg 
                  : Math.max((containerWidth - 119) / 2, spacing.md),
                paddingRight: Platform.OS === 'web' 
                  ? spacing.lg 
                  : Math.max((containerWidth - 119) / 2, spacing.md),
              },
            ]}
            onScrollToIndexFailed={(info) => {
              const wait = new Promise(resolve => setTimeout(resolve, 500));
              wait.then(() => {
                const baseWidth = 98;
                const gap = 12;
                flatListRef.current?.scrollToOffset({
                  offset: info.index * (baseWidth + gap),
                  animated: false,
                });
              });
            }}
            bounces={false}
            alwaysBounceHorizontal={false}
            {...(Platform.OS === 'web' && { style: { overflow: 'hidden' } as any })}
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
    gap: 32,
    width: '100%',
    maxWidth: '100%',
  },
  mainVideoContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: Platform.OS === 'web' ? 26 : 16,
    maxWidth: '100%',
  },
  videoWrapper: {
    width: Platform.OS === 'web' 
      ? Math.min(340, getScreenWidth() - 52) 
      : Math.min(340, getScreenWidth() - 32),
    aspectRatio: 340 / 324,
    maxWidth: 340,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  mainVideo: {
    width: '100%',
    height: '100%',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
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
    width: 11,
    height: 15.43,
  },
  titleContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  videoTitle: {
    color: '#FFF',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  thumbnailsSection: {
    width: '100%',
    alignItems: 'center',
    gap: 32,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  thumbnailsWrapper: {
    width: '100%',
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbnailsList: {
    gap: 12,
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Padding will be set dynamically in contentContainerStyle based on containerWidth
  },
  thumbnail: {
    width: 98,
    height: 66,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    opacity: 0.5,
  },
  thumbnailActive: {
    width: 119,
    height: 80,
    opacity: 1,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailImageInactive: {
    opacity: 1,
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
    backgroundColor: '#0788B0',
  },
  dotInactive: {
    width: 8,
    backgroundColor: '#CFCFCF',
  },
});
