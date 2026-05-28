// Visual frame around create-trip step content.
// Header + footer match Figma node 12201:6996 exactly (dark header, cyan
// bottom-border, gradient fade above floating Back/Next buttons).

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';

// -----------------------------------------------------------------------------
// Tokens from Figma node 12201:6996.
//   Surface/M 07 → #212121 (header background)
//   Surface/M 06 → #333333 (Next button background, Back text color)
//   Cyan         → #05BCD3 (4px header bottom border)
// -----------------------------------------------------------------------------
const tokens = {
  inkDark: '#212121',        // header bg
  inkDark2: '#333333',       // primary button bg + back text
  cyan: '#05BCD3',           // header bottom border
  white: '#FFFFFF',
  fadeOverlay: '#FAFAFA',    // gradient end color above buttons
};

const fonts = {
  montserrat: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
  inter: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
};

// Figma exact values, tuned per Eyal.
const HEADER_BORDER_BOTTOM = 4;
const HEADER_PADDING_BOTTOM = 18;
const HEADER_PADDING_TOP_BASE = 14;  // additive to safe-area top
const HEADER_PADDING_H = 16;
const HEADER_TITLE_ROW_GAP = 15;
const HEADER_TITLE_FONT = 22;
const HEADER_TITLE_LINE = 24;

// Header bottom gradient — exact colors lifted from the local-info-collector
// home screen so it matches across Eyal's two apps.
// Stops: cyan at 0 → sand at 0.72 → sand at 1 (sand holds for the last 28%).
const HEADER_GRADIENT_COLORS: [string, string, string] = ['#06BDD4', '#DACCBB', '#DACCBB'];
const HEADER_GRADIENT_LOCATIONS: [number, number, number] = [0, 0.72, 1];

const FOOTER_GRADIENT_HEIGHT = 230;
const FOOTER_CONTAINER_WIDTH = 350;
const FOOTER_BUTTON_HEIGHT = 64;
const FOOTER_BUTTON_TEXT = 18;
const FOOTER_BUTTON_LINE = 24;
const FOOTER_BACK_WIDTH = 85;
const FOOTER_GAP = 10;
const FOOTER_PADDING_H = 22;
const FOOTER_BOTTOM_OFFSET = 16;

export interface CreateTripWizardChromeProps {
  /** 0-based current step. Drives slide direction only (progress bar is gone per Figma). */
  stepIndex: number;
  /** Total number of steps. Kept for backwards-compat; not rendered. */
  stepCount: number;
  stepTitle: string;
  /** No-op: Figma design has no subtitle. Kept for callers that still pass one. */
  stepSubtitle?: string;
  /** Primary CTA label, e.g. "Next · basic deets". */
  primaryLabel: string;
  /** Back button label. Per Figma always "Back". Kept as a prop for flexibility. */
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  /** Header close-X handler. Falls back to onSecondary if not provided. */
  onClose?: () => void;
  /** When true, both buttons are disabled and primary shows a spinner. */
  submitting?: boolean;
  primaryDisabled?: boolean;
  /** No-op: Figma design has no progress indicator. Kept for backwards-compat. */
  hideProgress?: boolean;
  children: React.ReactNode;
}

export function CreateTripWizardChrome(props: CreateTripWizardChromeProps): React.ReactElement {
  const {
    stepIndex,
    stepTitle,
    primaryLabel,
    secondaryLabel,
    onPrimary,
    onSecondary,
    onClose,
    submitting = false,
    primaryDisabled = false,
    children,
  } = props;

  const insets = useSafeAreaInsets();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // -------- Slide direction tracking --------
  const prevStepIndexRef = useRef(stepIndex);
  const directionRef = useRef<'forward' | 'backward'>('forward');
  if (prevStepIndexRef.current !== stepIndex) {
    directionRef.current = stepIndex > prevStepIndexRef.current ? 'forward' : 'backward';
    prevStepIndexRef.current = stepIndex;
  }
  const goingForward = directionRef.current === 'forward';

  // -------- Footer keyboard-tracking --------
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardHeight.value }],
  }));

  // -------- Scroll-to-top on step change --------
  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === 'function') {
      node.scrollTo({ y: 0, animated: false });
    }
  }, [stepIndex]);

  // -------- Status bar style — white text on dark header --------
  useEffect(() => {
    if (Platform.OS === 'ios') {
      StatusBar.setBarStyle('light-content', true);
    }
    return () => {
      if (Platform.OS === 'ios') {
        StatusBar.setBarStyle('dark-content', true);
      }
    };
  }, []);

  const headerPaddingTop = Math.max(insets.top, 0) + HEADER_PADDING_TOP_BASE;
  const footerReservedHeight =
    FOOTER_BUTTON_HEIGHT + FOOTER_BOTTOM_OFFSET + Math.max(insets.bottom - 8, 0);

  const secondaryDisabled = submitting;
  const primaryButtonDisabled = submitting || primaryDisabled;
  const handleClose = onClose ?? onSecondary;

  return (
    <View style={styles.root}>
      {/* ----- Header band ----- */}
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.headerRow}>
          <Text style={styles.stepTitle} numberOfLines={1}>
            {stepTitle}
          </Text>
          <View style={styles.headerSpacer} />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close"
            activeOpacity={0.7}
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color={tokens.white} />
          </TouchableOpacity>
        </View>
        {/* Blue → sand gradient line at the bottom of the header. */}
        <LinearGradient
          colors={HEADER_GRADIENT_COLORS}
          locations={HEADER_GRADIENT_LOCATIONS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradientLine}
          pointerEvents="none"
        />
      </View>

      {/* ----- Scrollable step content ----- */}
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: footerReservedHeight + 32,
        }}
        bottomOffset={footerReservedHeight + 16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          key={stepIndex}
          entering={
            goingForward
              ? SlideInRight.duration(260).easing(Easing.out(Easing.cubic))
              : SlideInLeft.duration(260).easing(Easing.out(Easing.cubic))
          }
          exiting={goingForward ? SlideOutLeft.duration(220) : SlideOutRight.duration(220)}
        >
          {children}
        </Animated.View>
      </KeyboardAwareScrollView>

      {/* ----- Footer (gradient fade overlay + floating buttons) ----- */}
      <Animated.View
        style={[styles.footerWrap, footerStyle]}
        pointerEvents="box-none"
      >
        {/* Gradient fade behind buttons. Slightly stronger than Figma's literal
            stops — starts earlier and finishes earlier so the shadow reads. */}
        <LinearGradient
          colors={['rgba(250,250,250,0)', tokens.fadeOverlay]}
          locations={[0.15, 0.7]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.footerGradient}
          pointerEvents="none"
        />

        {/* Centered 350pt button row, 40pt above the safe-area bottom. */}
        <View
          style={[
            styles.footerButtonRow,
            { bottom: FOOTER_BOTTOM_OFFSET + Math.max(insets.bottom - 8, 0) },
          ]}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: secondaryDisabled }}
            activeOpacity={0.7}
            onPress={onSecondary}
            disabled={secondaryDisabled}
            style={[styles.backButton, secondaryDisabled && styles.buttonDisabled]}
          >
            <Text style={styles.backLabel}>{secondaryLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: primaryButtonDisabled }}
            activeOpacity={0.85}
            onPress={onPrimary}
            disabled={primaryButtonDisabled}
            style={[styles.primaryButton, primaryButtonDisabled && styles.buttonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={tokens.white} />
            ) : (
              <Text style={styles.primaryLabel} numberOfLines={1}>
                {primaryLabel}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.fadeOverlay,
  },

  // Header — Figma: bg #212121, 4pt blue→sand gradient line at the bottom.
  // The gradient is rendered as an absolute child (no `borderBottom` since RN
  // doesn't support gradient borders).
  header: {
    paddingHorizontal: HEADER_PADDING_H,
    paddingBottom: HEADER_PADDING_BOTTOM + HEADER_BORDER_BOTTOM,
    backgroundColor: tokens.inkDark,
    position: 'relative',
  },
  headerGradientLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HEADER_BORDER_BOTTOM,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_TITLE_ROW_GAP,
  },
  stepTitle: {
    fontSize: HEADER_TITLE_FONT,
    lineHeight: HEADER_TITLE_LINE,
    fontWeight: '700',
    color: tokens.white,
    fontFamily: fonts.inter,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSpacer: {
    flex: 1,
  },
  closeBtn: {
    width: 44,
    height: 44,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    flex: 1,
  },

  // Footer wrap is absolute over the scroll so content can fade behind it.
  footerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: FOOTER_GRADIENT_HEIGHT,
  },
  footerGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  footerButtonRow: {
    position: 'absolute',
    left: FOOTER_PADDING_H,
    right: FOOTER_PADDING_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: FOOTER_GAP,
  },

  // Back button — Figma shows 85x64 with "Back" label. We use `minWidth` so
  // longer labels ("Cancel") expand without clipping; padding is also tighter
  // so the text never butts up against the rounded edges.
  backButton: {
    minWidth: FOOTER_BACK_WIDTH,
    height: FOOTER_BUTTON_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontSize: FOOTER_BUTTON_TEXT,
    lineHeight: FOOTER_BUTTON_LINE,
    fontWeight: '600',
    color: tokens.inkDark2,
    fontFamily: fonts.montserrat,
    textAlign: 'center',
    includeFontPadding: false,
  },

  // Primary — fills remaining width, bg #333, white text.
  primaryButton: {
    flex: 1,
    minWidth: 150,
    height: FOOTER_BUTTON_HEIGHT,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
    backgroundColor: tokens.inkDark2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: FOOTER_BUTTON_TEXT,
    lineHeight: FOOTER_BUTTON_LINE,
    fontWeight: '600',
    color: tokens.white,
    fontFamily: fonts.montserrat,
    textAlign: 'center',
  },

  buttonDisabled: {
    opacity: 0.5,
  },
});

export default CreateTripWizardChrome;
