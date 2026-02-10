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
import { getVideoPreloadStatus, waitForVideoReady } from '../services/media/videoPreloadService';

interface LoadingScreenProps {
  onComplete: () => void;
  onBack?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  onComplete,
  onBack,
}) => {
  const { setCurrentStep, formData } = useOnboarding();

  // Check if we should display the name
  const userName = formData.nickname || '';
  const shouldShowName = userName && userName.trim() !== '' && userName.toLowerCase() !== 'user';

  // Get video URL using the utility function
  const videoUrl = getVideoUrl('/Loading 4 to 5.mp4');

  // Check if video is preloaded - initialize loading state based on preload status
  const isVideoPreloaded = React.useMemo(() => {
    const status = getVideoPreloadStatus(videoUrl);
    return status?.ready === true;
  }, [videoUrl]);

  // Track initial mount to ensure replaceAsync is called on first render
  const isInitialMountRef = useRef(true);

  // Create video player - DO NOT attempt play here, wait for replaceAsync
  const player = useVideoPlayer(videoUrl, (player: any) => {
    if (player) {
      try {
        // Set properties required for autoplay (muted is required for iOS Safari)
        player.loop = false; // Don't loop - play once
        player.muted = true; // Must be muted for autoplay on iOS Safari
        
        if (__DEV__) {
          console.log('[LoadingScreen] Video player initialized with URL:', videoUrl, 'Preloaded:', isVideoPreloaded);
          console.log('[LoadingScreen] Player properties set, waiting for replaceAsync before playing');
        }
      } catch (error) {
        console.error('[LoadingScreen] Error initializing video player:', error);
      }
    }
  });

  // Comprehensive error handling and buffering detection (Best Practice: pauseWhenBuffering equivalent)
  useEffect(() => {
    if (!player || !videoUrl) return;
    
    let isMounted = true;
    
    // Listen for status changes to detect errors and buffering
    const handleStatusChange = (status: any) => {
      if (!isMounted || !player) return;
      
      // Best Practice: Handle buffering (pauseWhenBuffering equivalent)
      if (status?.isBuffering || status?.status === 'buffering') {
        if (__DEV__) {
          console.log('[LoadingScreen] Video is buffering, pausing playback');
        }
        // Pause when buffering to prevent choppy playback
        try {
          player.pause();
        } catch (error) {
          if (__DEV__) {
            console.warn('[LoadingScreen] Error pausing during buffer:', error);
          }
        }
      }
      
      // Handle errors
      if (status?.error) {
        console.error('[LoadingScreen] Video player error:', status.error, 'URL:', videoUrl);
      }
      
      // Handle ready state
      if (status?.status === 'readyToPlay' || status?.isReadyToPlay) {
        if (__DEV__) {
          console.log('[LoadingScreen] Video readyToPlay status detected');
        }
      }
    };
    
    // Listen for video errors on web
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const findVideoElement = () => {
        const videoElements = document.querySelectorAll('video');
        return Array.from(videoElements).find((video: HTMLVideoElement) => {
          return video.src === videoUrl || video.currentSrc === videoUrl;
        }) as HTMLVideoElement | undefined;
      };
      
      const setupErrorHandling = () => {
        const videoElement = findVideoElement();
        if (videoElement) {
          const handleError = (e: Event) => {
            const error = videoElement.error;
            if (error) {
              const errorMessage = `Video error: code ${error.code}, message: ${error.message}`;
              console.error('[LoadingScreen] HTML5 video error:', errorMessage, 'URL:', videoUrl);
            }
          };
          
          const handleWaiting = () => {
            if (__DEV__) {
              console.log('[LoadingScreen] Video waiting for data (buffering)');
            }
            // Best Practice: Pause when buffering
            try {
              if (player && typeof player.pause === 'function') {
                player.pause();
              }
            } catch (error) {
              if (__DEV__) {
                console.warn('[LoadingScreen] Error pausing during wait:', error);
              }
            }
          };
          
          const handleCanPlay = () => {
            if (__DEV__) {
              console.log('[LoadingScreen] Video can play again, resuming');
            }
            // Resume playback after buffering
            try {
              if (player && typeof player.play === 'function') {
                player.play().catch((err: any) => {
                  if (__DEV__ && err.name !== 'NotAllowedError') {
                    console.warn('[LoadingScreen] Error resuming after buffer:', err);
                  }
                });
              }
            } catch (error) {
              if (__DEV__) {
                console.warn('[LoadingScreen] Error resuming playback:', error);
              }
            }
          };
          
          videoElement.addEventListener('error', handleError, { once: false });
          videoElement.addEventListener('waiting', handleWaiting, { once: false });
          videoElement.addEventListener('canplay', handleCanPlay, { once: false });
          
          return () => {
            videoElement.removeEventListener('error', handleError);
            videoElement.removeEventListener('waiting', handleWaiting);
            videoElement.removeEventListener('canplay', handleCanPlay);
          };
        }
        return () => {};
      };
      
      const cleanup = setupErrorHandling();
      setTimeout(() => {
        const delayedCleanup = setupErrorHandling();
        return () => {
          cleanup();
          delayedCleanup();
        };
      }, 100);
      
      return () => {
        cleanup();
      };
    }
    
    // Listen for expo-video status changes (native and web)
    try {
      if (player.addListener) {
        const subscription = player.addListener('statusChange', handleStatusChange);
        return () => {
          isMounted = false;
          if (subscription && typeof subscription.remove === 'function') {
            subscription.remove();
          }
        };
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[LoadingScreen] Player listeners not available:', error);
      }
    }
    
    return () => {
      isMounted = false;
    };
  }, [player, videoUrl]);

  // For web, ensure playsInline is set on the underlying video element (iOS Safari)
  // Also prevent all video interactions and hide controls
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

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
        
        // Set playsInline attributes for iOS Safari (Best Practice: iOS Safari requirement)
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
    
    // Store observer for cleanup
    (window as any).__loadingScreenObserver = observer;

    return () => {
      if (typeof window !== 'undefined' && (window as any).__loadingScreenObserver) {
        (window as any).__loadingScreenObserver.disconnect();
        delete (window as any).__loadingScreenObserver;
      }
    };
  }, [videoUrl]);

  // Update player source when video changes OR on initial mount
  // This ensures replaceAsync is called on initial mount for the first video
  useEffect(() => {
    if (videoUrl && player) {
      const isInitialMount = isInitialMountRef.current;
      
      if (__DEV__) {
        console.log('[LoadingScreen] Replacing video URL:', videoUrl, 'Initial mount:', isInitialMount);
      }
      
      if (!videoUrl) {
        console.warn('[LoadingScreen] No video URL provided');
        isInitialMountRef.current = false;
        return;
      }

      // Ensure playsInline is set before replaceAsync (Best Practice: iOS Safari requirement)
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const setPlaysInline = () => {
          const videoElements = document.querySelectorAll('video');
          videoElements.forEach((videoElement: HTMLVideoElement) => {
            videoElement.setAttribute('playsinline', 'true');
            videoElement.setAttribute('webkit-playsinline', 'true');
            videoElement.setAttribute('x5-playsinline', 'true');
            videoElement.playsInline = true;
          });
        };
        setPlaysInline();
        setTimeout(setPlaysInline, 50);
      }

      const replacePromise = player.replaceAsync(videoUrl);
      if (replacePromise && typeof replacePromise.then === 'function') {
        replacePromise.then(() => {
          if (player) {
            // Set properties required for autoplay
            player.loop = false; // Don't loop - play once
            player.muted = true; // Must be muted for autoplay on iOS Safari
            
            // Ensure playsInline is set again after replaceAsync
            if (Platform.OS === 'web' && typeof document !== 'undefined') {
              const setPlaysInline = () => {
                const videoElements = document.querySelectorAll('video');
                videoElements.forEach((videoElement: HTMLVideoElement) => {
                  videoElement.setAttribute('playsinline', 'true');
                  videoElement.setAttribute('webkit-playsinline', 'true');
                  videoElement.setAttribute('x5-playsinline', 'true');
                  videoElement.playsInline = true;
                });
              };
              setPlaysInline();
              setTimeout(setPlaysInline, 50);
            }
            
            // Best Practice: Wait for video element to be ready before playing
            const waitForVideoReady = (): Promise<void> => {
              return new Promise<void>((resolve) => {
                if (Platform.OS === 'web' && typeof document !== 'undefined') {
                  const findVideoElement = () => {
                    const videoElements = document.querySelectorAll('video');
                    return Array.from(videoElements).find((video: HTMLVideoElement) => {
                      return video.src === videoUrl || video.currentSrc === videoUrl;
                    }) as HTMLVideoElement | undefined;
                  };
                  
                  const videoElement = findVideoElement();
                  if (videoElement) {
                    // Best Practice: Use HAVE_CURRENT_DATA (2) for faster readiness
                    const HAVE_CURRENT_DATA = 2;
                    if (videoElement.readyState >= HAVE_CURRENT_DATA) {
                      if (__DEV__) {
                        console.log(`[LoadingScreen] Video element ready (readyState: ${videoElement.readyState}), proceeding to play`);
                      }
                      resolve();
                    } else {
                      // Best Practice: canplay is the most reliable event
                      const canPlayHandler = () => {
                        if (__DEV__) {
                          console.log(`[LoadingScreen] canplay event fired (readyState: ${videoElement.readyState}), proceeding to play`);
                        }
                        resolve();
                      };
                      videoElement.addEventListener('canplay', canPlayHandler, { once: true });
                      
                      // Timeout fallback (Best Practice: Don't wait forever)
                      setTimeout(() => {
                        if (__DEV__) {
                          console.log(`[LoadingScreen] canplay timeout, proceeding anyway (readyState: ${videoElement.readyState})`);
                        }
                        videoElement.removeEventListener('canplay', canPlayHandler);
                        resolve();
                      }, 500);
                    }
                  } else {
                    // Video element not found, continue anyway
                    if (__DEV__) {
                      console.warn('[LoadingScreen] Video element not found, proceeding to play anyway');
                    }
                    resolve();
                  }
                } else {
                  // Native platforms - resolve immediately
                  resolve();
                }
              });
            };
            
            // Wait for video to be ready, then play
            waitForVideoReady().then(() => {
              if (!player) return;
              
              // Best Practice: Set properties before play
              player.loop = false;
              player.muted = true;
              
              // Now safe to play (Best Practice: Play after canplay)
              const playPromise = player.play();
              
              // Best Practice: Handle play promise properly with retry logic
              if (playPromise !== undefined && typeof (playPromise as any).catch === 'function') {
                (playPromise as any).then(() => {
                  if (__DEV__) {
                    console.log('[LoadingScreen] Video playing successfully after replaceAsync');
                  }
                }).catch((playError: any) => {
                  // Best Practice: Retry with exponential backoff
                  if (playError.name !== 'NotAllowedError') {
                    if (__DEV__) {
                      console.warn(`[LoadingScreen] Play failed (${playError.name}): ${playError.message}, retrying...`);
                    }
                    
                    // Retry after delay (exponential backoff)
                    setTimeout(() => {
                      if (player) {
                        const retryPlayResult = player.play();
                        if (retryPlayResult !== undefined && typeof (retryPlayResult as any).then === 'function') {
                          (retryPlayResult as any)
                            .then(() => {
                              if (__DEV__) {
                                console.log('[LoadingScreen] Video playing successfully after retry');
                              }
                            })
                            .catch((retryError: any) => {
                              // Final failure - video loaded but can't autoplay
                              if (__DEV__ && retryError.name !== 'NotAllowedError') {
                                console.warn('[LoadingScreen] Play retry failed:', retryError.message);
                              }
                            });
                        }
                      }
                    }, 200);
                  } else {
                    // Autoplay blocked - this is expected, video is still loaded
                    if (__DEV__) {
                      console.log('[LoadingScreen] Autoplay blocked (expected), video is loaded');
                    }
                  }
                });
              }
            });
          }
          
          // Mark initial mount as complete
          isInitialMountRef.current = false;
        }).catch((error: any) => {
          console.error('[LoadingScreen] Error replacing video:', error, 'URL:', videoUrl);
          isInitialMountRef.current = false;
        });
      } else {
        // If replaceAsync doesn't return a promise, mark initial mount as complete
        isInitialMountRef.current = false;
      }
    }
  }, [videoUrl, player]);

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

        {/* Text Container - 28px below video */}
        <View style={styles.textContainer}>
          {shouldShowName && (
            <Text style={styles.greeting}>Alright, {userName}!</Text>
          )}
          <Text style={styles.subtitle}>Community powered travel{'\n'}starts with you!</Text>
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
    backgroundColor: colors.backgroundGray,
  },
  textContainer: {
    width: 393,
    height: 72,
    paddingLeft: 15,
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 28,
  },
  titleContainer: {
    marginTop: 36,
    alignItems: 'center',
    gap: 4,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 32,
    width: 350,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    width: 351,
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
    backgroundColor: colors.backgroundGray, // Match container background to prevent flash
    position: 'relative',
    zIndex: 1,
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: colors.backgroundGray, // Match container background
  },
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: colors.backgroundGray, // Match container background
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
    pointerEvents: 'none',
    // backgroundColor: colors.backgroundGray, // Match container background for visual blending
  
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      display: 'block' as any,
      opacity: 1,
      mixBlendMode: 'darken' as any,
      // backgroundColor: colors.backgroundGray, // Match container background to avoid flashing/poster artifacts
  
      // Prevent any browser interaction/overlay
      userSelect: 'none' as any,
      WebkitUserSelect: 'none' as any,
      touchAction: 'none' as any,
      WebkitTouchCallout: 'none' as any,
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
    // backgroundColor: colors.backgroundGray,
    zIndex: 10,
    // pointerEvents: 'auto' is implicit, will block all interactions with video
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    // backgroundColor: colors.backgroundMedium,
    backgroundColor: colors.backgroundGray,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
});


