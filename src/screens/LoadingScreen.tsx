import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { useOnboarding } from '../context/OnboardingContext';
import { getVideoUrl } from '../services/media/videoService';

interface LoadingScreenProps {
  onComplete: () => void;
  onBack?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  onComplete,
  onBack,
}) => {
  const { setCurrentStep } = useOnboarding();

  // Get video URL using the utility function
  const videoUrl = getVideoUrl('/Loading 4 to 5.mp4');

  // Create video player with robust autoplay setup
  const player = useVideoPlayer(videoUrl, (player: any) => {
    if (player) {
      try {
        // Set properties required for autoplay (muted is required for iOS Safari)
        player.loop = false; // Don't loop - play once
        player.muted = true; // Must be muted for autoplay on iOS Safari
        
        // Try to play immediately
        const playPromise = player.play();
        if (playPromise !== undefined) {
          playPromise.catch((error: any) => {
            // Autoplay may be blocked, will retry in useEffect
            if (__DEV__ && error.name !== 'NotAllowedError') {
              console.warn('[LoadingScreen] Initial play attempt:', error.message);
            }
          });
        }
      } catch (error) {
        console.error('Error initializing video player:', error);
      }
    }
  });

  // Robust autoplay implementation - tries multiple times and handles all cases
  // Also sets playsInline for iOS Safari to prevent fullscreen
  useEffect(() => {
    if (!player || !videoUrl) return;

    let isMounted = true;
    let hasPlayed = false;

    // For web, ensure playsInline is set on the underlying video element (iOS Safari)
    // Also prevent all video interactions and hide controls
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Inject global CSS to hide all video controls
      const injectControlHidingCSS = () => {
        const styleId = 'loading-screen-hide-controls';
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
          video::--webkit-media-controls {
            display: none !important;
          }
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
          
          // Set transparent background for video element
          (videoElement.style as any).backgroundColor = 'transparent';
          (videoElement.style as any).background = 'transparent';
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
      
      // Store observer for cleanup (will be accessed in cleanup function)
      (window as any).__loadingScreenObserver = observer;
    }

    // Function to attempt playing the video
    const attemptPlay = async () => {
      if (!isMounted || !player || hasPlayed) return;
      
      try {
        // Ensure properties are set before playing
        player.loop = false; // Don't loop - play once
        player.muted = true; // Must be muted for autoplay on iOS Safari

        // Play and handle promise
        const playPromise = player.play();
        if (playPromise !== undefined) {
          await playPromise;
          hasPlayed = true;
          if (__DEV__) {
            console.log('[LoadingScreen] Video playing successfully');
          }
        }
      } catch (error: any) {
        // Silently handle autoplay restrictions - will retry
        if (__DEV__ && error.name !== 'NotAllowedError') {
          console.warn('[LoadingScreen] Play attempt failed:', error.message);
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

    // Cleanup function for web-specific code (MutationObserver)
    let webCleanup: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // The cleanup for MutationObserver is returned from the web block above
      // We'll call it in the main cleanup
      webCleanup = (() => {
        if (typeof window !== 'undefined' && (window as any).__loadingScreenObserver) {
          (window as any).__loadingScreenObserver.disconnect();
          delete (window as any).__loadingScreenObserver;
        }
      });
    }

    return () => {
      isMounted = false;
      clearTimeout(retryTimeout);
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      // Clean up MutationObserver if it exists
      if (webCleanup) {
        webCleanup();
      }
    };
  }, [player, videoUrl]);

  useEffect(() => {
    // Auto-navigate to step 5 after video completes or timeout
    const timer = setTimeout(() => {
      onComplete();
    }, 5000); // 5 second timeout as fallback

    return () => clearTimeout(timer);
  }, [onComplete]);

  // Listen for video end
  useEffect(() => {
    if (!player) return;
    
    const subscription = player.addListener('playToEnd', () => {
      console.log('Video ended, navigating to next step');
      onComplete();
    });

    return () => {
      subscription.remove();
    };
  }, [player, onComplete]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      setCurrentStep(4); // Go back to step 4
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#222B30" />
        </TouchableOpacity>

        

        <View style={styles.skipButton}>
          {/* Skip button is hidden in this step */}
        </View>
      </View>

     

      {/* Main Content */}
      <View style={styles.content}>
        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Moving you to the next stage....</Text>
        </View>

        {/* Video */}
        <View style={styles.videoContainer}>
          <View 
            style={styles.videoWrapper}
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
            <View style={styles.videoPlayerContainer} pointerEvents="none">
              <VideoView
                player={player}
                style={styles.video}
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
              } as any)}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  progressBar: {
    width: 237,
    height: 4,
    backgroundColor: colors.progressBackground,
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.progressFill,
    borderRadius: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  titleContainer: {
    marginBottom: 36,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.brandTeal,
    textAlign: 'center',
    lineHeight: 28.8,
    width: 350,
  },
  videoContainer: {
    width: 295,
    height: 294,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent', // Transparent background to match page
    position: 'relative',
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: 'transparent', // Transparent background
  },
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'transparent', // Transparent background
    pointerEvents: 'none', // Prevent all interactions with video
    ...(Platform.OS === 'web' && {
      // Prevent video controls and interactions on web
      userSelect: 'none' as any,
      WebkitUserSelect: 'none' as any,
      touchAction: 'none' as any,
      WebkitTouchCallout: 'none' as any,
    }),
  },
  video: {
    width: '100%',
    height: '100%',
    pointerEvents: 'none', // Prevent all interactions with video
    backgroundColor: 'transparent', // Transparent background for native
    ...(Platform.OS === 'web' && {
      // Apply to all web (desktop and mobile web)
      objectFit: 'cover' as any,
      display: 'block' as any,
      visibility: 'visible' as any,
      opacity: 1,
      backgroundColor: 'transparent', // Transparent background for web
      // Prevent interactions
      userSelect: 'none' as any,
      WebkitUserSelect: 'none' as any,
      touchAction: 'none' as any,
      WebkitTouchCallout: 'none' as any,
      WebkitAppearance: 'none' as any,
      appearance: 'none' as any,
    } as any),
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 10,
    // pointerEvents: 'auto' is implicit, will block all interactions with video
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
});


