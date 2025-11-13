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
  const flatListRef = useRef<FlatList<VideoLevel>>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const thumbnailFadeAnim = useRef(new Animated.Value(1)).current;
  
  // Get the selected video directly from selectedVideoId
  const selectedVideo = React.useMemo(() => {
    return videos.find(v => v.id === selectedVideoId) || videos[0];
  }, [videos, selectedVideoId]);

  // Reorder videos array so selected item is in the middle
  // On desktop: [2ndPrev, prev, selected, next, 2ndNext] (5 items)
  // On mobile: [prev, selected, next] (3 items - hide 2nd prev/next)
  const reorderedVideos = React.useMemo(() => {
    if (videos.length === 0) return [];
    
    const selectedIndex = videos.findIndex(v => v.id === selectedVideoId);
    if (selectedIndex < 0) return videos;
    
    const reordered: VideoLevel[] = [];
    
    // Helper function to get index with wrapping
    const getWrappedIndex = (index: number, length: number): number => {
      if (index < 0) return length + index;
      if (index >= length) return index - length;
      return index;
    };
    
    // On mobile, only show 3 items (prev, selected, next)
    // On desktop, show 5 items (2ndPrev, prev, selected, next, 2ndNext)
    const showOuterItems = true;
    
    if (showOuterItems) {
      // Desktop: Show 5 items
      // Get 2nd previous item (wrapping around if needed)
      const secondPrevIndex = getWrappedIndex(selectedIndex - 2, videos.length);
      reordered.push(videos[secondPrevIndex]);
    }
    
    // Get previous item (or last if selected is first)
    const prevIndex = getWrappedIndex(selectedIndex - 1, videos.length);
    reordered.push(videos[prevIndex]);
    
    // Add selected item in the middle
    reordered.push(videos[selectedIndex]);
    
    // Get next item (or first if selected is last)
    const nextIndex = getWrappedIndex(selectedIndex + 1, videos.length);
    reordered.push(videos[nextIndex]);
    
    if (showOuterItems) {
      // Desktop: Show 2nd next item
      // Get 2nd next item (wrapping around if needed)
      const secondNextIndex = getWrappedIndex(selectedIndex + 2, videos.length);
      reordered.push(videos[secondNextIndex]);
    }
    
    return reordered;
  }, [videos, selectedVideoId]);

  // The selected item is always at index 2 in the reordered array (middle of 5 items)
  // Array structure: [0: 2ndPrev, 1: Prev, 2: Selected, 3: Next, 4: 2ndNext]
  const centerIndex = 2;

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

  // Fade animation for thumbnails when selection changes
  useEffect(() => {
    // Fade out then in (same as main video)
    thumbnailFadeAnim.setValue(0);
    Animated.timing(thumbnailFadeAnim, {
      toValue: 1,
      duration: 900,
      easing: Easing.ease,
      useNativeDriver: false,
    }).start();
  }, [selectedVideoId]);

  // Scroll to center whenever selection changes
  React.useEffect(() => {
    if (!flatListRef.current || reorderedVideos.length === 0 || containerWidth === 0) return;

    const scrollToCenter = () => {
      try {
        // Scroll to centerIndex (2 on desktop, 1 on mobile)
        flatListRef.current?.scrollToIndex({
          index: centerIndex,
          animated: true,
          viewPosition: 0.5, // Center the item
        });
      } catch (error) {
        // Retry after a delay if it fails
        setTimeout(() => {
          try {
            flatListRef.current?.scrollToIndex({
              index: centerIndex,
              animated: true,
              viewPosition: 0.5,
            });
          } catch (e) {
            // Final fallback: manual offset calculation
            const itemWidth = isDesktopWeb() ? 119 + 12 : 119 + 4; // Desktop: 131px, Mobile: 123px
            const padding = Math.max((containerWidth - 119) / 2, spacing.md);
            const itemCenter = (centerIndex * itemWidth) + (itemWidth / 2);
            const containerCenter = containerWidth / 2;
            const scrollOffset = itemCenter - containerCenter;
            
            try {
              flatListRef.current?.scrollToOffset({
                offset: Math.max(0, scrollOffset + padding),
                animated: true,
              });
            } catch (finalError) {
              console.warn('Failed to scroll to center:', finalError);
            }
          }
        }, 100);
      }
    };

    // Wait for layout to be ready
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(() => {
          setTimeout(scrollToCenter, 50);
        });
      } else {
        setTimeout(scrollToCenter, 100);
      }
    } else {
      setTimeout(scrollToCenter, 100);
    }
  }, [selectedVideoId, reorderedVideos, containerWidth, centerIndex]);

  const renderThumbnail = ({ item, index }: { item: VideoLevel; index: number }) => {
    const isActive = index === centerIndex;
    // On desktop, index 0 and 4 are outer items (2nd prev and 2nd next)
    // On mobile, these don't exist (only 3 items shown)
    const isOuter = isDesktopWeb() && (index === 0 || index === 4);
    
    return (
      <Animated.View
        style={[
          styles.thumbnailCarouselItem,
          isOuter && styles.thumbnailCarouselItemOuter,
          {
            opacity: thumbnailFadeAnim,
          },
        ]}
      >
        <AnimatedThumbnail
          item={item}
          isActive={isActive}
          selectedVideoId={selectedVideoId}
          videos={videos}
          onPress={() => {
            onVideoSelect(item);
          }}
          baseStyle={styles.thumbnail}
          activeStyle={styles.thumbnailActive}
          imageStyle={styles.thumbnailImage}
          borderStyle={styles.activeBorder}
        />
      </Animated.View>
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
            data={reorderedVideos}
            renderItem={renderThumbnail}
            keyExtractor={(item, index) => `video-${item.id}-${index}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToAlignment="center"
            snapToInterval={isDesktopWeb() ? 119 + 12 : 119 + 4} // Active width + gap for snapping (12px desktop, 4px mobile)
            decelerationRate="fast"
            pagingEnabled={false}
            scrollEnabled={true}
            initialScrollIndex={centerIndex}
            getItemLayout={(_, index) => {
              // Use consistent item width for layout calculations
              // Desktop: 119px + 12px gap = 131px, Mobile: 119px + 4px gap = 123px
              const itemWidth = isDesktopWeb() ? 119 + 12 : 119 + 4;
              return {
                length: itemWidth,
                offset: itemWidth * index,
                index,
              };
            }}
            contentContainerStyle={[
              styles.thumbnailsList,
              containerWidth > 0 && {
                // Add padding to center the widest thumbnail (119px active)
                // This ensures the selected thumbnail (at index 1) is centered
                paddingHorizontal: Math.max((containerWidth - 119) / 2, spacing.md),
              },
            ]}
            onScrollToIndexFailed={(info) => {
              // Retry after layout is ready
              setTimeout(() => {
                try {
                  flatListRef.current?.scrollToIndex({
                    index: centerIndex,
                    animated: true,
                    viewPosition: 0.5,
                  });
                } catch (e) {
                  console.warn('Failed to scroll to center after retry:', e);
                }
              }, 100);
            }}
            {...(Platform.OS === 'web' && { 
              style: { 
                overflow: 'hidden',
                WebkitOverflowScrolling: 'touch' as any,
              } as any,
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
  thumbnailCarouselItem: {
    // Mobile: smaller gap (4px), Desktop: larger gap (12px)
    width: isDesktopWeb() ? 119 + 12 : 119 , // Active thumbnail width + gap
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 0, // No extra padding, gap is handled by container width
  },
  thumbnailCarouselItemOuter: {
    // Outer items (2nd prev and 2nd next) should be slightly visible
    // Only on desktop web
    opacity: 0.3, // Make them semi-transparent
    transform: [{ scale: 0.85 }], // Slightly smaller
    ...(isDesktopWeb() && {
      // On desktop, reduce the gap between outer items and adjacent items
      // This makes the gap between 2nd prev/next and prev/next equal to the gap between prev/next and center
      marginHorizontal: -20,// Negative margin to reduce gap (half of the 12px gap)
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
    marginRight: 0, // Gap is handled by container width
    alignSelf: 'center', // Center within the 131px container
  },
  thumbnailActive: {
    width: 119,
    height: 80,
    overflow: 'visible', // Allow border to be visible
    alignSelf: 'center', // Center within the 131px container
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

