import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getBackgroundVideoSource, getBackgroundVideoSourceMP4, getVideoUrl } from '../services/media/videoService';

interface BackgroundVideoProps {
  videoSource?: string;
}

// Detect if we're on mobile web
const isMobileWeb = () => {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

export const BackgroundVideo: React.FC<BackgroundVideoProps> = ({ 
  videoSource 
}) => {
  const [useImageFallback, setUseImageFallback] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<any>(null);
  
  // Get the video source URL
  const videoUrl = videoSource 
    ? getVideoUrl(videoSource) 
    : getBackgroundVideoSource();

  // For mobile web, use MP4 instead of WebM for better compatibility
  // Get MP4 version - if using default background video, use matching MP4 filename (swellyo169welcome.mp4)
  const mp4FallbackUrl = videoSource 
    ? (videoSource.includes('.webm') ? videoSource.replace('.webm', '.mp4') : videoSource)
    : getBackgroundVideoSourceMP4();
  
  const mobileWebVideoUrl = mp4FallbackUrl;

  if (__DEV__) {
    console.log('[BackgroundVideo] Video URL:', videoUrl);
    console.log('[BackgroundVideo] Mobile Web URL:', mobileWebVideoUrl);
    console.log('[BackgroundVideo] Platform:', Platform.OS);
    console.log('[BackgroundVideo] Is Mobile Web:', isMobileWeb());
  }

  // Web-specific: Optimized for fast loading and immediate autoplay
  if (Platform.OS === 'web') {
    useEffect(() => {
      const videoElement = videoRef.current;
      if (!videoElement) return;

      // Set all attributes immediately for fastest loading
      videoElement.setAttribute('playsinline', 'true');
      videoElement.setAttribute('webkit-playsinline', 'true');
      videoElement.loop = true;
      videoElement.muted = true;
      videoElement.preload = 'auto'; // Always auto for fastest loading
      videoElement.playsInline = true;
      
      let hasPlayed = false;

      // Aggressive play function - tries multiple times immediately
      const attemptPlay = async () => {
        if (hasPlayed) return;
        
        try {
          const playPromise = videoElement.play();
          if (playPromise !== undefined) {
            await playPromise;
            hasPlayed = true;
            if (__DEV__) {
              console.log('[BackgroundVideo] Video playing successfully');
            }
          }
        } catch (error: any) {
          // Silently handle autoplay restrictions - will retry on next event
          if (__DEV__ && error.name !== 'NotAllowedError') {
            console.warn('[BackgroundVideo] Play attempt:', error.message);
          }
        }
      };

      // Try to play on multiple events for fastest possible start
      const handleCanPlay = () => {
        attemptPlay();
      };

      const handleCanPlayThrough = () => {
        attemptPlay();
      };

      const handleLoadedMetadata = () => {
        attemptPlay();
      };

      const handleLoadedData = () => {
        attemptPlay();
      };

      const handleLoadedStart = () => {
        attemptPlay();
      };

      const handleError = (e: any) => {
        const error = videoElement.error;
        if (error) {
          if (__DEV__) {
            console.error('[BackgroundVideo] Video error:', {
              code: error.code,
              message: error.message,
            });
          }
          
          // Error code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - browser will try next source
          if (error.code === 4) {
            return;
          }
        }
        setVideoError('Video failed to load');
        setUseImageFallback(true);
      };

      // Add all event listeners for fastest possible playback
      videoElement.addEventListener('loadstart', handleLoadedStart);
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.addEventListener('loadeddata', handleLoadedData);
      videoElement.addEventListener('canplay', handleCanPlay);
      videoElement.addEventListener('canplaythrough', handleCanPlayThrough);
      videoElement.addEventListener('error', handleError);

      // Immediate play attempt
      attemptPlay();

      // Also try after a tiny delay (catches cases where element isn't ready)
      const timeoutId = setTimeout(() => {
        attemptPlay();
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        videoElement.removeEventListener('loadstart', handleLoadedStart);
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('loadeddata', handleLoadedData);
        videoElement.removeEventListener('canplay', handleCanPlay);
        videoElement.removeEventListener('canplaythrough', handleCanPlayThrough);
        videoElement.removeEventListener('error', handleError);
      };
    }, [videoUrl, mobileWebVideoUrl]);

    return (
      <View style={[styles.container, webContainerStyle as any]}>
        {useImageFallback ? (
          <View style={styles.fallbackContainer} />
        ) : (
          // @ts-ignore - HTML5 video element for web
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            {...(isMobileWeb() && { 'webkit-playsinline': true } as any)}
            preload="auto"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              zIndex: 0,
              pointerEvents: 'none',
            } as any}
            onError={(e: any) => {
              if (__DEV__) {
                console.error('[BackgroundVideo] HTML5 video onError:', e);
              }
              setVideoError('Video failed to load');
              setUseImageFallback(true);
            }}
          >
            {/* Optimized source order for fastest loading */}
            {/* Mobile web: MP4 first (fastest iOS loading), then WebM */}
            {isMobileWeb() ? (
              <>
                <source src={mobileWebVideoUrl} type="video/mp4" />
                {videoUrl.includes('.webm') && videoUrl !== mobileWebVideoUrl && (
                  <source src={videoUrl} type="video/webm" />
                )}
              </>
            ) : (
              // Desktop: WebM first (smaller), then MP4
              <>
                {videoUrl.includes('.webm') && (
                  <source src={videoUrl} type="video/webm" />
                )}
                {mobileWebVideoUrl !== videoUrl && (
                  <source src={mobileWebVideoUrl} type="video/mp4" />
                )}
              </>
            )}
          </video>
        )}
      </View>
    );
  }

  // Create video player
  const player = useVideoPlayer(videoUrl, (player: any) => {
    if (player) {
      console.log('[BackgroundVideo] Player created:', player);
      player.loop = true;
      player.muted = true;
      try {
        player.play();
      } catch (error) {
        console.error('[BackgroundVideo] Error in player callback:', error);
        setVideoError(String(error));
      }
    } else {
      console.warn('[BackgroundVideo] Player is null');
    }
  });

  // Ensure video plays after mount and handle errors
  useEffect(() => {
    if (player) {
      console.log('[BackgroundVideo] Setting up player properties');
      // Set properties again to ensure they're applied
      player.loop = true;
      player.muted = true;
      
      // Play the video
      const playVideo = async () => {
        try {
          console.log('[BackgroundVideo] Attempting to play video');
          await player.play();
          console.log('[BackgroundVideo] Video play() called successfully');
        } catch (error) {
          console.error('[BackgroundVideo] Error playing background video:', error);
          setVideoError(String(error));
          setUseImageFallback(true);
        }
      };
      
      playVideo();
    } else {
      console.warn('[BackgroundVideo] Player is null in useEffect');
    }
  }, [player, videoUrl]);

  // Handle video errors
  useEffect(() => {
    if (player) {
      const handleError = (error: any) => {
        console.error('[BackgroundVideo] Video player error:', error);
        setVideoError(String(error));
        setUseImageFallback(true);
      };

      // Listen for video errors using addListener (expo-video API)
      try {
        const subscription = player.addListener('statusChange', (event: any) => {
          if (event.error) {
            handleError(event.error);
          }
        });
        return () => {
          if (subscription && typeof subscription.remove === 'function') {
            subscription.remove();
          }
        };
      } catch (e) {
        // Player doesn't support listeners, will rely on onError in VideoView
        console.log('[BackgroundVideo] Player listeners not available');
      }
    }
  }, [player]);

  if (useImageFallback || videoError) {
    console.log('[BackgroundVideo] Using image fallback. Error:', videoError);
    // Try to use a fallback image if video fails
    // For now, just show black background or a placeholder
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer}>
          {/* You can add a fallback image here if needed */}
        </View>
      </View>
    );
  }

  if (!player) {
    console.warn('[BackgroundVideo] No player available, showing fallback');
    return (
      <View style={styles.container}>
        <View style={styles.fallbackContainer} />
      </View>
    );
  }

  return (
    <View style={[styles.container, webContainerStyle as any]}>
      <VideoView
        player={player}
        style={[styles.video, webVideoStyle as any]}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  fallbackContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
});

// Web-specific styles applied separately
const webContainerStyle = Platform.OS === 'web' ? {
  position: 'fixed' as any,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100vw' as any,
  height: '100vh' as any,
  zIndex: 0,
} : {};

const webVideoStyle = Platform.OS === 'web' ? {
  objectFit: 'cover' as any,
  display: 'block' as any,
  position: 'absolute' as any,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  minWidth: '100%',
  minHeight: '100%',
  zIndex: 0,
} : {};
