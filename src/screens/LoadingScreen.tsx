import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import { colors, spacing, borderRadius } from '../styles/theme';
import { Images } from '../assets/images';
import { useOnboarding } from '../context/OnboardingContext';
import { useScreenDimensions } from '../utils/responsive';
import { getLoadingVideoUrl } from '../services/media/videoService';
import { getVideoPreloadStatus, waitForVideoReady } from '../services/media/videoPreloadService';

const ACCENT_PURPLE = '#b72df2';
const REFERENCE_HEIGHT = 812;

interface LoadingScreenProps {
  onComplete: () => void;
  onBack?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  onComplete,
  onBack,
}) => {
  const [showConsentModal, setShowConsentModal] = useState(false);
  const { setCurrentStep, formData } = useOnboarding();
  const userName = formData?.nickname || '';
  const shouldShowName = userName && userName.trim() !== '' && userName.toLowerCase() !== 'user';

  // Get video URL from Supabase loading_video bucket
  const videoUrl = getLoadingVideoUrl();

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
                const playResult: unknown = player.play();
                if (playResult != null && typeof (playResult as { catch?: (fn: (e: any) => void) => void }).catch === 'function') {
                  (playResult as Promise<unknown>).catch((err: any) => {
                    if (__DEV__ && err.name !== 'NotAllowedError') {
                      console.warn('[LoadingScreen] Error resuming after buffer:', err);
                    }
                  });
                }
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
        // Set property for Safari (align with WelcomeToLineupOverlay)
        (videoElement as HTMLVideoElement).playsInline = true;
        // Set autoplay attribute for Safari/web (align with BackgroundVideo)
        videoElement.setAttribute('autoplay', 'true');

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

  // Retry play when tab becomes visible (Safari often allows autoplay after focus)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !player || !videoUrl) return;

    const setPlaysInlineAndPlay = () => {
      const videoElements = document.querySelectorAll('video');
      videoElements.forEach((el) => {
        el.setAttribute('playsinline', 'true');
        el.setAttribute('webkit-playsinline', 'true');
        el.setAttribute('x5-playsinline', 'true');
        el.setAttribute('autoplay', 'true');
        (el as HTMLVideoElement).playsInline = true;
      });
      player.muted = true;
      const playPromise = player.play();
      if (playPromise != null && typeof (playPromise as Promise<unknown>).catch === 'function') {
        (playPromise as Promise<void>).catch((err: { name?: string }) => {
          if (err.name !== 'NotAllowedError') {
            setTimeout(() => {
              if (player) player.play();
            }, 200);
          }
        });
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) setPlaysInlineAndPlay();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [player, videoUrl]);

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

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      setCurrentStep(4); // Go back to step 4
    }
  };

  const { height: rawScreenHeight } = useScreenDimensions();
  // On native, SafeAreaView consumes top/bottom insets (status bar ~50px, home indicator ~34px)
  const safeAreaInsets = Platform.OS === 'web' ? 0 : 90;
  const screenHeight = rawScreenHeight - safeAreaInsets;
  const spacingScale = Math.min(1.2, Math.max(0.55, screenHeight / REFERENCE_HEIGHT));
  const v = (base: number) => Math.round(base * spacingScale);
  const headerGap = v(12);
  const afterHeader = v(24);
  const bottomBlockPaddingH = spacing.lg;
  const subtitleToButtonGap =
    screenHeight >= REFERENCE_HEIGHT * 0.85
      ? 48
      : Math.max(16, Math.round(48 * spacingScale));
  const buttonBottom = v(24);
  // Video: use most of the middle area (Figma sequence ~232x375 portrait). Size by screen height so it dominates.
  const VIDEO_ASPECT = 232 / 375;
  const videoHeight = Math.round(Math.min(screenHeight * 0.48, 440));
  const videoWidth = Math.round(videoHeight * VIDEO_ASPECT);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#222B30" />
        </TouchableOpacity>
        <View style={styles.skipButton} />
      </View>

      {/* Header: Meet Swelly! + Your Guide into the Swellyo Lineup */}
      <View style={[styles.headerBlock, { paddingHorizontal: bottomBlockPaddingH, gap: headerGap, paddingTop: 0 }]}>
        <Text style={styles.headline}>Meet Swelly!</Text>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>
            Your Guide into the{'\n'}Swellyo Lineup
          </Text>
        </View>
      </View>

      {/* Middle: video centered vertically between "Your Guide..." and bottom text */}
      <View style={styles.videoMiddle}>
        <View style={[styles.videoContainer, { width: videoWidth, height: videoHeight }]}>
          <View
            style={styles.videoWrapper}
            {...(Platform.OS === 'web' && {
              onTouchStart: (e: any) => { e.preventDefault(); e.stopPropagation(); },
              onTouchMove: (e: any) => { e.preventDefault(); e.stopPropagation(); },
              onTouchEnd: (e: any) => { e.preventDefault(); e.stopPropagation(); },
            } as any)}
          >
            <View style={styles.videoPlayerContainer} pointerEvents="none">
              <VideoView
                player={player}
                style={styles.video}
                contentFit="contain"
                nativeControls={false}
                allowsFullscreen={false}
                allowsPictureInPicture={false}
                {...(Platform.OS === 'web' && {
                  controls: false,
                  disablePictureInPicture: true,
                } as any)}
              />
            </View>
            <View
              style={styles.videoOverlay}
              {...(Platform.OS === 'web' && {
                onTouchStart: (e: any) => { e.preventDefault(); e.stopPropagation(); },
                onTouchMove: (e: any) => { e.preventDefault(); e.stopPropagation(); },
                onTouchEnd: (e: any) => { e.preventDefault(); e.stopPropagation(); },
              } as any)}
            />
          </View>
        </View>
      </View>

      {/* Bottom: "Alright, name!" + body text aligned to Drop In! button */}
      <View style={[styles.bottomBlock, { paddingHorizontal: bottomBlockPaddingH, paddingBottom: buttonBottom }]}>
        <View style={[styles.textContainer, { gap: v(4) }]}>
          <Text style={styles.greeting}>
            {shouldShowName ? `Alright, ${userName}!` : 'Alright!'}
          </Text>
          <Text style={styles.subtitle}>
            Swelly will help finish shaping your surf travel profile so we can connect you with the right surfers, destinations, and travel experiences.
          </Text>
        </View>
        <View style={{ height: subtitleToButtonGap }} />
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => setShowConsentModal(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.ctaButtonText}>Drop In!</Text>
        </TouchableOpacity>
      </View>
      {/* AI Consent Modal */}
      <Modal
        visible={showConsentModal}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <Pressable style={styles.consentBackdrop} onPress={() => {}}>
          <View style={styles.consentCard}>
            {/* Swelly avatar — same gray ellipse + purple ring pattern used on
                the home screen Swelly card, scaled up. Image pokes above the
                purple top arc; bottom of image sits behind the bottom arc. */}
            <View style={styles.consentAvatar}>
              <View style={styles.consentAvatarRing}>
                <View style={styles.consentEllipseBackground}>
                  <Svg width={90} height={91} viewBox="0 0 62 63" fill="none">
                    <Path
                      d="M30.8242 0.75C47.4452 0.75 60.8984 14.4406 60.8984 31.3027C60.8983 48.1648 47.4451 61.8545 30.8242 61.8545C14.2034 61.8544 0.75014 48.1648 0.75 31.3027C0.75 14.4406 14.2033 0.750059 30.8242 0.75Z"
                      fill="#D9D9D9"
                      stroke="#B72DF2"
                      strokeWidth="1.5"
                    />
                  </Svg>
                </View>
                <View style={styles.consentAvatarImageContainer}>
                  <Image
                    source={Images.swellyAvatar}
                    style={styles.consentAvatarImage}
                    resizeMode="cover"
                  />
                </View>
                <View style={styles.consentEllipseForeground} pointerEvents="none">
                  <Svg width={90} height={91} viewBox="0 0 62 63" fill="none">
                    <Path
                      d="M60.8984 31.3027C60.8983 48.1648 47.4451 61.8545 30.8242 61.8545C14.2034 61.8544 0.75014 48.1648 0.75 31.3027"
                      fill="none"
                      stroke="#B72DF2"
                      strokeWidth="1.5"
                    />
                  </Svg>
                </View>
              </View>
            </View>

            {/* Title */}
            <Text style={styles.consentTitle}>Swellyo uses AI</Text>

            {/* Body */}
            <Text style={styles.consentBody}>
              {'We use OpenAI to power your experience - including building your profile and matching you with other surfers.\nYour messages and profile data are processed by OpenAI on our behalf.'}
            </Text>

            {/* Got it button */}
            <TouchableOpacity
              style={styles.consentButton}
              onPress={() => {
                setShowConsentModal(false);
                onComplete();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.consentButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FCFCFC',
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
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
  },
  headerBlock: {
    alignItems: 'center',
    width: '100%',
  },
  videoMiddle: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 250,
    zIndex: 0,
  },
  bottomBlock: {
    alignItems: 'center',
    width: '100%',
    flexShrink: 0,
    backgroundColor: '#FCFCFC',
    zIndex: 2,
    paddingTop: 12,
  },
  headline: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: ACCENT_PURPLE,
    textAlign: 'center',
    lineHeight: 28.8,
  },
  headerTitleWrap: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 345,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: '#212121',
    textAlign: 'center',
    lineHeight: 24,
  },
  textContainer: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 357,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: Platform.OS === 'web' ? 'var(--Text-primary, #333)' : colors.textPrimary,
    textAlign: 'center',
    lineHeight: 24,
    width: '100%',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    width: '100%',
  },
  ctaButton: {
    backgroundColor: '#212121',
    minWidth: 150,
    maxWidth: 330,
    width: '100%',
    height: 56,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  ctaButtonText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.white,
    lineHeight: 24,
  },
  videoContainer: {
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'web' ? colors.backgroundGray : 'transparent',
    position: 'relative',
    zIndex: 1,
    alignSelf: 'center',
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: Platform.OS === 'web' ? colors.backgroundGray : 'transparent',
  },
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: Platform.OS === 'web' ? colors.backgroundGray : 'transparent',
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
    ...(Platform.OS !== 'web' && { backgroundColor: 'transparent' }),

    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      display: 'block' as any,
      opacity: 1,
      mixBlendMode: 'darken' as any,
      // backgroundColor: '#FCFCFC', // Match container background to avoid flashing/poster artifacts
  
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
    // backgroundColor: '#FCFCFC',
    zIndex: 10,
    // pointerEvents: 'auto' is implicit, will block all interactions with video
  },
  consentBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(33, 33, 33, 0.80)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  consentCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 36,
    width: 344,
    alignItems: 'center',
    gap: 18,
  },
  // Scaled-up version of ConversationsScreen's Swelly card avatar (62×68 → 90×99).
  consentAvatar: {
    width: 90,
    height: 99,
    aspectRatio: 90 / 99,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  consentAvatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 45,
    overflow: 'visible',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  consentEllipseBackground: {
    position: 'absolute',
    width: '105%',
    height: '105%',
    top: '-2.5%',
    left: '-2.5%',
    zIndex: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentEllipseForeground: {
    position: 'absolute',
    width: '105%',
    height: '105%',
    top: '-2.5%',
    left: '-2.5%',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentAvatarImageContainer: {
    position: 'absolute',
    // 75 × 1.45 ≈ 109; offsets scaled the same way (-6.1 → -8.8, -7 → -10.2)
    width: 109,
    height: 109,
    left: -8.8,
    top: -10.2,
    overflow: 'hidden',
    zIndex: 1,
  },
  consentAvatarImage: {
    width: 109,
    height: 109,
  },
  consentTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: '#333333',
    textAlign: 'center',
    lineHeight: 26,
  },
  consentBody: {
    fontSize: 14,
    fontWeight: '200',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: '#5e5e5e',
    textAlign: 'center',
    lineHeight: 20,
    width: '90%',
  },
  consentButton: {
    backgroundColor: '#333333',
    borderRadius: 8,
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  consentButtonText: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: '#ffffff',
    lineHeight: 22,
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    // backgroundColor: colors.backgroundMedium,
    backgroundColor: '#FCFCFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
});


