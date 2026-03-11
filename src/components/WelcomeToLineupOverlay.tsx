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
import Svg, { Path } from 'react-native-svg';
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
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M7.5 12H7.51M12 12H12.01M16.5 12H16.51M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 13.1971 3.23374 14.3397 3.65806 15.3845C3.73927 15.5845 3.77988 15.6845 3.798 15.7653C3.81572 15.8443 3.8222 15.9028 3.82221 15.9839C3.82222 16.0667 3.80718 16.1569 3.77711 16.3374L3.18413 19.8952C3.12203 20.2678 3.09098 20.4541 3.14876 20.5888C3.19933 20.7067 3.29328 20.8007 3.41118 20.8512C3.54589 20.909 3.73218 20.878 4.10476 20.8159L7.66265 20.2229C7.84309 20.1928 7.9333 20.1778 8.01613 20.1778C8.09715 20.1778 8.15566 20.1843 8.23472 20.202C8.31554 20.2201 8.41552 20.2607 8.61549 20.3419C9.6603 20.7663 10.8029 21 12 21ZM8 12C8 12.2761 7.77614 12.5 7.5 12.5C7.22386 12.5 7 12.2761 7 12C7 11.7239 7.22386 11.5 7.5 11.5C7.77614 11.5 8 11.7239 8 12ZM12.5 12C12.5 12.2761 12.2761 12.5 12 12.5C11.7239 12.5 11.5 12.2761 11.5 12C11.5 11.7239 11.7239 11.5 12 11.5C12.2761 11.5 12.5 11.7239 12.5 12ZM17 12C17 12.2761 16.7761 12.5 16.5 12.5C16.2239 12.5 16 12.2761 16 12C16 11.7239 16.2239 11.5 16.5 11.5C16.7761 11.5 17 11.7239 17 12Z"
                    stroke="#222B30"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <Text style={styles.blockHeading}>Drop into The Lineup!</Text>
              <Text style={styles.blockBody}>
                This is your home base to chat with like minded surfers. Better connections, peer advice & community driven travel!
              </Text>
            </View>

            <View style={styles.block}>
              <View style={styles.blockIconRow}>
                <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
                  <Path
                    d="M3.75033 18.3333V14.1666M3.75033 5.83329V1.66663M1.66699 3.74996H5.83366M1.66699 16.25H5.83366M10.8337 2.49996L9.38851 6.25734C9.1535 6.86837 9.036 7.17388 8.85327 7.43086C8.69132 7.65862 8.49232 7.85762 8.26456 8.01957C8.00758 8.2023 7.70207 8.3198 7.09104 8.55481L3.33366 9.99996L7.09104 11.4451C7.70207 11.6801 8.00758 11.7976 8.26456 11.9804C8.49232 12.1423 8.69132 12.3413 8.85327 12.5691C9.036 12.826 9.1535 13.1315 9.38851 13.7426L10.8337 17.5L12.2788 13.7426C12.5138 13.1315 12.6313 12.826 12.8141 12.5691C12.976 12.3413 13.175 12.1423 13.4028 11.9804C13.6597 11.7976 13.9652 11.6801 14.5763 11.4451L18.3337 9.99996L14.5763 8.55481C13.9652 8.3198 13.6597 8.2023 13.4028 8.01957C13.175 7.85762 12.976 7.65862 12.814 7.43086C12.6313 7.17388 12.5138 6.86837 12.2788 6.25734L10.8337 2.49996Z"
                    stroke="#222B30"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
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
