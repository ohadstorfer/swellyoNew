// Visual frame around create-trip step content.
// Header + footer match Figma node 12201:6996 exactly (dark header, cyan
// bottom-border, gradient fade above floating Back/Next buttons).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

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

// Step-transition slide — incoming + outgoing share these so the center moves
// as one connected strip.
const SLIDE_MS = 300;
const SLIDE_EASING = Easing.inOut(Easing.cubic);
const SCREEN_W = Dimensions.get('window').width;

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
  /** Hide the dark header band entirely (e.g. the full-bleed preview step). */
  hideHeader?: boolean;
  /** Remove the scroll content's horizontal + top padding so children can run
   *  edge-to-edge (e.g. the preview step's full-bleed hero). */
  flushContent?: boolean;
  /** Optional handle to the inner scroll view, so step content can scroll a
   *  focused input into view (e.g. tapping the Trip name field). */
  scrollViewRef?:
    | React.MutableRefObject<ScrollView | null>
    | ((node: ScrollView | null) => void);
  /** Step content sets this to the currently-focused TextInput so the chrome
   *  can scroll it clear of the keyboard. */
  focusedInputRef?: React.MutableRefObject<TextInput | null>;
  /** When true, the keyboard-avoidance scroll is suppressed — e.g. while a
   *  bottom sheet is open, so its keyboard doesn't scroll the page behind it. */
  suppressKeyboardScroll?: boolean;
  /** The chrome assigns a function here that scrolls the currently-focused
   *  input clear of the keyboard. Inputs call it in onFocus so it also works
   *  when the keyboard is already open (switching between fields). */
  keyboardScrollRef?: React.MutableRefObject<(() => void) | null>;
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
    hideHeader = false,
    flushContent = false,
    scrollViewRef,
    focusedInputRef,
    suppressKeyboardScroll = false,
    keyboardScrollRef,
    children,
  } = props;

  const insets = useSafeAreaInsets();

  // -------- Step-slide direction --------
  // 1 = forward (Next), -1 = backward (Back). Set on the button press BEFORE the
  // step changes, so the exiting worklet reads the *current* direction at unmount
  // time (the built-in Slide animations bake direction in at creation, which goes
  // stale on Back — that was the glitch). The custom worklets below read it live.
  const dir = useSharedValue(1);
  const handlePrimary = useCallback(() => {
    dir.value = 1;
    onPrimary();
  }, [dir, onPrimary]);
  const handleSecondary = useCallback(() => {
    dir.value = -1;
    onSecondary();
  }, [dir, onSecondary]);
  const handleClose = useCallback(() => {
    dir.value = -1;
    (onClose ?? onSecondary)();
  }, [dir, onClose, onSecondary]);

  // Incoming enters from the side we're heading toward; outgoing leaves the
  // opposite way — a true mirror between Next and Back.
  const enterAnim = useCallback(
    (values: any) => {
      'worklet';
      const fromX = dir.value >= 0 ? SCREEN_W : -SCREEN_W;
      return {
        initialValues: { transform: [{ translateX: fromX }] },
        animations: {
          transform: [{ translateX: withTiming(0, { duration: SLIDE_MS, easing: SLIDE_EASING }) }],
        },
      };
    },
    [dir],
  );
  const exitAnim = useCallback(
    (values: any) => {
      'worklet';
      const toX = dir.value >= 0 ? -SCREEN_W : SCREEN_W;
      return {
        initialValues: { transform: [{ translateX: 0 }] },
        animations: {
          transform: [{ translateX: withTiming(toX, { duration: SLIDE_MS, easing: SLIDE_EASING }) }],
        },
      };
    },
    [dir],
  );

  // -------- Scroll-to-top on step change --------
  const scrollRef = useRef<ScrollView | null>(null);
  // Live scroll offset, tracked so the keyboard handler can scroll *relative*
  // to the current position.
  const scrollYRef = useRef(0);
  // Keeps the internal ref (used for scroll-to-top) and any caller-provided
  // ref pointing at the same scroll node.
  const setScrollRef = (node: ScrollView | null) => {
    scrollRef.current = node;
    if (typeof scrollViewRef === 'function') scrollViewRef(node);
    else if (scrollViewRef) scrollViewRef.current = node;
  };
  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === 'function') {
      node.scrollTo({ y: 0, animated: false });
    }
  }, [stepIndex]);

  // -------- Status bar style — white text on dark header, dark on light bg --------
  useEffect(() => {
    if (Platform.OS === 'ios') {
      StatusBar.setBarStyle(hideHeader ? 'dark-content' : 'light-content', true);
    }
    return () => {
      if (Platform.OS === 'ios') {
        StatusBar.setBarStyle('dark-content', true);
      }
    };
  }, [hideHeader]);

  const headerPaddingTop = Math.max(insets.top, 0) + HEADER_PADDING_TOP_BASE;
  const footerReservedHeight =
    FOOTER_BUTTON_HEIGHT + FOOTER_BOTTOM_OFFSET + Math.max(insets.bottom - 8, 0);

  // -------- Guaranteed keyboard avoidance (core-RN, works on iOS + Android) --
  // To be 100% certain a focused input is never hidden behind the keyboard, we
  // re-check on every keyboard show and scroll the focused input up by exactly
  // the amount it's obscured. Uses measureInWindow (safe on the new
  // architecture) — NOT measureLayout/findNodeHandle.
  // Extra bottom padding added while the keyboard is open, so the last fields
  // have somewhere to scroll *into*. Without this, scrollTo gets clamped and
  // the bottom-most input can never clear the keyboard.
  const [kbSpace, setKbSpace] = useState(0);
  // Live mirror of suppressKeyboardScroll so the keyboard listener (set up once)
  // always sees the current value.
  const suppressRef = useRef(suppressKeyboardScroll);
  suppressRef.current = suppressKeyboardScroll;
  // Last known keyboard top (screenY) + whether it's currently open. Tracked so
  // we can also scroll when focus moves between fields while the keyboard stays
  // up (no keyboardWillShow fires in that case).
  const kbTopRef = useRef(0);
  const kbVisibleRef = useRef(false);

  const scrollFocusedIntoView = useCallback(() => {
    // Skip while a sheet is open, or before we know where the keyboard is.
    if (suppressRef.current || !kbVisibleRef.current) return;
    const scroll = scrollRef.current as any;
    const focused =
      focusedInputRef?.current ?? (TextInput.State.currentlyFocusedInput?.() as any);
    if (!scroll || !focused || typeof focused.measureInWindow !== 'function') return;
    focused.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      // The footer no longer floats above the keyboard, so the input only
      // needs to clear the keyboard top plus a comfortable gap.
      const GAP = 24;
      const visibleBottom = kbTopRef.current - GAP;
      const inputBottom = y + h;
      if (inputBottom > visibleBottom) {
        const delta = inputBottom - visibleBottom;
        scroll.scrollTo({ y: Math.max(scrollYRef.current + delta, 0), animated: true });
      }
    });
  }, [focusedInputRef]);

  // Expose the scroller so inputs can call it from onFocus (covers the
  // keyboard-already-open case).
  useEffect(() => {
    if (keyboardScrollRef) keyboardScrollRef.current = scrollFocusedIntoView;
    return () => {
      if (keyboardScrollRef) keyboardScrollRef.current = null;
    };
  }, [keyboardScrollRef, scrollFocusedIntoView]);

  useEffect(() => {
    const onShow = (e: { endCoordinates: { screenY: number; height: number } }) => {
      kbVisibleRef.current = true;
      kbTopRef.current = e.endCoordinates.screenY;
      if (suppressRef.current) return;
      // 1) Make room below the content, 2) on the next frame (after the new
      // padding lands) scroll the focused input above the keyboard.
      setKbSpace(e.endCoordinates.height);
      requestAnimationFrame(() => requestAnimationFrame(() => scrollFocusedIntoView()));
    };
    const onHide = () => {
      kbVisibleRef.current = false;
      setKbSpace(0);
    };

    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      onShow,
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      onHide,
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollFocusedIntoView]);

  const secondaryDisabled = submitting;
  const primaryButtonDisabled = submitting || primaryDisabled;

  return (
    <View style={styles.root}>
      {/* ----- Header band (hidden on full-bleed steps like preview) ----- */}
      {hideHeader ? null : (
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back"
            activeOpacity={0.7}
            onPress={handleSecondary}
            disabled={secondaryDisabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.backArrowBtn}
          >
            <Ionicons name="chevron-back" size={28} color={tokens.white} />
          </TouchableOpacity>
          <Text style={styles.stepTitle} numberOfLines={1}>
            {stepTitle}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close"
            activeOpacity={0.7}
            onPress={handleClose}
            disabled={secondaryDisabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color={tokens.white} />
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* ----- Scrollable step content ----- */}
      <KeyboardAwareScrollView
        ref={setScrollRef}
        style={styles.scroll}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: flushContent ? 0 : 16,
          paddingTop: flushContent ? 0 : hideHeader ? Math.max(insets.top, 0) + 8 : 20,
          paddingBottom: footerReservedHeight + 32 + kbSpace,
        }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={e => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
      >
        <Animated.View key={stepIndex} entering={enterAnim} exiting={exitAnim}>
          {children}
        </Animated.View>
      </KeyboardAwareScrollView>

      {/* ----- Footer (gradient fade overlay + buttons) -----
          Intentionally does NOT track the keyboard: when the keyboard is open
          it stays at the bottom and the keyboard covers it. */}
      <Animated.View
        style={styles.footerWrap}
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
            accessibilityState={{ disabled: primaryButtonDisabled }}
            activeOpacity={0.85}
            onPress={handlePrimary}
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
    gap: 8,
  },
  stepTitle: {
    flex: 1,
    fontSize: HEADER_TITLE_FONT,
    lineHeight: HEADER_TITLE_LINE,
    fontWeight: '700',
    color: tokens.white,
    fontFamily: fonts.inter,
  },
  // Back arrow sits to the LEFT of the title (Figma). Negative left margin
  // pulls the optical edge of the chevron flush with the header's 16pt inset.
  backArrowBtn: {
    width: 32,
    height: 32,
    marginLeft: -4,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Primary — narrower than full width, softer (not pill) corners. Matches the
  // Figma CTA: ~300pt wide, 12-14px radius.
  primaryButton: {
    flex: 1,
    minWidth: 150,
    marginHorizontal: 24,
    height: FOOTER_BUTTON_HEIGHT,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
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
