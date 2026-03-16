import React, { useRef, useState, useEffect } from 'react';
import {
  View,
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
import Svg, { Circle } from 'react-native-svg';
import { Text } from './Text';
import { spacing } from '../styles/theme';
import { getVideoPreloadStatus } from '../services/media/videoPreloadService';

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

// Carousel animation constants
const INACTIVE_WIDTH = 98;
const INACTIVE_HEIGHT = 66;
const ACTIVE_WIDTH = 118;
const ACTIVE_HEIGHT = 80;
const CAROUSEL_GAP = isDesktopWeb() ? 12 : 4;
const ITEM_SLOT_WIDTH = ACTIVE_WIDTH + CAROUSEL_GAP;
const ANIMATION_DURATION = 350;

// Compute circular slot offset with wraparound
// Returns the shortest-path offset from selectedIdx to itemIdx
const circularSlot = (itemIdx: number, selectedIdx: number, total: number): number => {
  let diff = itemIdx - selectedIdx;
  if (diff > total / 2) diff -= total;
  if (diff < -total / 2) diff += total;
  // For even total where |diff| == total/2, prefer positive
  if (diff === -total / 2) diff = Math.abs(diff);
  return diff;
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
  const [containerWidth, setContainerWidth] = useState(0);
  const carouselAnimsRef = useRef<{
    translateX: Animated.Value;
    width: Animated.Value;
    height: Animated.Value;
    opacity: Animated.Value;
  }[]>([]);
  const isCarouselFirstRender = useRef(true);
  const prevVideosLengthRef = useRef(0);
  
  // Get the selected video directly from selectedVideoId
  const selectedVideo = React.useMemo(() => {
    return videos.find(v => v.id === selectedVideoId) || videos[0];
  }, [videos, selectedVideoId]);
  
  // Check preload status synchronously to initialize loading state correctly
  const initialLoadingState = React.useMemo(() => {
    if (!selectedVideo?.videoUrl) return true;
    if (selectedVideo.videoUrl.startsWith('blob:')) return false; // Safari blob = instant
    const preloadStatus = getVideoPreloadStatus(selectedVideo.videoUrl);
    const isPreloaded = preloadStatus?.ready === true;
    if (__DEV__ && isPreloaded) {
      console.log('[VideoCarousel] Video is preloaded on mount, skipping loading state');
    }
    return !isPreloaded;
  }, [selectedVideo?.videoUrl]);
  
  const [isVideoLoading, setIsVideoLoading] = useState(initialLoadingState);
  
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

  // --- Two-player crossfade setup ---
  const activeSlotRef = useRef<'A' | 'B'>('A');
  const fadeAnimA = useRef(new Animated.Value(1)).current;
  const fadeAnimB = useRef(new Animated.Value(0)).current;
  const currentPlayPromiseRef = useRef<Promise<void> | null>(null);
  const isInitialMountRef = useRef(true);

  const playerA = useVideoPlayer(
    selectedVideo.videoUrl || null,
    (player: any) => {
      if (player) {
        player.loop = true;
        player.muted = true;
      }
    }
  );

  const playerB = useVideoPlayer(
    null as any,
    (player: any) => {
      if (player) {
        player.loop = true;
        player.muted = true;
      }
    }
  );

  // Helper to get player/fade by slot
  const getSlotPlayer = (slot: 'A' | 'B') => slot === 'A' ? playerA : playerB;
  const getSlotFade = (slot: 'A' | 'B') => slot === 'A' ? fadeAnimA : fadeAnimB;

  // Web: wait for a video element with given URL to reach readyState >= 2
  const waitForVideoElementReady = (url: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (Platform.OS !== 'web' || typeof document === 'undefined') { resolve(); return; }
      const find = () => {
        const vids = document.querySelectorAll('video');
        return Array.from(vids).find((v: HTMLVideoElement) =>
          v.src === url || v.currentSrc === url
        ) as HTMLVideoElement | undefined;
      };
      const tryResolve = (el: HTMLVideoElement | undefined) => {
        if (el && el.readyState >= 2) { resolve(); return true; }
        if (el) {
          const handler = () => resolve();
          el.addEventListener('canplay', handler, { once: true });
          setTimeout(() => { el.removeEventListener('canplay', handler); resolve(); }, 500);
          return true;
        }
        return false;
      };
      if (tryResolve(find())) return;
      // Element not yet in DOM — retry after a tick
      setTimeout(() => { if (!tryResolve(find())) resolve(); }, 100);
    });
  };

  // Web: inject CSS to hide video controls & set playsInline (runs once)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const styleId = 'video-carousel-hide-controls';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        video::-webkit-media-controls,
        video::-webkit-media-controls-enclosure,
        video::-webkit-media-controls-panel,
        video::-webkit-media-controls-play-button,
        video::-webkit-media-controls-start-playback-button,
        video::-webkit-media-controls-timeline,
        video::-webkit-media-controls-current-time-display,
        video::-webkit-media-controls-time-remaining-display,
        video::-webkit-media-controls-mute-button,
        video::-webkit-media-controls-volume-slider,
        video::-webkit-media-controls-fullscreen-button {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
        video::--webkit-media-controls { display: none !important; }
        video[controls] { -webkit-appearance: none !important; }
      `;
      document.head.appendChild(style);
    }

    const applyVideoAttrs = () => {
      document.querySelectorAll('video').forEach((el) => {
        el.removeAttribute('controls');
        el.controls = false;
        el.setAttribute('playsinline', 'true');
        el.setAttribute('webkit-playsinline', 'true');
        el.setAttribute('x5-playsinline', 'true');
        el.setAttribute('disablePictureInPicture', 'true');
        const s = el.style as any;
        s.pointerEvents = 'none';
        s.userSelect = 'none';
        s.WebkitUserSelect = 'none';
        s.touchAction = 'none';
        s.WebkitTouchCallout = 'none';
        s.WebkitAppearance = 'none';
        s.appearance = 'none';
      });
    };
    applyVideoAttrs();
    setTimeout(applyVideoAttrs, 100);
    setTimeout(applyVideoAttrs, 500);

    const observer = new MutationObserver(applyVideoAttrs);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Helper: set playsInline on all video elements (used before replaceAsync)
  const ensurePlaysInline = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.querySelectorAll('video').forEach((el: HTMLVideoElement) => {
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      el.setAttribute('x5-playsinline', 'true');
      el.playsInline = true;
    });
  };

  // Helper: load a video into a player, wait for ready, and start playing
  const loadAndPlay = async (player: any, videoUrl: string): Promise<void> => {
    ensurePlaysInline();

    // Cancel any pending play promise
    if (currentPlayPromiseRef.current) {
      currentPlayPromiseRef.current.catch(() => {});
      currentPlayPromiseRef.current = null;
    }

    const replacePromise = player.replaceAsync(videoUrl);
    if (replacePromise && typeof replacePromise.then === 'function') {
      await replacePromise;
    }

    player.loop = true;
    player.muted = true;

    ensurePlaysInline();

    // Wait for the video element to be ready on web
    await waitForVideoElementReady(videoUrl);

    player.loop = true;
    player.muted = true;

    const playPromise = player.play();
    if (playPromise !== undefined) {
      currentPlayPromiseRef.current = playPromise as Promise<void>;
      try {
        await playPromise;
      } catch (e: any) {
        // Retry once on non-autoplay errors
        if (e.name !== 'NotAllowedError') {
          if (__DEV__) console.warn('[VideoCarousel] Play failed, retrying:', e.message);
          try {
            const retry = player.play();
            if (retry) await retry;
          } catch (_retryErr) { /* give up */ }
        }
      }
    }
  };

  // Main crossfade effect: runs on every video URL change
  useEffect(() => {
    const videoUrl = selectedVideo.videoUrl;
    if (!videoUrl || !playerA || !playerB) return;

    let cancelled = false;

    const performSwitch = async () => {
      if (isInitialMountRef.current) {
        // --- Initial mount: load into playerA, no crossfade ---
        isInitialMountRef.current = false;
        fadeAnimA.setValue(1);
        fadeAnimB.setValue(0);
        activeSlotRef.current = 'A';

        try {
          await loadAndPlay(playerA, videoUrl);
        } catch (err: any) {
          if (__DEV__) console.warn('[VideoCarousel] Initial load error:', err.message);
        }
        if (!cancelled) setIsVideoLoading(false);
        return;
      }

      // --- Subsequent switches: crossfade ---
      const outSlot = activeSlotRef.current;
      const inSlot: 'A' | 'B' = outSlot === 'A' ? 'B' : 'A';
      const incomingPlayer = getSlotPlayer(inSlot);
      const incomingFade = getSlotFade(inSlot);
      const outgoingFade = getSlotFade(outSlot);
      const outgoingPlayer = getSlotPlayer(outSlot);

      // Ensure incoming layer starts invisible
      incomingFade.setValue(0);

      try {
        await loadAndPlay(incomingPlayer, videoUrl);
        if (cancelled) return;

        // Crossfade: fade in incoming, fade out outgoing
        Animated.parallel([
          Animated.timing(incomingFade, {
            toValue: 1,
            duration: 300,
            easing: Easing.ease,
            useNativeDriver: false,
          }),
          Animated.timing(outgoingFade, {
            toValue: 0,
            duration: 300,
            easing: Easing.ease,
            useNativeDriver: false,
          }),
        ]).start(() => {
          // After crossfade completes, pause the outgoing player
          try { outgoingPlayer.pause(); } catch (_) {}
          activeSlotRef.current = inSlot;
        });
      } catch (error: any) {
        if (__DEV__) console.error('[VideoCarousel] Crossfade error:', error);
      }
      if (!cancelled) setIsVideoLoading(false);
    };

    performSwitch();

    return () => { cancelled = true; };
  }, [selectedVideo.videoUrl, playerA, playerB]);

  // Initialize/reinitialize carousel animated values when videos change
  if (carouselAnimsRef.current.length !== videos.length || prevVideosLengthRef.current !== videos.length) {
    const selectedIndex = Math.max(0, videos.findIndex(v => v.id === selectedVideoId));
    const desktop = isDesktopWeb();
    carouselAnimsRef.current = videos.map((_, idx) => {
      const slot = circularSlot(idx, selectedIndex, videos.length);
      const isSelected = slot === 0;
      const visible = desktop ? Math.abs(slot) <= 2 : Math.abs(slot) <= 1;
      return {
        translateX: new Animated.Value(slot * ITEM_SLOT_WIDTH),
        width: new Animated.Value(isSelected ? ACTIVE_WIDTH : INACTIVE_WIDTH),
        height: new Animated.Value(isSelected ? ACTIVE_HEIGHT : INACTIVE_HEIGHT),
        opacity: new Animated.Value(!visible ? 0 : isSelected ? 1 : Math.abs(slot) === 1 ? 0.5 : 0.3),
      };
    });
    prevVideosLengthRef.current = videos.length;
    isCarouselFirstRender.current = true;
  }

  // Animate carousel thumbnails on selection change
  useEffect(() => {
    const selectedIndex = videos.findIndex(v => v.id === selectedVideoId);
    if (selectedIndex < 0 || carouselAnimsRef.current.length !== videos.length) return;
    const desktop = isDesktopWeb();

    const animations: Animated.CompositeAnimation[] = [];

    videos.forEach((_, idx) => {
      const anim = carouselAnimsRef.current[idx];
      if (!anim) return;

      const slot = circularSlot(idx, selectedIndex, videos.length);
      const isSelected = slot === 0;
      const visible = desktop ? Math.abs(slot) <= 2 : Math.abs(slot) <= 1;

      const targetTranslateX = slot * ITEM_SLOT_WIDTH;
      const targetWidth = isSelected ? ACTIVE_WIDTH : INACTIVE_WIDTH;
      const targetHeight = isSelected ? ACTIVE_HEIGHT : INACTIVE_HEIGHT;
      const targetOpacity = !visible ? 0 : isSelected ? 1 : Math.abs(slot) === 1 ? 0.5 : 0.3;

      if (isCarouselFirstRender.current) {
        anim.translateX.setValue(targetTranslateX);
        anim.width.setValue(targetWidth);
        anim.height.setValue(targetHeight);
        anim.opacity.setValue(targetOpacity);
      } else {
        animations.push(
          Animated.timing(anim.translateX, {
            toValue: targetTranslateX,
            duration: ANIMATION_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(anim.width, {
            toValue: targetWidth,
            duration: ANIMATION_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(anim.height, {
            toValue: targetHeight,
            duration: ANIMATION_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(anim.opacity, {
            toValue: targetOpacity,
            duration: ANIMATION_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        );
      }
    });

    if (!isCarouselFirstRender.current && animations.length > 0) {
      Animated.parallel(animations).start();
    }

    isCarouselFirstRender.current = false;
  }, [selectedVideoId, videos]);

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
          {/* Video Layer A */}
          <Animated.View
            style={[styles.mainVideo, { opacity: fadeAnimA }]}
            pointerEvents="none"
          >
            <View style={styles.videoPlayerContainer} pointerEvents="none">
              <VideoView
                player={playerA}
                style={styles.videoPlayer}
                contentFit="cover"
                nativeControls={false}
                allowsFullscreen={false}
                allowsPictureInPicture={false}
                {...(Platform.OS === 'web' && {
                  controls: false,
                  disablePictureInPicture: true,
                } as any)}
              />
            </View>
          </Animated.View>

          {/* Video Layer B (absolute overlay for crossfade) */}
          <Animated.View
            style={[
              styles.mainVideo,
              { opacity: fadeAnimB, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
            ]}
            pointerEvents="none"
          >
            <View style={styles.videoPlayerContainer} pointerEvents="none">
              <VideoView
                player={playerB}
                style={styles.videoPlayer}
                contentFit="cover"
                nativeControls={false}
                allowsFullscreen={false}
                allowsPictureInPicture={false}
                {...(Platform.OS === 'web' && {
                  controls: false,
                  disablePictureInPicture: true,
                } as any)}
              />
            </View>
          </Animated.View>

          {/* Thumbnail fallback during initial load */}
          {isVideoLoading && selectedVideo.thumbnailUrl ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2 }}>
              <Image
                source={{ uri: selectedVideo.thumbnailUrl }}
                style={styles.videoPlayer}
                resizeMode="cover"
              />
            </View>
          ) : null}
          
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
          
          {/* Frame: 4 corners only, same radius (24) as video */}
          <View style={styles.frameBorderWrapper} pointerEvents="none">
            <View style={[styles.frameCorner, styles.frameCornerTopLeft]} />
            <View style={[styles.frameCorner, styles.frameCornerTopRight]} />
            <View style={[styles.frameCorner, styles.frameCornerBottomLeft]} />
            <View style={[styles.frameCorner, styles.frameCornerBottomRight]} />
          </View>
          
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
          {containerWidth > 0 && videos.map((video, idx) => {
            const anim = carouselAnimsRef.current[idx];
            if (!anim) return null;
            const isActive = video.id === selectedVideoId;

            return (
              <Animated.View
                key={video.id}
                style={{
                  position: 'absolute' as const,
                  left: containerWidth / 2 - ITEM_SLOT_WIDTH / 2,
                  top: 0,
                  width: ITEM_SLOT_WIDTH,
                  height: ACTIVE_HEIGHT,
                  justifyContent: 'center' as const,
                  alignItems: 'center' as const,
                  transform: [{ translateX: anim.translateX }],
                }}
              >
                <TouchableOpacity onPress={() => onVideoSelect(video)} activeOpacity={0.8}>
                  <Animated.View
                    style={{
                      width: anim.width,
                      height: anim.height,
                      opacity: anim.opacity,
                      borderRadius: 8,
                      overflow: isActive ? 'visible' as const : 'hidden' as const,
                    }}
                  >
                    {isActive ? (
                      <View style={styles.thumbnailImageWrapper}>
                        <LinearGradient
                          colors={['#05BCD3', '#DBCDBC']}
                          locations={[0, 0.7]}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.activeGradientBorder}
                        />
                        <View style={styles.activeGradientInner}>
                          {video.thumbnailUrl ? (
                            <Image
                              source={{ uri: video.thumbnailUrl }}
                              style={styles.thumbnailImage}
                              resizeMode="cover"
                            />
                          ) : null}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.thumbnailImageWrapper}>
                        {video.thumbnailUrl ? (
                          <Image
                            source={{ uri: video.thumbnailUrl }}
                            style={styles.thumbnailImage}
                            resizeMode="cover"
                          />
                        ) : null}
                      </View>
                    )}
                  </Animated.View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
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
  frameBorderWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  frameCorner: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderColor: 'white',
  },
  frameCornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
  },
  frameCornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 24,
  },
  frameCornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: 24,
  },
  frameCornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: 24,
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
  thumbnailImageWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8, // Match the thumbnail border radius
  },
  // Gradient border: linear-gradient(90deg, #05BCD3 0%, #DBCDBC 70%)
  activeGradientBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  activeGradientInner: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 6,
    overflow: 'hidden',
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


