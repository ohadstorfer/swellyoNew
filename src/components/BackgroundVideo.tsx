import React, { useState } from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { Video, ResizeMode } from 'expo-av';

interface BackgroundVideoProps {
  videoSource?: { uri: string };
}

const getBackgroundVideoSource = () => {
  if (Platform.OS === 'web') {
    return { uri: '/swellyo welcome video.mp4' };
  }
  return { uri: 'swellyo169welcome.mp4' };
};

export const BackgroundVideo: React.FC<BackgroundVideoProps> = ({ 
  videoSource = getBackgroundVideoSource() 
}) => {
  const [useImageFallback, setUseImageFallback] = useState(false);

  if (useImageFallback) {
    return (
      <View style={styles.container}>
        <Image
          source={videoSource}
          style={StyleSheet.absoluteFillObject}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
  source={videoSource}
  style={styles.video}
  resizeMode={ResizeMode.COVER}
  shouldPlay
  isLooping
  isMuted
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
  });
