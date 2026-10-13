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
import { OnboardingStatusBar } from '../components/onboarding/OnboardingStatusBar';
import {
  OnboardingScriptTitle,
  type OnboardingScriptTitleName,
} from '../components/onboarding/OnboardingScriptTitle';
import { ff, fs } from '../theme/fonts';

// The two pelican pauses between onboarding sections, both designed on a
// 393 × 852 frame:
//   'surf'   — "Yewww!"         (Figma 17040:42005), after "Show us your style"
//   'travel' — "Let's Get Viby" (Figma 17040:42140), after the budget step
// Full-bleed like the step 0 welcome: no back arrow, no progress bar, own CTA.

export type OnboardingInterstitialKind = 'surf' | 'travel';

const DESIGN_HEIGHT = 852;

// Main Button: 330 × 56 at x 31, 40 up from the bottom, radius 12 — the same
// button as OnboardingWelcomeScreen.
const BUTTON_H = 56;
const BUTTON_INSET = 31;
const BUTTON_BOTTOM = 40;

const CONTENT: Record<
  OnboardingInterstitialKind,
  {
    image: number;
    /** Pelican box and its y on the design frame. */
    imageW: number;
    imageH: number;
    imageTop: number;
    title: OnboardingScriptTitleName;
    titleLabel: string;
    /** Title y minus the pelican's bottom edge. Negative = they overlap. */
    titleGap: number;
    bodyGap: number;
    body: string;
    cta: string;
  }
> = {
  surf: {
    image: require('../assets/onboarding/pelican-surfing.png'),
    imageW: 252,
    imageH: 315,
    imageTop: 58,
    title: 'yewww',
    titleLabel: 'Yewww!',
    titleGap: 11,
    bodyGap: 27,
    body:
      'Well done! Now that your surf\nstyle is dialed, lets get some\ndetails on your travel\nexperience!',
    cta: 'Next Set!',
  },
  travel: {
    image: require('../assets/onboarding/pelican-zen.png'),
    imageW: 233,
    imageH: 291,
    imageTop: 93,
    title: 'viby',
    titleLabel: "Let's Get Viby",
    titleGap: -7,
    bodyGap: 22,
    body:
      'Travel style is set!\n\nLet’s drop in on your lifestyle.\nWhat are the things that make\nyou flow when out of\nthe water?\n\nNo typing...selections only 🤙🏼',
    cta: 'Drop In!',
  },
};

interface OnboardingInterstitialScreenProps {
  kind: OnboardingInterstitialKind;
  onNext: () => void;
  onBack?: () => void;
}

export const OnboardingInterstitialScreen: React.FC<OnboardingInterstitialScreenProps> = ({
  kind,
  onNext,
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const c = CONTENT[kind];

  // The pelican's y scales with the screen so the block keeps its place on
  // taller and shorter phones; it never rides up under the status bar.
  const top = Math.max(insets.top + 8, (c.imageTop * height) / DESIGN_HEIGHT);
  const buttonBottom = Math.max(insets.bottom + 6, BUTTON_BOTTOM);

  // Not inside a native stack, so no built-in swipe-back — same wiring as the
  // step 0 welcome.
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
        <OnboardingStatusBar />

        <View
          style={[
            styles.content,
            { paddingTop: top, paddingBottom: buttonBottom + BUTTON_H + 16 },
          ]}
        >
          <Image
            source={c.image}
            style={{ width: c.imageW, height: c.imageH }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={{ marginTop: c.titleGap }}>
            <OnboardingScriptTitle name={c.title} accessibilityLabel={c.titleLabel} />
          </View>
          <Text style={[styles.body, { marginTop: c.bodyGap }]} allowFontScaling={false}>
            {c.body}
          </Text>
        </View>

        <View style={[styles.buttonWrap, { bottom: buttonBottom }]}>
          <TouchableOpacity
            testID={`onboarding-interstitial-${kind}-next`}
            style={styles.button}
            activeOpacity={0.85}
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel={c.cta}
          >
            <Text style={styles.buttonText} allowFontScaling={false}>
              {c.cta}
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
    // BG/M - Secondary, the same ground as steps 1–7.
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  body: {
    // Montserrat Medium 16/24, black — a literal in Figma (no size variable).
    fontFamily: ff('Montserrat', '500'),
    fontSize: fs(16),
    lineHeight: 24,
    color: '#000000',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '500' as const } : null),
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
    // Figma has this at Size/md 14; kept at 16/24 like the welcome screen and
    // the scaffold's Next button so the label doesn't resize between steps.
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(16),
    lineHeight: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
});
