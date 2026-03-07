import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Text } from './Text';
import { colors, spacing, borderRadius } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';
import { getVideoUrl } from '../services/media/videoService';

interface WelcomeToLineupOverlayProps {
  visible: boolean;
  onNext: () => void;
}

// Figma: backdrop #212121 80%, card white 16px radius, shadow, title #b72df2, body #333, button #212121 pill
const BACKDROP_COLOR = 'rgba(33, 33, 33, 0.8)';
const TITLE_COLOR = '#b72df2';
const CARD_SHADOW = {
  shadowColor: '#596E7C',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.15,
  shadowRadius: 16,
  elevation: 8,
};

const LOADING_VIDEO_PATH = '/Loading 4 to 5.mp4';

export const WelcomeToLineupOverlay: React.FC<WelcomeToLineupOverlayProps> = ({
  visible,
  onNext,
}) => {
  const videoUrl = getVideoUrl(LOADING_VIDEO_PATH);
  const player = useVideoPlayer(videoUrl, (p) => {
    if (p) {
      p.loop = true;
      p.muted = true;
      p.play();
    }
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onNext}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.backdrop}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, CARD_SHADOW]}>
            <Text style={styles.title}>Welcome to The Lineup!</Text>

            <View style={styles.illustrationContainer}>
              {player ? (
                <VideoView
                  player={player}
                  style={styles.illustration}
                  contentFit="cover"
                  nativeControls={false}
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                />
              ) : null}
            </View>

            <View style={styles.block}>
              <View style={styles.blockIconRow}>
                <Ionicons name="chatbubbles-outline" size={24} color={colors.textPrimary} />
              </View>
              <Text style={styles.blockHeading}>Drop into The Lineup!</Text>
              <Text style={styles.blockBody}>
                This is your home base to chat with like minded surfers. Better connections, peer advice & community drive travel!
              </Text>
            </View>

            <View style={styles.block}>
              <View style={styles.blockIconRow}>
                <Ionicons name="star" size={20} color={colors.textPrimary} />
              </View>
              <Text style={styles.blockHeading}>Talk with Swelly</Text>
              <Text style={styles.blockBody}>
                Swelly can introduce you to surfers who match your style and travel interests. Get peer guidance on all things surf and destinations you want to explore.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.nextButton}
              onPress={onNext}
              activeOpacity={0.8}
            >
              <Text style={styles.nextButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BACKDROP_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: colors.white,
    borderRadius: borderRadius.medium,
    paddingTop: spacing.xl,
    paddingHorizontal: 19,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: TITLE_COLOR,
    textAlign: 'center',
    marginBottom: spacing.lg,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  illustrationContainer: {
    width: 244,
    height: 244,
    alignSelf: 'center',
    marginBottom: spacing.lg,
    backgroundColor: '#f5f5f5',
    borderRadius: borderRadius.small,
    overflow: 'hidden',
  },
  illustration: {
    width: '100%',
    height: '100%',
  },
  block: {
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  blockIconRow: {
    marginBottom: spacing.xs,
    alignSelf: 'center',
  },
  blockHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  blockBody: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  nextButton: {
    backgroundColor: '#212121',
    height: 56,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
    minWidth: 150,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  nextButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
});
