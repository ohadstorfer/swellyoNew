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

  console.log('[BackgroundVideo] Video URL:', videoUrl);
  console.log('[BackgroundVideo] Mobile Web URL:', mobileWebVideoUrl);
  console.log('[BackgroundVideo] Platform:', Platform.OS);
  console.log('[BackgroundVideo] Is Mobile Web:', isMobileWeb());

  // Web-specific: Use native HTML5 video for better webm support
  if (Platform.OS === 'web') {
    useEffect(() => {
      const videoElement = videoRef.current;
      if (videoElement) {
        videoElement.loop = true;
        videoElement.muted = true;
        videoElement.playsInline = true;
        videoElement.preload = 'auto';
        
        const handleCanPlay = () => {
          console.log('[BackgroundVideo] Video can play, attempting to play');
          videoElement.play().catch((error) => {
            console.error('[BackgroundVideo] Error playing HTML5 video:', error);
            setVideoError(String(error));
            setUseImageFallback(true);
          });
        };

        const handleLoadedData = () => {
          console.log('[BackgroundVideo] Video data loaded');
          videoElement.play().catch((error) => {
            console.warn('[BackgroundVideo] Play failed on loadeddata:', error);
          });
        };

        const handleError = (e: any) => {
          console.error('[BackgroundVideo] HTML5 video error:', e);
          const error = videoElement.error;
          if (error) {
            console.error('[BackgroundVideo] Video error code:', error.code);
            console.error('[BackgroundVideo] Video error message:', error.message);
            
            // If WebM fails on mobile, try MP4 fallback
            if (error.code === 4 && !isMobileWeb() && videoUrl.includes('.webm')) {
              console.log('[BackgroundVideo] WebM failed, trying MP4 fallback');
              videoElement.src = mobileWebVideoUrl;
              return;
            }
          }
          setVideoError('Video failed to load');
          setUseImageFallback(true);
        };

        videoElement.addEventListener('canplay', handleCanPlay);
        videoElement.addEventListener('loadeddata', handleLoadedData);
        videoElement.addEventListener('error', handleError);

        // Try to play immediately
        videoElement.play().catch((error) => {
          console.warn('[BackgroundVideo] Initial play failed, waiting for canplay:', error);
        });

        return () => {
          videoElement.removeEventListener('canplay', handleCanPlay);
          videoElement.removeEventListener('loadeddata', handleLoadedData);
          videoElement.removeEventListener('error', handleError);
        };
      }
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
            preload="auto"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              zIndex: 0,
            } as any}
            onError={(e: any) => {
              console.error('[BackgroundVideo] HTML5 video onError:', e);
              setVideoError('Video failed to load');
              setUseImageFallback(true);
            }}
          >
            {/* Provide multiple source formats for better compatibility */}
            {isMobileWeb() ? (
              // Mobile web: prefer MP4, fallback to WebM
              <>
                <source src={mobileWebVideoUrl} type="video/mp4" />
                {videoUrl.includes('.webm') && (
                  <source src={videoUrl} type="video/webm" />
                )}
              </>
            ) : (
              // Desktop: prefer WebM, fallback to MP4
              <>
                {videoUrl.includes('.webm') && (
                  <source src={videoUrl} type="video/webm" />
                )}
                <source src={mobileWebVideoUrl} type="video/mp4" />
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

      // Listen for video errors
      if (player.addEventListener) {
        player.addEventListener('error', handleError);
        return () => {
          if (player.removeEventListener) {
            player.removeEventListener('error', handleError);
          }
        };
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
        onError={(error: any) => {
          console.error('[BackgroundVideo] VideoView error:', error);
          setVideoError(String(error));
          setUseImageFallback(true);
        }}
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
