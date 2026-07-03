import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Platform, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Logo } from '../components/Logo';
import { ff, fs } from '../theme/fonts';

// Pre-composited background (both photos + torn-paper seams flattened into one
// image by design) — see Figma "Home Screen". Natural size 393×825 (cropped from
// the original 393×852 export, which had ~27px of transparent padding at the
// bottom that showed through as a white line above the screen's bottom edge).
// Width matches the 393pt design frame almost exactly, so this "zoomed out"
// version renders with little-to-no horizontal crop, unlike the earlier 457-wide
// asset which overflowed the screen width and cropped both sides more tightly.
const IMG_BACKGROUND = require('../assets/onboarding/welcome-background.png');
const BACKGROUND_RATIO = 393 / 825; // width / height

/**
 * Local asset, so there is nothing to warm over the network. Kept exported
 * because WelcomeScreen still calls `.forEach(Image.prefetch)` on sign-in; an
 * empty list is a harmless no-op.
 */
export const ONBOARDING_WELCOME_IMAGE_URLS: string[] = [];

interface OnboardingWelcomeScreenProps {
  onNext: () => void;
  onBack?: () => void;
  /** Unused — kept so existing call sites don't break. */
  updateFormData?: (data: any) => void;
}

export const OnboardingWelcomeScreen: React.FC<OnboardingWelcomeScreenProps> = ({
  onNext,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* Background — full screen height, horizontally centered. The image is
          wider than the screen at that height, so it overflows evenly on both
          sides (clipped by the root's overflow: hidden). */}
      <View style={styles.backgroundWrap} pointerEvents="none">
        <Image
          source={IMG_BACKGROUND}
          style={{ height: '100%', aspectRatio: BACKGROUND_RATIO }}
          resizeMode="cover"
        />
      </View>

      {/* Foggy fade behind the CTA — same treatment as TripDetailScreen's sticky
          CTA overlay (mirrors the profile "Connect to …" button), so the button
          reads cleanly over the photo instead of sitting flat on it. */}
      <View style={styles.ctaOverlay} pointerEvents="none">
        <LinearGradient
          colors={['rgba(250, 250, 250, 0)', 'rgba(250, 250, 250, 0.4)', 'rgba(250, 250, 250, 0.75)', '#FAFAFA']}
          locations={[0, 0.4, 0.72, 1]}
          style={styles.ctaOverlayGradient}
        />
      </View>

      {/* ---- Foreground content ---- */}
      <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
        <View style={styles.topSpacer} />
        <View style={styles.logoWrap}>
          <View style={styles.logoOutborder} />
          <Logo size={98} iconOnly />
        </View>
        <Text style={styles.title} allowFontScaling={false}>
          Yo! Let’s Travel.
        </Text>
        <Text style={styles.subtitle} allowFontScaling={false}>
          Your next surf trip{'\n'}starts here.
        </Text>

        <View style={styles.spacer} />

        <TouchableOpacity
          testID="onboarding-welcome-start"
          style={styles.button}
          activeOpacity={0.85}
          onPress={onNext}
        >
          <Text style={styles.buttonText} allowFontScaling={false}>
            Start Your Journey
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  backgroundWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  ctaOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 215,
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      backdropFilter: 'blur(6px)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
    }),
  },
  ctaOverlayGradient: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  topSpacer: {
    // Matches the logo's vertical position over the background photo's white gap.
    height: '25%',
  },
  logoWrap: {
    width: 106,
    height: 106,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoOutborder: {
    position: 'absolute',
    width: 106,
    height: 106,
    borderRadius: 106 / 2,
    backgroundColor: '#260E0C',
  },
  title: {
    marginTop: 26,
    fontFamily:
      Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-ExtraBoldItalic',
    fontSize: fs(28),
    lineHeight: 34,
    fontStyle: 'italic',
    color: '#000000',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '800' as const } : null),
  },
  subtitle: {
    marginTop: 18,
    fontFamily: ff('Inter', '600'),
    fontSize: fs(24),
    lineHeight: 28,
    color: '#000000',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
  },
  spacer: {
    flex: 1,
  },
  button: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(16),
    lineHeight: 24,
    color: '#FFFFFF',
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
  },
});
