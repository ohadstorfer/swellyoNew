import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  FlatList,
  Image,
  Dimensions,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';

const getScreenWidth = () => Dimensions.get('window').width;

// Helper to detect if we're on desktop web (not mobile web)
const isDesktopWeb = () => {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return window.innerWidth > 768; // Desktop breakpoint
};

export interface VideoLevel {
  id: number;
  name: string;
  thumbnailUrl: string;
  videoUrl?: string;
}

// Animated Thumbnail Component
interface AnimatedThumbnailProps {
  item: VideoLevel;
  isActive: boolean;
  selectedVideoId: number;
  videos: VideoLevel[];
  onPress: () => void;
  baseStyle: any;
  activeStyle: any;
  imageStyle: any;
  borderStyle: any;
}

const AnimatedThumbnail: React.FC<AnimatedThumbnailProps> = ({ 
  item, 
  isActive, 
  selectedVideoId,
  videos,
  onPress, 
  baseStyle,
  activeStyle,
  imageStyle,
  borderStyle,
}) => {
  const opacity = useRef(new Animated.Value(isActive ? 1 : 0.5)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const prevSelectedId = useRef(selectedVideoId);
  const isInitialMount = useRef(true);
  
  // Slide animation when selectedVideoId changes (Figma Smart Animate style)
  useEffect(() => {
    // Skip animation on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevSelectedId.current = selectedVideoId;
      return;
    }
    
    // Only animate if selectedVideoId actually changed
    if (prevSelectedId.current === selectedVideoId) {
      return;
    }
    
    const currentIndex = videos.findIndex(v => v.id === selectedVideoId);
    const prevIndex = videos.findIndex(v => v.id === prevSelectedId.current);
    const itemIndex = videos.findIndex(v => v.id === item.id);
    
    // Determine slide direction based on movement
    let slideDirection = 0;
    if (currentIndex !== prevIndex && currentIndex !== -1 && prevIndex !== -1) {
      // Moving forward (right) - new active slides in from right, old active slides out to left
      if (currentIndex > prevIndex) {
        if (itemIndex === currentIndex) {
          // New active item - slide in from right
          slideDirection = 60;
        } else if (itemIndex === prevIndex) {
          // Old active item - slide out to left
          slideDirection = -60;
        }
      } 
      // Moving backward (left) - new active slides in from left, old active slides out to right
      else if (currentIndex < prevIndex) {
        if (itemIndex === currentIndex) {
          // New active item - slide in from left
          slideDirection = -60;
        } else if (itemIndex === prevIndex) {
          // Old active item - slide out to right
          slideDirection = 60;
        }
      }
    }
    
    // Set initial values before animation
    if (slideDirection !== 0) {
      translateX.setValue(slideDirection);
    }
    opacity.setValue(isActive ? 0.4 : 0.3);
    
    // Animate with ease-in curve, 350ms duration (matching Figma Smart Animate)
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: isActive ? 1 : 0.5,
        duration: 350,
        easing: Easing.in(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: 350,
        easing: Easing.in(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
    
    prevSelectedId.current = selectedVideoId;
  }, [selectedVideoId, isActive, item.id, videos]);
  
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Animated.View
        style={[
          baseStyle,
          isActive && activeStyle,
          isActive && borderStyle, // Apply border directly to thumbnail container
          {
            opacity,
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Use image for thumbnails - thumbnailUrl should point to actual image files */}
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={imageStyle}
          resizeMode="cover"
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

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
  const fadeAnim = useRef(new Animated.Value(1)).current;

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

  // Create video player for main video
  const mainVideoPlayer = useVideoPlayer(
    selectedVideo.videoUrl || '',
    (player: any) => {
      if (player && selectedVideo.videoUrl) {
        try {
          player.loop = true;
          player.muted = true;
          player.play();
        } catch (error) {
          console.error('Error initializing video player:', error);
        }
      }
    }
  );

  // Update player source when video changes
  useEffect(() => {
    if (selectedVideo.videoUrl && mainVideoPlayer) {
      const videoUrl = selectedVideo.videoUrl;
      if (!videoUrl) {
        console.warn('No video URL provided for:', selectedVideo.name);
        return;
      }
      
      mainVideoPlayer.replaceAsync(videoUrl).then(() => {
        if (mainVideoPlayer) {
          mainVideoPlayer.loop = true;
          mainVideoPlayer.muted = true;
          try {
            mainVideoPlayer.play();
          } catch (playError: any) {
            console.error('Error playing video:', playError);
          }
        }
      }).catch((error: any) => {
        console.error('Error replacing video:', error, 'URL:', videoUrl);
      });
    }
  }, [selectedVideo.videoUrl, selectedVideo.name, mainVideoPlayer]);

  // Fade animation for main video change
  useEffect(() => {
    // Fade out then in
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 900,
      easing: Easing.ease,
      useNativeDriver: false,
    }).start();
  }, [selectedVideoId, selectedVideo.videoUrl]);

  // Scroll to middle index when videos are reordered
  React.useEffect(() => {
    if (flatListRef.current && getReorderedVideos.length > 0 && containerWidth > 0) {
      const scrollToCenter = () => {
        const middleIdx = Math.floor(getReorderedVideos.length / 2);
        const baseWidth = 98;
        const activeWidth = 119;
        const gap = 12;
        
        // Calculate offset to center the middle item (which is the selected one)
        // The middle item is at index middleIdx in the reordered array
        // We need to calculate its position and center it
        let offset = 0;
        
        // Calculate offset for items before the middle one
        for (let i = 0; i < middleIdx; i++) {
          offset += baseWidth + gap;
        }
        
        // Add half of the middle item's width (it's active, so use activeWidth)
        // Then subtract half of container width to center it
        const itemCenter = offset + (activeWidth / 2);
        const containerCenter = containerWidth / 2;
        const scrollOffset = itemCenter - containerCenter;
        
        // Account for padding
        const paddingLeft = isDesktopWeb()
          ? Math.max((containerWidth - activeWidth) / 2, spacing.lg)
          : Math.max((containerWidth - activeWidth) / 2, spacing.md);
        const finalOffset = scrollOffset + paddingLeft;
        
        try {
          flatListRef.current?.scrollToIndex({
            index: middleIdx,
            animated: true,
            viewPosition: 0.5,
          });
        } catch (error) {
          // Fallback: use scrollToOffset with calculated position
          flatListRef.current?.scrollToOffset({
            offset: Math.max(0, finalOffset),
            animated: true,
          });
        }
      };
      
      // Use requestAnimationFrame for web to ensure smooth scrolling
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            setTimeout(scrollToCenter, 50);
          });
        } else {
          setTimeout(scrollToCenter, 50);
        }
      } else {
        setTimeout(scrollToCenter, 50);
      }
    }
  }, [selectedVideoId, videos, containerWidth, getReorderedVideos]);

  const renderThumbnail = ({ item, index }: { item: ReorderedVideoItem; index: number }) => {
    // The middle item should be the selected one - verify by checking if it matches selectedVideoId
    const isActive = item.item.id === selectedVideoId;
    
    return (
      <AnimatedThumbnail
        item={item.item}
        isActive={isActive}
        selectedVideoId={selectedVideoId}
        videos={videos}
        onPress={() => {
          // Update selection - this will trigger reordering via getReorderedVideos
          onVideoSelect(item.item);
        }}
        baseStyle={styles.thumbnail}
        activeStyle={styles.thumbnailActive}
        imageStyle={styles.thumbnailImage}
        borderStyle={styles.activeBorder}
      />
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
          <Animated.View
            style={[
              styles.mainVideo,
              {
                opacity: fadeAnim,
              },
            ]}
          >
            {selectedVideo.videoUrl ? (
              <VideoView
                player={mainVideoPlayer}
                style={styles.videoPlayer}
                contentFit="cover"
                nativeControls={false}
                allowsFullscreen={false}
                allowsPictureInPicture={false}
              />
            ) : (
              <Image
                source={{ uri: selectedVideo.thumbnailUrl }}
                style={styles.videoPlayer}
                resizeMode="cover"
              />
            )}
          </Animated.View>
          
          {/* Gradient Overlay */}
          {/* <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)']}
            locations={[0.80097, 0.25243]}
            start={{ x: 0, y: 0.80097 }}
            end={{ x: 0, y: 0.25243 }}
            style={styles.gradientOverlay}
          /> */}
          
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
              const activeWidth = 119;
              // Calculate offset: sum of all previous items
              let offset = 0;
              for (let i = 0; i < index; i++) {
                // Check if this is the active item (middle index)
                const isActive = i === Math.floor(getReorderedVideos.length / 2);
                offset += (isActive ? activeWidth : baseWidth) + gap;
              }
              // Current item width
              const isActive = index === Math.floor(getReorderedVideos.length / 2);
              const currentWidth = isActive ? activeWidth : baseWidth;
              return {
                length: currentWidth + gap,
                offset: offset,
                index,
              };
            }}
            snapToAlignment="center"
            snapToInterval={Platform.OS === 'web' ? undefined : 110}
            decelerationRate="fast"
            pagingEnabled={false}
            scrollEnabled={true}
            contentContainerStyle={[
              styles.thumbnailsList,
              containerWidth > 0 && {
                // Add padding to allow items to scroll to center
                // Padding should be (containerWidth - activeItemWidth) / 2
                paddingLeft: isDesktopWeb()
                  ? Math.max((containerWidth - 119) / 2, spacing.lg)
                  : Math.max((containerWidth - 119) / 2, spacing.md),
                paddingRight: isDesktopWeb()
                  ? Math.max((containerWidth - 119) / 2, spacing.lg)
                  : Math.max((containerWidth - 119) / 2, spacing.md),
              },
            ]}
             onScrollToIndexFailed={(info) => {
               const wait = new Promise(resolve => setTimeout(resolve, 100));
               wait.then(() => {
                 const baseWidth = 98;
                 const activeWidth = 119;
                 const gap = 12;
                 const middleIdx = Math.floor(getReorderedVideos.length / 2);
                 
                 // Calculate offset to center the middle item
                 let offset = 0;
                 for (let i = 0; i < middleIdx; i++) {
                   offset += baseWidth + gap;
                 }
                 
                 const itemCenter = offset + (activeWidth / 2);
                 const containerCenter = containerWidth > 0 ? containerWidth / 2 : 0;
                 const scrollOffset = itemCenter - containerCenter;
                 
                 flatListRef.current?.scrollToOffset({
                   offset: Math.max(0, scrollOffset),
                   animated: true,
                 });
               });
             }}
            bounces={false}
            alwaysBounceHorizontal={false}
            {...(Platform.OS === 'web' && { 
              style: { 
                overflow: 'hidden',
                WebkitOverflowScrolling: 'touch' as any,
              } as any,
              // Enable smooth scrolling on web
              scrollEventThrottle: 16,
            })}
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
    width: '100%',
    maxWidth: '100%',
    ...(isDesktopWeb() && {
      maxWidth: 600,
      alignSelf: 'center',
      overflow: 'visible',
    }),
  },
  mainVideoContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 16, // Native mobile and mobile web: same as mobile web
    ...(isDesktopWeb() && {
      paddingHorizontal: 26,
      overflow: 'visible',
      marginBottom: 8, // Desktop: reduced spacing
      paddingTop: 8, // Desktop: minimal top padding
    }),
  },
  videoWrapper: {
    width: Math.min(340, getScreenWidth() - 32), // Mobile: full width
    aspectRatio: 340 / 324, // Mobile: original aspect ratio
    maxWidth: 340, // Mobile: original max width
    minWidth: 280,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
    alignSelf: 'center',
    ...(isDesktopWeb() && {
      width: Math.min(300, getScreenWidth() - 52), // Desktop: smaller
      aspectRatio: 300 / 286, // Desktop: slightly smaller
      maxWidth: 300, // Desktop: smaller max width
    }),
  },
  mainVideo: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      // Apply to all web (desktop and mobile web)
      objectFit: 'cover' as any,
      objectPosition: 'center center' as any,
    }),
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    opacity: 0.2,
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
    paddingHorizontal: 0,
    overflow: 'hidden',
    marginTop: 100, // Native mobile and mobile web: same as mobile web
    ...(isDesktopWeb() && {
      // Desktop web only
      overflow: 'visible',
      marginTop: 16, // Desktop: reduced spacing
      marginBottom: 8, // Desktop: minimal bottom margin
    }),
  },
  thumbnailsWrapper: {
    width: '100%',
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden', // Mobile: keep original
    ...(isDesktopWeb() && {
      overflow: 'visible',
      minHeight: 80, // Ensure full height is visible
    }),
  },
  thumbnailsList: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Gap is handled by marginRight on thumbnails
    // Padding will be set dynamically in contentContainerStyle based on containerWidth
  },
  thumbnail: {
    width: 98,
    height: 66,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 12,
  },
  thumbnailActive: {
    width: 119,
    height: 80,
    overflow: 'visible', // Allow border to be visible
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8, // Match the thumbnail border radius
  },
  thumbnailImageInactive: {
    opacity: 1,
  },
  activeBorder: {
    borderWidth: 4,
    borderColor: '#05BCD3',
    borderRadius: 16, // More rounded border
    // Border is drawn on the element itself, so it will be visible
    // even with overflow: hidden on the container
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16, // Native mobile and mobile web: same as mobile web
    ...(isDesktopWeb() && {
      marginTop: 16, // Desktop: reduced spacing
      marginBottom: 8, // Desktop: minimal bottom margin
    }),
  },
  dot: {
    height: 8,
    borderRadius: 4,
    marginHorizontal: 3,
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

