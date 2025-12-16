import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getBackgroundVideoSource, getVideoUrl } from '../services/media/videoService';

interface BackgroundVideoProps {
  videoSource?: string;
}

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

  console.log('[BackgroundVideo] Video URL:', videoUrl);
  console.log('[BackgroundVideo] Platform:', Platform.OS);

  // Web-specific: Use native HTML5 video for better webm support
  if (Platform.OS === 'web') {
    useEffect(() => {
      const videoElement = videoRef.current;
      if (videoElement) {
        videoElement.loop = true;
        videoElement.muted = true;
        videoElement.playsInline = true;
        
        const handleCanPlay = () => {
          console.log('[BackgroundVideo] Video can play, attempting to play');
          videoElement.play().catch((error) => {
            console.error('[BackgroundVideo] Error playing HTML5 video:', error);
            setVideoError(String(error));
            setUseImageFallback(true);
          });
        };

        const handleError = (e: any) => {
          console.error('[BackgroundVideo] HTML5 video error:', e);
          setVideoError('Video failed to load');
          setUseImageFallback(true);
        };

        videoElement.addEventListener('canplay', handleCanPlay);
        videoElement.addEventListener('error', handleError);

        // Try to play immediately
        videoElement.play().catch((error) => {
          console.warn('[BackgroundVideo] Initial play failed, waiting for canplay:', error);
        });

        return () => {
          videoElement.removeEventListener('canplay', handleCanPlay);
          videoElement.removeEventListener('error', handleError);
        };
      }
    }, [videoUrl]);

    return (
      <View style={[styles.container, webContainerStyle as any]}>
        {useImageFallback ? (
          <View style={styles.fallbackContainer} />
        ) : (
          // @ts-ignore - HTML5 video element for web
          <video
            ref={videoRef}
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
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
          />
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
