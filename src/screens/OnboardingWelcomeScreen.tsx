import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  Text,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Logo } from '../components/Logo';
import { OnboardingStatusBar } from '../components/onboarding/OnboardingStatusBar';
import { WelcomeWordmark } from '../components/onboarding/WelcomeWordmark';
import { ff, fs } from '../theme/fonts';

// Figma "Swelly Welcome Screen" (14082:24220), designed on a 393 × 852 frame.
// The background is TWO layers, exactly as in the file: the surfers photo, with a
// white sheet whose torn bottom edge feathers over the photo's top. They overlap
// by ~30% of the screen, so the seam can shift with screen size without ever
// opening a gap.
const IMG_SURFERS = require('../assets/onboarding/welcome-surfers.jpg');
const IMG_TOP_FADE = require('../assets/onboarding/welcome-top-fade.png');

/** Design frame width — every background measurement below is in these units. */
const DESIGN_WIDTH = 393;

// Photo: 488 × 731 at (-47, 190) on the 852-tall frame, i.e. it runs 69 past the
// bottom edge. Horizontally centred (its centre lands within 0.5 of the frame's).
const PHOTO_W = 488;
const PHOTO_H = 731;
const PHOTO_BOTTOM = -69;

// White sheet: 503 × 536 at (-46, -90), so its torn edge sits 406 above the
// bottom. Its centre is 9 right of the frame's — kept, it's the designed crop.
const FADE_W = 503;
const FADE_H = 536;
const FADE_BOTTOM = 406;
const FADE_CENTER_OFFSET = 9;

/** Where the white sheet ends — the floor for the logo + copy block. */
const SEAM = FADE_BOTTOM;

// Header group (14083:40828): logo 100 square at y 132, wordmark 287 wide at
// y 262, subtitle at y 310. Hence a 29.6 gap under the logo and the group's own
// 8 gap under the wordmark.
const LOGO_SIZE = 100;
const LOGO_TO_WORDMARK = 29.6;
const WORDMARK_WIDTH = 287;
const WORDMARK_TO_SUBTITLE = 8;

// The copy block is centred in the white area rather than pinned to y 132, so it
// stays clear of the seam on short screens. This bottom padding biases the
// centring upward just enough to land on the designed y 132 at 393 × 852.
const BLOCK_UPWARD_BIAS = 39;

// Main Button (14082:24223): 330 × 56 at x 31, 40 up from the bottom, radius 12.
const BUTTON_H = 56;
const BUTTON_INSET = 31;
const BUTTON_BOTTOM = 40;

/**
 * Local assets, so there is nothing to warm over the network. Kept exported
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
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Design units → device px. The background scales with width so it always
  // bleeds edge to edge; the type and logo keep their designed sizes.
  const k = width / DESIGN_WIDTH;
  const seam = SEAM * k;

  // This full-bleed screen isn't inside a native stack, so it has no built-in
  // swipe-back. Wire a horizontal right-swipe to onBack (returns to the previous
  // screen). Vertical drags fail the gesture so they don't trigger a back.
  const swipeBackGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(20)
    .failOffsetY([-25, 25])
    .onEnd((e) => {
      const isRightSwipe = e.translationX > 80 || (e.translationX > 40 && e.velocityX > 600);
      if (isRightSwipe && onBack) onBack();
    });

  return (
    <GestureDetector gesture={swipeBackGesture}>
    <View style={styles.root}>
      {/* Everything above the seam is white — dark bar icons, not the app-wide white. */}
      <OnboardingStatusBar />

      {/* ---- Background ---- */}
      <Image
        source={IMG_SURFERS}
        style={[
          styles.layer,
          {
            width: PHOTO_W * k,
            height: PHOTO_H * k,
            left: (width - PHOTO_W * k) / 2,
            bottom: PHOTO_BOTTOM * k,
          },
        ]}
        resizeMode="cover"
      />
      <Image
        source={IMG_TOP_FADE}
        style={[
          styles.layer,
          {
            width: FADE_W * k,
            height: FADE_H * k,
            left: (width - FADE_W * k) / 2 + FADE_CENTER_OFFSET * k,
            bottom: seam,
          },
        ]}
        resizeMode="cover"
      />

      {/* ---- Logo + copy, centred in the white area above the seam ---- */}
      <View style={[styles.header, { top: insets.top, bottom: seam }]}>
        <Logo size={LOGO_SIZE} iconOnly />
        <View style={styles.wordmarkWrap}>
          <WelcomeWordmark width={Math.min(WORDMARK_WIDTH, width - 32)} />
        </View>
        <Text style={styles.subtitle} allowFontScaling={false}>
          Your next surf trip starts here.
        </Text>
      </View>

      {/* ---- CTA ---- */}
      <View
        style={[
          styles.buttonWrap,
          { bottom: Math.max(insets.bottom + 6, BUTTON_BOTTOM) },
        ]}
      >
        <TouchableOpacity
          testID="onboarding-welcome-start"
          style={styles.button}
          activeOpacity={0.85}
          onPress={onNext}
          accessibilityRole="button"
          accessibilityLabel="Next"
        >
          <Text style={styles.buttonText} allowFontScaling={false}>
            Next
          </Text>
        </TouchableOpacity>
      </View>
    </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // The white the sheet fades from — also what fills the extra height above it
    // on screens taller than the 852 design frame.
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: BLOCK_UPWARD_BIAS,
  },
  wordmarkWrap: {
    marginTop: LOGO_TO_WORDMARK,
    marginBottom: WORDMARK_TO_SUBTITLE,
  },
  subtitle: {
    // Headings/Bold, Size/xl 18 over Size/3-xl 24, Text/M - 01.
    fontFamily: ff('Montserrat', '700'),
    fontSize: fs(18),
    lineHeight: 24,
    color: '#333333',
    textAlign: 'center',
    maxWidth: 329,
    ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : null),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  buttonWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: BUTTON_INSET,
  },
  button: {
    width: '100%',
    height: BUTTON_H,
    borderRadius: 12,
    // Surface/M 07
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    // Headings/SemiBold, Size/md 14 over Size/2-xl 22, Text/M - White.
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(14),
    lineHeight: 22,
    color: '#FFFFFF',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
});
