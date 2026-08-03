/**
 * Persistent onboarding chrome: the header (back + step label + progress bar) and
 * the footer (Next button). Rendered once by OnboardingScaffold and never unmounted
 * across steps 1–7, so the header and button stay fixed while only the middle content
 * slides. Styles are ported from the per-screen versions to preserve pixel parity.
 *
 * Phase 1: static (no cross-fade / no progress animation yet) — animations are added
 * in a later phase. The label + progress are driven by onboardingStepConfig.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Text } from '../Text';
import { colors, spacing } from '../../styles/theme';
import { useIsDesktopWeb } from '../../utils/responsive';
import { ff, fs } from '../../theme/fonts';
import {
  ONBOARDING_STEP_DISPLAY,
  type OnboardingStepKey,
} from './onboardingStepConfig';
import { useOnboardingStepChrome } from '../../context/OnboardingStepContext';

const HEADER_ANIM_DURATION = 320;
const HEADER_EASING = Easing.out(Easing.cubic);

/** Side inset of the Next button — matches the welcome splash's CTA (step 0). */
const BUTTON_INSET = 31;

// Figma "CTA" 14113:19993 — the bottom 230 of the screen carries a #FAFAFA fade
// so scrolling content (the interests grid on the lifestyle step) dissolves
// behind the button instead of being cut off. Transparent until 33.478%, solid
// from 86.522%. On steps whose background is already flat #FAFAFA it's invisible.
const FADE_HEIGHT = 230;

// ---------------------------------------------------------------------------
// Header (top): back button + centered step label (cross-fade) + progress bar
// ---------------------------------------------------------------------------
interface HeaderProps {
  stepKey: OnboardingStepKey;
}

export const OnboardingHeader: React.FC<HeaderProps> = ({ stepKey }) => {
  const isDesktop = useIsDesktopWeb();
  const { view, callBack } = useOnboardingStepChrome();
  const progressBarWidth = isDesktop ? 300 : 237;

  const effectiveKey = view.labelKeyOverride ?? stepKey;
  const display = ONBOARDING_STEP_DISPLAY[effectiveKey];
  const targetFill = Math.max(0, Math.min(1, display.progress)) * progressBarWidth;
  // Welcome has no label or progress bar — they appear on the first real step.
  const isWelcome = effectiveKey === 'welcome';

  // Progress bar: animate the fill width (absolute px, not %, so it interpolates).
  const fill = useSharedValue(targetFill);
  // Label cross-fade: keep the previous label visible while it fades out.
  const [labels, setLabels] = useState({ prev: display.label, current: display.label });
  const t = useSharedValue(1); // 0 = prev fully shown, 1 = current fully shown
  const prevLabelRef = useRef(display.label);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Skip animating on first mount; just settle at the initial values.
    if (!initializedRef.current) {
      initializedRef.current = true;
      fill.value = targetFill;
      return;
    }
    fill.value = withTiming(targetFill, {
      duration: HEADER_ANIM_DURATION,
      easing: HEADER_EASING,
    });

    if (display.label !== prevLabelRef.current) {
      setLabels({ prev: prevLabelRef.current, current: display.label });
      t.value = 0;
      t.value = withTiming(1, { duration: HEADER_ANIM_DURATION, easing: HEADER_EASING });
      prevLabelRef.current = display.label;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.label, targetFill]);

  const fillStyle = useAnimatedStyle(() => ({ width: fill.value }));
  const prevLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - t.value }));
  const currentLabelStyle = useAnimatedStyle(() => ({ opacity: t.value }));

  return (
    <>
      <View style={[styles.header, isDesktop && styles.headerDesktop]}>
        <TouchableOpacity testID="onboarding-back-button" onPress={callBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#222B30" />
        </TouchableOpacity>

        <View style={styles.labelWrap}>
          {labels.prev !== labels.current ? (
            <Reanimated.Text style={[styles.stepText, styles.labelAbsolute, prevLabelStyle]}>
              {labels.prev}
            </Reanimated.Text>
          ) : null}
          <Reanimated.Text style={[styles.stepText, styles.labelAbsolute, currentLabelStyle]}>
            {labels.current}
          </Reanimated.Text>
        </View>

        <View style={styles.rightPlaceholder} />
      </View>

      {!isWelcome && (
        <View style={[styles.progressContainer, isDesktop && styles.progressContainerDesktop]}>
          <View style={[styles.progressBar, { width: progressBarWidth }]}>
            <Reanimated.View style={[styles.progressFill, fillStyle]} />
          </View>
        </View>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Footer (bottom): the persistent Next button
// ---------------------------------------------------------------------------
interface FooterProps {
  isLoading: boolean;
}

export const OnboardingFooter: React.FC<FooterProps> = ({ isLoading }) => {
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktopWeb();
  const { view, callNext } = useOnboardingStepChrome();
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;

  const disabled = isLoading || !view.canProceed;
  const label = isLoading ? view.loadingLabel ?? 'Loading...' : view.nextLabel;

  return (
    <View
      style={[
        styles.buttonContainer,
        isDesktop && styles.buttonContainerDesktop,
        view.overlayFooter && styles.buttonContainerOverlay,
        buttonContainerMaxWidth ? { maxWidth: buttonContainerMaxWidth } : null,
        { paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      {/* Behind the button, and taller than this container — it reaches up over
          the content host, which can't clip it because they're siblings. The
          negative insets cancel this container's padding so the fade spans the
          full screen width rather than just the button's. */}
      {view.overlayFooter && (
        <View
          style={[styles.footerFade, { bottom: -Math.max(insets.bottom, 24) }]}
          pointerEvents="none"
        >
          {/* Figma's backdrop-blur on the CTA. A plain BlurView has a hard top
              edge that cut visibly straight across the cards, so it's masked by
              a gradient: the blur ramps in from nothing over the top 45% and
              never presents an edge. Same MaskedView + BlurView pairing as
              BubbleSpotlightDim. */}
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={['transparent', '#000000']}
                locations={[0, 0.45]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView
              intensity={16}
              tint="light"
              style={StyleSheet.absoluteFill}
              experimentalBlurMethod="dimezisBlurView"
            />
          </MaskedView>
          <LinearGradient
            colors={['rgba(250,250,250,0)', 'rgba(250,250,250,0)', '#FAFAFA', '#FAFAFA']}
            locations={[0, 0.33478, 0.86522, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}

      <TouchableOpacity
        testID="onboarding-next-button"
        onPress={callNext}
        activeOpacity={0.8}
        disabled={disabled}
        style={[styles.buttonTouchable, disabled && styles.buttonDisabled]}
      >
        <View style={styles.primaryButton}>
          <Text style={styles.buttonText}>{label}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  headerDesktop: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  labelWrap: {
    flex: 1,
    height: 15,
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  labelAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  rightPlaceholder: {
    width: 60,
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  progressContainerDesktop: {
    paddingBottom: spacing.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.progressBackground,
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.progressFill,
    borderRadius: 8,
  },
  buttonContainer: {
    // 31 each side, so the button is the same width as the one on the welcome
    // splash (step 0) — Figma "Main Button" 14082:24223, 330 wide on a 393 frame.
    // It used to be a fixed responsiveWidth(90%, max 320), which made the button
    // visibly resize on the step 0 → step 1 hop.
    //
    // OnboardingScaffold's `body` already pads 16 on native, which would stack
    // with the 31 and render the button 32 too narrow (299 instead of 331). The
    // negative margin cancels that padding so the inset is measured against the
    // full screen, like step 0. `alignSelf: stretch` — not `width: '100%'` — is
    // what lets the negative margins widen the box past the parent's edge.
    alignSelf: 'stretch',
    marginHorizontal: Platform.OS !== 'web' ? -spacing.md : 0,
    paddingHorizontal: BUTTON_INSET,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    flexShrink: 0,
  },
  buttonContainerDesktop: {
    // Desktop centres a 400-wide box (buttonContainerMaxWidth), so it needs the
    // explicit width back, and this padding is what keeps the button at 320.
    width: '100%',
    alignSelf: 'center',
    marginHorizontal: 0,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  buttonContainerOverlay: {
    // Out of the column so the content host grows into this space and its list
    // scrolls UNDER the button. left/right 0 + the container's own negative
    // margin makes the absolute box span the full screen width.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  footerFade: {
    position: 'absolute',
    overflow: 'hidden',
    // Absolute insets resolve against the padding box, so cancel the container's
    // horizontal padding to reach the screen edges. `bottom` is set inline from
    // the safe-area inset so the fade covers the screen's bottom 230 exactly.
    left: -BUTTON_INSET,
    right: -BUTTON_INSET,
    height: FADE_HEIGHT,
  },
  buttonTouchable: {
    alignSelf: 'stretch',
  },
  primaryButton: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    // Surface/M 07
    backgroundColor: '#212121',
  },
  buttonText: {
    // Headings/SemiBold. Kept at 16 rather than the welcome button's 14 — the
    // label here is a full phrase ("Continue", "Let's go"), not just "Next".
    // Was a bare fontFamily 'System' on native, so it never rendered Montserrat.
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(16),
    lineHeight: 24,
    color: colors.white || '#FFF',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
