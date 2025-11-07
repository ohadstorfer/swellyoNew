import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getBackgroundVideoSource, getVideoUrl } from '../utils/videoUtils';

interface BackgroundVideoProps {
  videoSource?: string;
}

export const BackgroundVideo: React.FC<BackgroundVideoProps> = ({ 
  videoSource 
}) => {
  const [useImageFallback, setUseImageFallback] = useState(false);
  
  // Get the video source URL
  const videoUrl = videoSource 
    ? getVideoUrl(videoSource) 
    : getBackgroundVideoSource();

  // Create video player
  const player = useVideoPlayer(videoUrl, (player: any) => {
    if (player) {
      player.loop = true;
      player.muted = true;
      player.play();
    }
  });

  // Ensure video plays after mount and handle errors
  useEffect(() => {
    if (player) {
      // Set properties again to ensure they're applied
      player.loop = true;
      player.muted = true;
      
      // Play the video
      const playVideo = async () => {
        try {
          await player.play();
        } catch (error) {
          console.error('Error playing background video:', error);
          setUseImageFallback(true);
        }
      };
      
      playVideo();
    }
  }, [player]);

  if (useImageFallback) {
    return (
      <View style={styles.container}>
        <Image
          source={{ uri: videoUrl }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <VideoView
        player={player}
        style={styles.video}
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
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      display: 'block' as any,
    } as any),
  },
});
