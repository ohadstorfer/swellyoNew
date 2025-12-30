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
  availableVideoHeight?: number; // Available space for main video - will size dynamically to fit
}

export const VideoCarousel: React.FC<VideoCarouselProps> = ({
  videos,
  selectedVideoId,
  onVideoSelect,
  availableVideoHeight,
}) => {
  const flatListRef = useRef<FlatList<VideoLevel>>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const thumbnailFadeAnim = useRef(new Animated.Value(1)).current;
  
  // Calculate video dimensions based on available height
  // Maintain aspect ratio while fitting available space
  // Make smaller on smaller screens to ensure it fits with gaps
  const getVideoDimensions = () => {
    const screenWidth = getScreenWidth();
    
    if (availableVideoHeight && availableVideoHeight > 0) {
      // Use available height to calculate width maintaining aspect ratio
      // Default aspect ratio: 340/324 (mobile) or 300/286 (desktop)
      const aspectRatio = isDesktopWeb() ? 300 / 286 : 340 / 324;
      
      // On smaller screens, reduce the height slightly to ensure gaps are maintained
      let calculatedHeight = availableVideoHeight;
      if (screenWidth <= 375) {
        // iPhone SE and similar: reduce by 10% to ensure gaps
        calculatedHeight = availableVideoHeight * 0.9;
      } else if (screenWidth <= 414) {
        // iPhone 12/13/14: reduce by 5% to ensure gaps
        calculatedHeight = availableVideoHeight * 0.95;
      }
      
      const calculatedWidth = calculatedHeight * aspectRatio;
      
      // Ensure width doesn't exceed screen bounds
      const maxWidth = getScreenWidth() - 32; // 16px padding on each side
      const finalWidth = Math.min(calculatedWidth, maxWidth);
      const finalHeight = finalWidth / aspectRatio;
      
      return { width: finalWidth, height: finalHeight };
    }
    
    // Fallback to default sizing (smaller on smaller screens)
    if (isDesktopWeb()) {
      return {
        width: Math.min(300, getScreenWidth() - 52),
        height: Math.min(300, getScreenWidth() - 52) * (286 / 300),
      };
    } else {
      // Scale down on smaller screens
      let baseWidth = 340;
      if (screenWidth <= 375) {
        baseWidth = 280; // Smaller on iPhone SE
      } else if (screenWidth <= 414) {
        baseWidth = 320; // Medium on iPhone 12/13/14
      }
      
      return {
        width: Math.min(baseWidth, getScreenWidth() - 32),
        height: Math.min(baseWidth, getScreenWidth() - 32) * (324 / 340),
      };
    }
  };
  
  const videoDimensions = getVideoDimensions();
  
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
          // Set properties required for autoplay
          player.loop = true;
          player.muted = true;
          
          // Try to play immediately
          const playPromise = player.play();
          if (playPromise !== undefined) {
            playPromise.catch((error: any) => {
              // Autoplay may be blocked, will retry in useEffect
              if (__DEV__ && error.name !== 'NotAllowedError') {
                console.warn('[VideoCarousel] Initial play attempt:', error.message);
              }
            });
          }
        } catch (error) {
          console.error('Error initializing video player:', error);
        }
      }
    }
  );

  // Robust autoplay implementation - tries multiple times and handles all cases
  // Also sets playsInline for iOS Safari to prevent fullscreen
  useEffect(() => {
    if (!mainVideoPlayer || !selectedVideo.videoUrl) return;

    let isMounted = true;
    let hasPlayed = false;

    // For web, ensure playsInline is set on the underlying video element (iOS Safari)
    // Also prevent all video interactions and hide controls
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Inject global CSS to hide all video controls
      const injectControlHidingCSS = () => {
        const styleId = 'video-carousel-hide-controls';
        if (document.getElementById(styleId)) return; // Already injected
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          /* Hide all video controls */
          video::-webkit-media-controls {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-enclosure {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-panel {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-play-button {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-start-playback-button {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-timeline {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-current-time-display {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-time-remaining-display {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-mute-button {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-volume-slider {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          video::-webkit-media-controls-fullscreen-button {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          /* Hide controls for all browsers */
          video::--webkit-media-controls {
            display: none !important;
          }
          /* Ensure video has no controls attribute */
          video[controls] {
            -webkit-appearance: none !important;
          }
        `;
        document.head.appendChild(style);
      };
      
      // Inject CSS immediately
      injectControlHidingCSS();
      
      // Find the video element and set playsInline attribute
      const setPlaysInline = () => {
        // Find all video elements (there might be multiple)
        const videoElements = document.querySelectorAll('video');
        videoElements.forEach((videoElement) => {
          // Remove controls attribute completely (not just set to false)
          videoElement.removeAttribute('controls');
          videoElement.controls = false;
          
          // Set playsInline attributes for iOS Safari
          videoElement.setAttribute('playsinline', 'true');
          videoElement.setAttribute('webkit-playsinline', 'true');
          videoElement.setAttribute('x5-playsinline', 'true'); // For some Android browsers
          
          // Prevent fullscreen
          videoElement.setAttribute('disablePictureInPicture', 'true');
          
          // Prevent video interactions via event listeners
          const preventInteraction = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
          };
          
          videoElement.addEventListener('touchstart', preventInteraction, { passive: false });
          videoElement.addEventListener('touchend', preventInteraction, { passive: false });
          videoElement.addEventListener('touchmove', preventInteraction, { passive: false });
          videoElement.addEventListener('click', preventInteraction, { passive: false });
          videoElement.addEventListener('dblclick', preventInteraction, { passive: false });
          
          // Prevent context menu
          videoElement.addEventListener('contextmenu', preventInteraction, { passive: false });
          
          // Set CSS to prevent interactions and hide controls
          (videoElement.style as any).pointerEvents = 'none';
          (videoElement.style as any).userSelect = 'none';
          (videoElement.style as any).WebkitUserSelect = 'none';
          (videoElement.style as any).touchAction = 'none';
          (videoElement.style as any).WebkitTouchCallout = 'none';
          
          // Force hide controls with inline styles
          (videoElement.style as any).WebkitAppearance = 'none';
          (videoElement.style as any).appearance = 'none';
        });
      };
      
      // Try immediately and after delays (video element might not be ready)
      setPlaysInline();
      setTimeout(setPlaysInline, 100);
      setTimeout(setPlaysInline, 500);
      setTimeout(setPlaysInline, 1000);
      
      // Also listen for new video elements being added
      const observer = new MutationObserver(() => {
        setPlaysInline();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      
      return () => {
        observer.disconnect();
      };
    }

    // Function to attempt playing the video
    const attemptPlay = async () => {
      if (!isMounted || !mainVideoPlayer || hasPlayed) return;

      try {
        // Ensure properties are set before playing
        mainVideoPlayer.loop = true;
        mainVideoPlayer.muted = true;

        // Play and handle promise
        const playPromise = mainVideoPlayer.play();
        if (playPromise !== undefined) {
          await playPromise;
          hasPlayed = true;
          if (__DEV__) {
            console.log('[VideoCarousel] Video playing successfully');
          }
        }
      } catch (error: any) {
        // Silently handle autoplay restrictions - will retry
        if (__DEV__ && error.name !== 'NotAllowedError') {
          console.warn('[VideoCarousel] Play attempt failed:', error.message);
        }
        hasPlayed = false;
      }
    };

    // Try to play immediately
    attemptPlay();

    // Retry on a short delay (helps with some browsers)
    const retryTimeout = setTimeout(() => {
      if (!hasPlayed) {
        attemptPlay();
      }
    }, 100);

    // For web, also try on visibility change (when tab becomes visible)
    let visibilityHandler: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.visibilityState === 'visible' && !hasPlayed) {
          attemptPlay();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }

    return () => {
      isMounted = false;
      clearTimeout(retryTimeout);
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    };
  }, [mainVideoPlayer, selectedVideo.videoUrl]);

  // Update player source when video changes
  useEffect(() => {
    if (selectedVideo.videoUrl && mainVideoPlayer) {
      const videoUrl = selectedVideo.videoUrl;
      if (!videoUrl) {
        console.warn('No video URL provided for:', selectedVideo.name);
        return;
      }
      
      const replacePromise = mainVideoPlayer.replaceAsync(videoUrl);
      if (replacePromise && typeof replacePromise.then === 'function') {
        replacePromise.then(() => {
          if (mainVideoPlayer) {
            // Set properties required for autoplay
            mainVideoPlayer.loop = true;
            mainVideoPlayer.muted = true;
            
            // Try to play after source is replaced
            const playPromise = mainVideoPlayer.play();
            if (playPromise !== undefined && typeof (playPromise as any).catch === 'function') {
              (playPromise as any).catch((playError: any) => {
                // Autoplay may be blocked, but the useEffect above will retry
                if (__DEV__ && playError.name !== 'NotAllowedError') {
                  console.warn('[VideoCarousel] Play after replace failed:', playError.message);
                }
              });
            }
          }
        }).catch((error: any) => {
          console.error('Error replacing video:', error, 'URL:', videoUrl);
        });
      }
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
    <View style={[styles.container, { flex: 1, justifyContent: 'flex-end' }]}>
      {/* Main Video Display */}
      <View style={styles.mainVideoContainer}>
        <View 
          style={[styles.videoWrapper, { width: videoDimensions.width, height: videoDimensions.height }]}
          {...(Platform.OS === 'web' && {
            // Prevent default touch behaviors on web (especially iOS Safari)
            onTouchStart: (e: any) => {
              e.preventDefault();
              e.stopPropagation();
            },
            onTouchMove: (e: any) => {
              e.preventDefault();
              e.stopPropagation();
            },
            onTouchEnd: (e: any) => {
              e.preventDefault();
              e.stopPropagation();
            },
          } as any)}
        >
          <Animated.View
            style={[
              styles.mainVideo,
              {
                opacity: fadeAnim,
              },
            ]}
            pointerEvents="none"
          >
            {selectedVideo.videoUrl ? (
              <View style={styles.videoPlayerContainer} pointerEvents="none">
                <VideoView
                  player={mainVideoPlayer}
                  style={styles.videoPlayer}
                  contentFit="cover"
                  nativeControls={false}
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                  {...(Platform.OS === 'web' && {
                    // Web-specific props to prevent controls
                    controls: false,
                    disablePictureInPicture: true,
                  } as any)}
                />
              </View>
            ) : (
              <Image
                source={{ uri: selectedVideo.thumbnailUrl }}
                style={styles.videoPlayer}
                resizeMode="cover"
              />
            )}
          </Animated.View>
          
          {/* Transparent overlay to prevent video interactions on iOS Safari */}
          <View 
            style={styles.videoOverlay}
            {...(Platform.OS === 'web' && {
              // Prevent default touch behaviors on web (especially iOS Safari)
              onTouchStart: (e: any) => {
                e.preventDefault();
                e.stopPropagation();
              },
              onTouchMove: (e: any) => {
                e.preventDefault();
                e.stopPropagation();
              },
              onTouchEnd: (e: any) => {
                e.preventDefault();
                e.stopPropagation();
              },
              onClick: (e: any) => {
                e.preventDefault();
                e.stopPropagation();
              },
            } as any)}
          />
          
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
    flex: 1, // Take up available space
    ...(isDesktopWeb() && {
      paddingHorizontal: 26,
      overflow: 'visible',
    }),
  },
  videoWrapper: {
    // Width and height are set dynamically via inline style based on availableVideoHeight
    minWidth: 280,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
    alignSelf: 'center',
    // Prevent all interactions with video wrapper
    ...(Platform.OS === 'web' && {
      // Prevent video controls and interactions on web (especially iOS Safari)
      userSelect: 'none' as any,
      WebkitUserSelect: 'none' as any,
      touchAction: 'none' as any,
      WebkitTouchCallout: 'none' as any,
    }),
  },
  mainVideo: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    pointerEvents: 'none', // Prevent all interactions with video
    ...(Platform.OS === 'web' && {
      // Prevent video controls and interactions on web
      userSelect: 'none' as any,
      WebkitUserSelect: 'none' as any,
      touchAction: 'none' as any,
    }),
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
    pointerEvents: 'none', // Prevent all interactions with video
    ...(Platform.OS === 'web' && {
      // Apply to all web (desktop and mobile web)
      objectFit: 'cover' as any,
      objectPosition: 'center center' as any,
      // Prevent video controls on web browsers (especially iOS Safari)
      userSelect: 'none' as any,
      WebkitUserSelect: 'none' as any,
      touchAction: 'none' as any,
      // Prevent context menu and video controls
      WebkitTouchCallout: 'none' as any,
      WebkitTapHighlightColor: 'transparent' as any,
      // Hide controls with CSS
      WebkitAppearance: 'none' as any,
      appearance: 'none' as any,
    }),
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 10,
    // This overlay catches all touch events to prevent video interaction
    // pointerEvents: 'auto' is implicit, will block all interactions with video
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
    paddingBottom: 16, // Space above button
    flexShrink: 0, // Don't shrink, keep fixed size at bottom
    ...(isDesktopWeb() && {
      // Desktop web only
      overflow: 'visible',
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

