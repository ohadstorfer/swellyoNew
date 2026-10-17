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

const DESIGN_WIDTH = 393;
const DESIGN_HEIGHT = 852;

// The pelican, title and gaps scale with the screen (fit to the 393 × 852
// frame) so a Pro Max keeps the Figma proportions and an SE still fits. The
// body copy and the button stay fixed — text must not resize between steps.
const MIN_SCALE = 0.78;
const MAX_SCALE = 1.25;

// Main Button: 330 × 56 at x 31, 40 up from the bottom, radius 12 — the same
// button as OnboardingWelcomeScreen.
const BUTTON_H = 56;
const BUTTON_INSET = 31;
const BUTTON_BOTTOM = 40;
const BUTTON_TOP = DESIGN_HEIGHT - BUTTON_BOTTOM - BUTTON_H; // 756
// Wide screens (iPad, desktop web) keep a phone-width button.
const BUTTON_MAX_W = 400;

const CONTENT: Record<
  OnboardingInterstitialKind,
  {
    image: number;
    /** Pelican box and its y on the design frame. */
    imageW: number;
    imageH: number;
    imageTop: number;
    /** Bottom edge of the body copy on the design frame. */
    contentBottom: number;
    title: OnboardingScriptTitleName;
    titleW: number;
    titleLabel: string;
    /** Title y minus the pelican's bottom edge. Negative = they overlap. */
    titleGap: number;
    bodyGap: number;
    /** Body weight + line height — the two screens differ in Figma. */
    bodyWeight: '400' | '500';
    bodyLineHeight: number;
    body: string;
    cta: string;
  }
> = {
  surf: {
    image: require('../assets/onboarding/pelican-surfing.png'),
    imageW: 252,
    imageH: 315,
    imageTop: 138,
    contentBottom: 626,
    title: 'yewww',
    titleW: 185.361,
    titleLabel: 'Yewww!',
    titleGap: 11,
    bodyGap: 27,
    // Montserrat Medium 16/24 — a literal in Figma (no size variable).
    bodyWeight: '500',
    bodyLineHeight: 24,
    body:
      'Well done! Now that your surf\nstyle is dialed, lets get some\ndetails on your travel\nexperience!',
    cta: 'Next Set!',
  },
  travel: {
    image: require('../assets/onboarding/pelican-zen.png'),
    imageW: 233,
    imageH: 291,
    imageTop: 93,
    contentBottom: 608,
    title: 'viby',
    titleW: 228,
    titleLabel: "Let's Get Viby",
    titleGap: -7,
    // Title bottom (410) → body top (448) on the frame.
    bodyGap: 38,
    // Headings/H-7 (Size/s 16 over Size/lg 20) with the weight overridden to
    // Regular in Figma (17040:42153) — not the Medium of the surf screen.
    bodyWeight: '400',
    bodyLineHeight: 20,
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
  const { width, height } = useWindowDimensions();
  const c = CONTENT[kind];

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT)),
  );
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

        <View style={[styles.content, { paddingBottom: buttonBottom + BUTTON_H }]}>
          {/* The free space above and below the block splits in the Figma
              ratio (screen top → pelican : body → button), so on the design
              frame the pelican lands exactly at imageTop and on any other
              screen the block keeps the same relative place. The top spacer
              never lets it ride up under the status bar. */}
          <View style={{ flex: c.imageTop, minHeight: insets.top + 8 }} />
          <Image
            source={c.image}
            style={{ width: c.imageW * scale, height: c.imageH * scale }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={{ marginTop: c.titleGap * scale }}>
            <OnboardingScriptTitle
              name={c.title}
              width={c.titleW * scale}
              accessibilityLabel={c.titleLabel}
            />
          </View>
          <Text
            style={[
              styles.body,
              {
                marginTop: c.bodyGap * scale,
                fontFamily: ff('Montserrat', c.bodyWeight),
                lineHeight: c.bodyLineHeight,
              },
              Platform.OS === 'web' && { fontWeight: c.bodyWeight },
            ]}
            allowFontScaling={false}
          >
            {c.body}
          </Text>
          <View style={{ flex: BUTTON_TOP - c.contentBottom, minHeight: 16 }} />
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
    // Family, weight and line height come from CONTENT per screen.
    fontSize: fs(16),
    color: '#000000',
    textAlign: 'center',
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  buttonWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: BUTTON_INSET,
  },
  button: {
    width: '100%',
    maxWidth: BUTTON_MAX_W,
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
