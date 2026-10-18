import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  Text,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  Extrapolation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { OnboardingStatusBar } from '../components/onboarding/OnboardingStatusBar';
import { WavelengthHeading } from '../components/onboarding/ProfileStepsArt';
import {
  WelcomeLogoMark,
  WelcomeToSwellyoTitle,
  ProfileStepLabel,
} from '../components/onboarding/WelcomeArt';
import { textStyle, textStyles } from '../theme/typography';
import { ff, fs } from '../theme/fonts';

// Figma "Swelly Welcome Screen" — two frames of one screen, 393 × 852:
//   A (14113:27719) "Welcome to Swellyo": logo, script title, tagline, three lines,
//     the surfers photo at full strength.
//   B (18058:21566) "Let's get on the same wave length": heading, intro, the three
//     onboarding steps, the photo faded to 20% and 60 lower, the CTA.
// A holds for a moment, then the screen animates into B (Smart Animate in Figma:
// A's text leaves upward, B's arrives, the button rises in from below the frame).
const DESIGN_WIDTH = 393;
const DESIGN_HEIGHT = 852;

// Art and gaps scale with the screen; copy and the button stay fixed — text must
// not resize between onboarding steps.
const MIN_SCALE = 0.78;
const MAX_SCALE = 1.25;

// Frame A rhythm: logo 90–190, title 230 (32) → 8 → tagline (24) → 40 → three
// lines 24 tall, 32 apart. The last line ends at 470.
const A_TOP = 90;
const A_BOTTOM = 470;
const LOGO_SIZE = 100;
const LOGO_TO_TITLE = 40;
const TITLE_W = 291;
const TITLE_TO_TAGLINE = 8;
const TAGLINE_TO_LINES = 40;
const BETWEEN_LINES = 32;

// Frame B rhythm: heading 111–164 → 14 → intro (36) → 55 → step 1, then 56
// between steps; each step is label → 8 → copy. The last copy ends at 572.
const B_TOP = 111;
const B_BOTTOM = 572;
const HEADING_W = 329;
const HEADING_TO_INTRO = 14;
const INTRO_W = 303;
const INTRO_TO_STEPS = 55;
const BETWEEN_STEPS = 56;
const LABEL_TO_COPY = 8;

// Photo (14113:27720): 488 wide, 1.5 tall, centred 2.5 left of the frame's
// centre. Its image starts 77 into its box, i.e. y 274 in A and y 334 in B, where
// it is also at 20% opacity.
const PHOTO = require('../assets/onboarding/welcome-surfers.jpg');
const PHOTO_W = 488;
const PHOTO_ASPECT = 1.5;
const PHOTO_TOP = 274;
const PHOTO_SHIFT_B = 60;
const PHOTO_OPACITY_B = 0.2;

// Main Button (18058:21618): 330 × 56, radius 12, 70 up from the bottom in B.
const BUTTON_H = 56;
const BUTTON_INSET = 31;
const BUTTON_BOTTOM = 70;
// Wide screens (iPad, desktop web) keep a phone-width button.
const BUTTON_MAX_W = 400;

// How long A holds before it moves on by itself (a tap skips the wait), and the
// length of the A → B move.
const INTRO_HOLD_MS = 4000;
const TRANSITION_MS = 900;
// Strong ease-in-out: this is on-screen movement, not an entrance from nowhere.
const EASE = Easing.bezier(0.77, 0, 0.175, 1);

const LINES = ['Show Up As You Are', 'Go Where It Feels Right', 'Find Your People'];

const STEPS: { n: 1 | 2 | 3; copy: string }[] = [
  { n: 1, copy: 'How you ride + your experience.' },
  { n: 2, copy: 'Where you have been & your budget range.' },
  { n: 3, copy: 'A little about you out of the water.' },
];

/**
 * Nothing on this screen loads over the network. Kept exported because
 * WelcomeScreen still calls `.forEach(Image.prefetch)` on sign-in; an empty
 * list is a harmless no-op.
 */
export const ONBOARDING_WELCOME_IMAGE_URLS: string[] = [];

interface OnboardingWelcomeScreenProps {
  onNext: () => void;
  onBack?: () => void;
  /** Unused — kept so existing call sites don't break. */
  updateFormData?: (data: any) => void;
}

/** One piece of B: fades in and settles 16 up, starting a little after the last. */
const FadeUp: React.FC<{
  progress: SharedValue<number>;
  index: number;
  reduceMotion: boolean;
  children: React.ReactNode;
  style?: any;
}> = ({ progress, index, reduceMotion, children, style }) => {
  const start = 0.35 + index * 0.08;
  const animated = useAnimatedStyle(() => {
    const t = interpolate(progress.value, [start, start + 0.4], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: t,
      transform: [{ translateY: reduceMotion ? 0 : (1 - t) * 16 }],
    };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
};

export const OnboardingWelcomeScreen: React.FC<OnboardingWelcomeScreenProps> = ({
  onNext,
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT)),
  );
  // Vertical positions taken off the frame follow the screen's height, the way
  // the flex spacers below split the free space.
  const yScale = height / DESIGN_HEIGHT;
  const buttonBottom = Math.max(insets.bottom + 12, BUTTON_BOTTOM * Math.min(yScale, 1));

  const photoW = Math.max(PHOTO_W * scale, width);
  const photoH = photoW * PHOTO_ASPECT;

  // 0 = frame A, 1 = frame B. Every visit to step 0 starts on A — on first
  // arrival, on a swipe back from step 1, and for each new sign-up.
  const progress = useSharedValue(0);
  const [showingSteps, setShowingSteps] = useState(false);
  const started = useRef(false);

  const toSteps = useCallback(() => {
    if (started.current) return;
    started.current = true;
    progress.value = withTiming(1, { duration: TRANSITION_MS, easing: EASE }, (done) => {
      if (done) runOnJS(setShowingSteps)(true);
    });
  }, [progress]);

  useEffect(() => {
    const timer = setTimeout(toSteps, INTRO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [toSteps]);

  const introStyle = useAnimatedStyle(() => {
    const t = interpolate(progress.value, [0, 0.45], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: 1 - t,
      transform: [{ translateY: reduceMotion ? 0 : -24 * t }],
    };
  });

  const photoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, PHOTO_OPACITY_B]),
    transform: [
      { translateY: reduceMotion ? 0 : interpolate(progress.value, [0, 1], [0, PHOTO_SHIFT_B * yScale]) },
    ],
  }));

  // The button rises from below the frame, like Figma's off-frame start.
  const buttonStyle = useAnimatedStyle(() => {
    const t = interpolate(progress.value, [0.5, 1], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: reduceMotion ? t : 1,
      transform: [{ translateY: reduceMotion ? 0 : (1 - t) * (BUTTON_H + buttonBottom + 24) }],
    };
  });

  // Not inside a native stack, so no built-in swipe-back. A right-swipe goes back;
  // vertical drags fail the gesture.
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

        <Animated.View
          pointerEvents="none"
          style={[
            styles.photo,
            {
              width: photoW,
              height: photoH,
              top: PHOTO_TOP * yScale,
              left: (width - photoW) / 2 - 2.5 * scale,
            },
            photoStyle,
          ]}
        >
          <Image
            source={PHOTO}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>

        {/* Frame A. Tapping anywhere skips the wait. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, introStyle]}
          pointerEvents={showingSteps ? 'none' : 'auto'}
          accessibilityElementsHidden={showingSteps}
          importantForAccessibility={showingSteps ? 'no-hide-descendants' : 'auto'}
        >
          <Pressable
            style={styles.layer}
            onPress={toSteps}
            accessibilityRole="button"
            accessibilityHint="Continues"
          >
            <View style={{ flex: A_TOP, minHeight: insets.top + 16 }} />
            <WelcomeLogoMark size={LOGO_SIZE * scale} />
            <View style={{ marginTop: LOGO_TO_TITLE * scale }}>
              <WelcomeToSwellyoTitle width={TITLE_W * scale} />
            </View>
            <Text
              style={[styles.tagline, { marginTop: TITLE_TO_TAGLINE * scale }]}
              allowFontScaling={false}
            >
              Travel Better Together.
            </Text>
            {LINES.map((line, i) => (
              <Text
                key={line}
                style={[
                  styles.line,
                  { marginTop: (i === 0 ? TAGLINE_TO_LINES : BETWEEN_LINES) * scale },
                ]}
                allowFontScaling={false}
              >
                {line}
              </Text>
            ))}
            <View style={{ flex: DESIGN_HEIGHT - A_BOTTOM }} />
          </Pressable>
        </Animated.View>

        {/* Frame B. */}
        <View
          style={[styles.layer, StyleSheet.absoluteFill]}
          pointerEvents="none"
          accessibilityElementsHidden={!showingSteps}
          importantForAccessibility={showingSteps ? 'auto' : 'no-hide-descendants'}
        >
          <View style={{ flex: B_TOP, minHeight: insets.top + 16 }} />
          <FadeUp progress={progress} index={0} reduceMotion={reduceMotion}>
            <WavelengthHeading width={HEADING_W * scale} />
          </FadeUp>
          <FadeUp progress={progress} index={1} reduceMotion={reduceMotion}>
            <Text
              style={[styles.copy, styles.intro, { marginTop: HEADING_TO_INTRO * scale }]}
              allowFontScaling={false}
            >
              Your profile helps us connect you to people, places, and trips.
            </Text>
          </FadeUp>
          {STEPS.map((step, i) => (
            <FadeUp
              key={step.n}
              progress={progress}
              index={i + 2}
              reduceMotion={reduceMotion}
              style={[
                styles.step,
                { marginTop: (i === 0 ? INTRO_TO_STEPS : BETWEEN_STEPS) * scale },
              ]}
            >
              <ProfileStepLabel n={step.n} scale={scale} />
              <Text
                style={[styles.copy, { marginTop: LABEL_TO_COPY * scale }]}
                allowFontScaling={false}
              >
                {step.copy}
              </Text>
            </FadeUp>
          ))}
          <View
            style={{
              flex: DESIGN_HEIGHT - BUTTON_BOTTOM - BUTTON_H - B_BOTTOM,
              minHeight: 16,
              marginBottom: buttonBottom + BUTTON_H,
            }}
          />
        </View>

        <Animated.View
          style={[styles.buttonWrap, { bottom: buttonBottom }, buttonStyle]}
          pointerEvents={showingSteps ? 'box-none' : 'none'}
        >
          <TouchableOpacity
            testID="onboarding-welcome-start"
            style={styles.button}
            activeOpacity={0.85}
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel="Let's create your profile!"
          >
            <Text style={styles.buttonText} allowFontScaling={false}>
              Let’s create your profile!
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // BG/M - Primary.
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  photo: {
    position: 'absolute',
  },
  layer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  tagline: {
    // Body/M B-1 (Size/lg 16, 24) with the weight overridden to Bold; Text/M - 01.
    ...textStyle('MB1', '700'),
    color: '#333333',
    textAlign: 'center',
  },
  line: {
    // Headings/M H-5 (Size/xl 18 over Size/3 xl 24); Text/M - 01.
    ...textStyles.MH5,
    color: '#333333',
    textAlign: 'center',
  },
  copy: {
    // Body/M B-2 (Size/md 14 over Size/xl 18), black.
    ...textStyles.MB2,
    color: '#000000',
    textAlign: 'center',
  },
  intro: {
    maxWidth: INTRO_W,
  },
  step: {
    alignItems: 'center',
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
    // Headings/SemiBold, Text/M - White. Figma has this at Size/md 14, but it's
    // bumped to 16/24 to match the Next button the scaffold renders on steps 1-7
    // (OnboardingChrome) — the label shouldn't resize on the step 0 → 1 hop.
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(16),
    lineHeight: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
});
