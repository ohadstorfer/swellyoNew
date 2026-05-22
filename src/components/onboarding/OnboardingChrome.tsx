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
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Text } from '../Text';
import { colors, spacing } from '../../styles/theme';
import { useIsDesktopWeb, responsiveWidth } from '../../utils/responsive';
import {
  ONBOARDING_STEP_DISPLAY,
  type OnboardingStepKey,
} from './onboardingStepConfig';
import { useOnboardingStepChrome } from '../../context/OnboardingStepContext';

const HEADER_ANIM_DURATION = 320;
const HEADER_EASING = Easing.out(Easing.cubic);

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
        <TouchableOpacity onPress={callBack} style={styles.backButton}>
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

      <View style={[styles.progressContainer, isDesktop && styles.progressContainerDesktop]}>
        <View style={[styles.progressBar, { width: progressBarWidth }]}>
          <Reanimated.View style={[styles.progressFill, fillStyle]} />
        </View>
      </View>
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
  const buttonWidth = responsiveWidth(90, 280, 320, 0);
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;

  const disabled = isLoading || !view.canProceed;
  const label = isLoading ? view.loadingLabel ?? 'Loading...' : view.nextLabel;

  return (
    <View
      style={[
        styles.buttonContainer,
        isDesktop && styles.buttonContainerDesktop,
        buttonContainerMaxWidth ? { maxWidth: buttonContainerMaxWidth } : null,
        { paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      <TouchableOpacity
        onPress={callNext}
        activeOpacity={0.8}
        disabled={disabled}
        style={disabled ? styles.buttonDisabled : undefined}
      >
        <View style={[styles.primaryButton, { width: buttonWidth }]}>
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
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    width: '100%',
    flexShrink: 0,
  },
  buttonContainerDesktop: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    alignSelf: 'center',
  },
  primaryButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: '#212121',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.white || '#FFF',
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
