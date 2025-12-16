import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getBackgroundVideoSource, getVideoUrl } from '../services/media/videoService';

// For web video element
let VideoElement: any = null;
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  VideoElement = 'video';
}

interface BackgroundVideoProps {
  videoSource?: string;
}

export const BackgroundVideo: React.FC<BackgroundVideoProps> = ({ 
  videoSource 
}) => {
  const [useImageFallback, setUseImageFallback] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const videoLoadedRef = useRef(false);
  
  // Get the video source URL(s)
  const videoSourceData = videoSource 
    ? getVideoUrl(videoSource) 
    : getBackgroundVideoSource();
  
  // Handle both string (legacy) and object (with WebM/MP4) formats
  const videoUrl = typeof videoSourceData === 'string' 
    ? videoSourceData 
    : videoSourceData.mp4;
  const webmUrl = typeof videoSourceData === 'object' && videoSourceData.webm
    ? videoSourceData.webm
    : null;

  // Get poster/thumbnail image URL (first frame of video or a static image)
  const posterImageUrl = Platform.OS === 'web' 
    ? '/welcome page/Vector.svg' // Use existing vector as placeholder
    : undefined;

  // Lazy load video - only start loading after component mounts
  useEffect(() => {
    // Start loading immediately - video is preloaded in HTML and cached
    // The delay was causing unnecessary wait time
    setShouldLoadVideo(true);
  }, []);

  // Create video player only when we should load the video (for mobile/non-web)
  // On web, we'll use HTML5 video element directly for better format support
  const player = useVideoPlayer(
    shouldLoadVideo && Platform.OS !== 'web' ? videoUrl : '', 
    (player: any) => {
      if (player && shouldLoadVideo && !videoLoadedRef.current) {
        try {
          player.loop = true;
          player.muted = true;
          // Set preload to metadata for faster initial load
          if (Platform.OS === 'web' && (player as any).preload !== undefined) {
            (player as any).preload = 'metadata';
          }
          videoLoadedRef.current = true;
        } catch (error) {
          console.error('Error initializing video player:', error);
        }
      }
    }
  );

  // Handle video loading and playback
  useEffect(() => {
    if (player && shouldLoadVideo && !isVideoReady) {
      // Set properties
      player.loop = true;
      player.muted = true;
      
      // Listen for when video is ready to play
      const handleCanPlay = () => {
        setIsVideoReady(true);
      };

      // Play the video when ready
      const playVideo = async () => {
        try {
          // Wait a bit for video to buffer
          await new Promise(resolve => setTimeout(resolve, 200));
          await player.play();
          setIsVideoReady(true);
        } catch (error) {
          console.error('Error playing background video:', error);
          setUseImageFallback(true);
        }
      };
      
      // Try to play immediately, but don't block on errors
      playVideo().catch(() => {
        // If immediate play fails, video will play when ready
        setUseImageFallback(true);
      });
    }
  }, [player, shouldLoadVideo, isVideoReady]);

  // Note: Video preload is handled in swelly_chat.html for better performance

  // Show poster image while video is loading
  if (!isVideoReady && !useImageFallback && posterImageUrl) {
    return (
      <View style={[styles.container, webContainerStyle as any]}>
        <Image
          source={{ uri: posterImageUrl }}
          style={[StyleSheet.absoluteFillObject, styles.posterImage]}
          resizeMode="cover"
        />
      </View>
    );
  }

  if (useImageFallback) {
    return (
      <View style={styles.container}>
        <Image
          source={{ uri: posterImageUrl || videoUrl }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      </View>
    );
  }

  if (!shouldLoadVideo) {
    // Show placeholder while waiting to load
    return (
      <View style={[styles.container, webContainerStyle as any]}>
        {posterImageUrl && (
          <Image
            source={{ uri: posterImageUrl }}
            style={[StyleSheet.absoluteFillObject, styles.posterImage]}
            resizeMode="cover"
          />
        )}
      </View>
    );
  }

  // For web, use HTML5 video element with source fallback for better format support
  if (Platform.OS === 'web' && webmUrl && VideoElement) {
    return (
      <View style={[styles.container, webContainerStyle as any]}>
        {/* Show poster image behind video while loading */}
        {!isVideoReady && posterImageUrl && (
          <Image
            source={{ uri: posterImageUrl }}
            style={[StyleSheet.absoluteFillObject, styles.posterImage]}
            resizeMode="cover"
          />
        )}
        {/* Use HTML5 video element for better format support on web */}
        {React.createElement(
          VideoElement,
          {
            autoPlay: true,
            loop: true,
            muted: true,
            playsInline: true,
            style: webVideoStyle,
            onCanPlay: () => setIsVideoReady(true),
            onError: () => setUseImageFallback(true),
            children: [
              React.createElement('source', { key: 'webm', src: webmUrl, type: 'video/webm' }),
              React.createElement('source', { key: 'mp4', src: videoUrl, type: 'video/mp4' }),
            ],
          }
        )}
      </View>
    );
  }

  // For mobile or when WebM is not available, use VideoView
  return (
    <View style={[styles.container, webContainerStyle as any]}>
      {/* Show poster image behind video while loading */}
      {!isVideoReady && posterImageUrl && (
        <Image
          source={{ uri: posterImageUrl }}
          style={[StyleSheet.absoluteFillObject, styles.posterImage]}
          resizeMode="cover"
        />
      )}
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
  posterImage: {
    opacity: 1,
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
