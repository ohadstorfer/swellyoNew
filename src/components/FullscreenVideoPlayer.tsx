import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Only import expo-video on native
let useVideoPlayer: any = null;
let VideoView: any = null;
if (Platform.OS !== 'web') {
  try {
    const expoVideo = require('expo-video');
    useVideoPlayer = expoVideo.useVideoPlayer;
    VideoView = expoVideo.VideoView;
  } catch {}
}

interface FullscreenVideoPlayerProps {
  visible: boolean;
  videoUrl: string;
  onClose: () => void;
}

const WebVideoPlayer: React.FC<{ videoUrl: string; visible: boolean }> = ({ videoUrl, visible }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (visible && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
    if (!visible && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [visible]);

  if (!visible || !videoUrl) return null;

  return (
    <video
      ref={videoRef}
      src={videoUrl}
      controls
      autoPlay
      playsInline
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        backgroundColor: '#000',
      }}
    />
  );
};

const NativeVideoPlayer: React.FC<{ videoUrl: string; visible: boolean }> = ({ videoUrl, visible }) => {
  if (!useVideoPlayer || !VideoView) return null;

  const player = useVideoPlayer(visible ? videoUrl : null, (p: any) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });

  if (!visible || !videoUrl) return null;

  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls={true}
    />
  );
};

export const FullscreenVideoPlayer: React.FC<FullscreenVideoPlayerProps> = ({
  visible,
  videoUrl,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.container}>
        {/* Close button */}
        <TouchableOpacity
          style={[styles.closeButton, { top: Platform.OS === 'web' ? 16 : insets.top + 10 }]}
          onPress={onClose}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </TouchableOpacity>

        {Platform.OS === 'web' ? (
          <WebVideoPlayer videoUrl={videoUrl} visible={visible} />
        ) : (
          <NativeVideoPlayer videoUrl={videoUrl} visible={visible} />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    flex: 1,
  },
});
