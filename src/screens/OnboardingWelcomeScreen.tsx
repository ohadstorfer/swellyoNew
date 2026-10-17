import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Text,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { OnboardingStatusBar } from '../components/onboarding/OnboardingStatusBar';
import {
  WavelengthHeading,
  ProfileStepTitle,
  ProfileStepNumber,
  type ProfileStepName,
} from '../components/onboarding/ProfileStepsArt';
import { ff, fs } from '../theme/fonts';

// Figma "3 Steps to creating profile" (17040:38828), designed on a 393 × 852
// frame: a hand-lettered heading, a short intro, then the three onboarding
// sections (Surf / Travel / Vibe), each a circled number, a script title and
// one line of copy.
const DESIGN_WIDTH = 393;
const DESIGN_HEIGHT = 852;

// The art and the gaps scale with the screen (fit to the design frame) so a
// Pro Max keeps the Figma proportions and an SE still fits. Copy and the button
// stay fixed — text must not resize between steps.
const MIN_SCALE = 0.78;
const MAX_SCALE = 1.25;

// Vertical rhythm on the frame. Heading 96–140, intro 204–276, then per step:
// number (28) → 10 → title → 8 → copy (48), and 27 between steps. The last
// copy ends at 698.
const HEADING_TOP = 96;
const CONTENT_BOTTOM = 698;
const HEADING_TO_INTRO = 64;
const INTRO_TO_STEPS = 33;
const NUMBER_TO_TITLE = 10;
const TITLE_TO_COPY = 8;
const BETWEEN_STEPS = 27;

// Main Button (17040:38829): 330 × 56 at x 31, 40 up from the bottom, radius 12.
const BUTTON_H = 56;
const BUTTON_INSET = 31;
const BUTTON_BOTTOM = 40;
const BUTTON_TOP = DESIGN_HEIGHT - BUTTON_BOTTOM - BUTTON_H; // 756
// Wide screens (iPad, desktop web) keep a phone-width button.
const BUTTON_MAX_W = 400;

const STEPS: { n: 1 | 2 | 3; name: ProfileStepName; copy: string }[] = [
  { n: 1, name: 'surf', copy: 'How you ride + your\nexperience.' },
  { n: 2, name: 'travel', copy: 'Where you have been &\nyour budget range.' },
  { n: 3, name: 'vibe', copy: 'A little about you out of\nthe water.' },
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

export const OnboardingWelcomeScreen: React.FC<OnboardingWelcomeScreenProps> = ({
  onNext,
  onBack,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT)),
  );
  const buttonBottom = Math.max(insets.bottom + 6, BUTTON_BOTTOM);

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
        <OnboardingStatusBar />

        {/* Scrolls only when the block can't fit (tiny phones, large text
            zoom); otherwise it fills the screen and the spacers place it. */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: buttonBottom + BUTTON_H },
          ]}
          alwaysBounceVertical={false}
          showsVerticalScrollIndicator={false}
        >
          {/* The free space above and below the block splits in the Figma
              ratio (screen top → heading : last copy → button), so on the
              design frame the heading lands exactly at y 96 and on any other
              screen the block keeps the same relative place. */}
          <View style={{ flex: HEADING_TOP, minHeight: insets.top + 16 }} />

          <WavelengthHeading width={273 * scale} />

          <Text
            style={[styles.copy, { marginTop: HEADING_TO_INTRO * scale }]}
            allowFontScaling={false}
          >
            {'Your profile helps us\nconnect you to people,\nplaces, and trips.'}
          </Text>

          {STEPS.map((step, i) => (
            <View
              key={step.name}
              style={[
                styles.step,
                { marginTop: (i === 0 ? INTRO_TO_STEPS : BETWEEN_STEPS) * scale },
              ]}
            >
              <ProfileStepNumber n={step.n} scale={scale} />
              <View style={{ marginTop: NUMBER_TO_TITLE * scale }}>
                <ProfileStepTitle name={step.name} scale={scale} />
              </View>
              <Text
                style={[styles.copy, { marginTop: TITLE_TO_COPY * scale }]}
                allowFontScaling={false}
              >
                {step.copy}
              </Text>
            </View>
          ))}

          <View style={{ flex: BUTTON_TOP - CONTENT_BOTTOM, minHeight: 16 }} />
        </ScrollView>

        <View style={[styles.buttonWrap, { bottom: buttonBottom }]}>
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
        </View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // BG/M - Secondary, the same ground as steps 1–7, so the hop to step 1
    // doesn't flash a different white.
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  step: {
    alignItems: 'center',
  },
  copy: {
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
