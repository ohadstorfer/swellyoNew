// Generic bottom-sheet shell for the Create-Trip wizard input steps.
// Mirrors HomeBreakSearchSheet UX (drag handle, backdrop dismiss, spring in).

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text } from '../Text';

const SCREEN_HEIGHT = Dimensions.get('window').height;

const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  surface: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.5)',
  handle: '#D0D0D0',
  divider: '#E0E0E0',
  inkBody: '#222B30',
};

export type WizardSheetHeightMode = 'auto' | 'half' | 'full';

export interface WizardBottomSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional footer actions rendered at the bottom of the sheet, above the safe area. */
  footer?: React.ReactNode;
  /** Height mode: 'auto' (content-sized, capped at 90%), 'full' (90% viewport), 'half' (50%). Default 'auto'. */
  heightMode?: WizardSheetHeightMode;
  /** Optional subtitle under the title (smaller, muted). */
  subtitle?: string;
  /** When true, the hairline divider below the header is hidden. */
  hideHeaderDivider?: boolean;
  /** When true, the title renders bigger (24 instead of 18). */
  largeTitle?: boolean;
}

const resolveSheetHeight = (mode: WizardSheetHeightMode): number | undefined => {
  switch (mode) {
    case 'full':
      return Math.round(SCREEN_HEIGHT * 0.9);
    case 'half':
      return Math.round(SCREEN_HEIGHT * 0.5);
    case 'auto':
    default:
      // Let content drive the height; cap via maxHeight in styles.
      return undefined;
  }
};

export const WizardBottomSheet: React.FC<WizardBottomSheetProps> = ({
  visible,
  title,
  onClose,
  children,
  footer,
  heightMode = 'auto',
  subtitle,
  hideHeaderDivider = false,
  largeTitle = false,
}) => {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);

  // 0 = fully off-screen, 1 = fully on-screen. Drives both spring-in and drag.
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  // Animated translation in px (used by PanResponder so drag tracks finger 1:1).
  // We blend it with the sheetAnim slide-in via translateY = (1 - sheetAnim) * H + dragOffset.
  const dragOffset = useRef(new Animated.Value(0)).current;

  // Negative translateY contribution when keyboard is up — anchors the sheet
  // bottom to the top of the keyboard so inputs stay visible.
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  // Mirror for layout calculation (sheet maxHeight shrinks when keyboard is up).
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Keep latest onClose for stable PanResponder ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Listen to keyboard show/hide. We do two things together:
  //   1. Track keyboardHeight in JS state → drives sheet maxHeight (sheet
  //      shrinks so it never extends behind the keyboard).
  //   2. Animate keyboardOffset → shifts sheet up to sit above keyboard.
  // Because we cap maxHeight first, the shift can never push the top off-screen.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, e => {
      const h = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(h);
      Animated.timing(keyboardOffset, {
        toValue: -h,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 200,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvt, e => {
      setKeyboardHeight(0);
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 200,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  // Mount + animate in / out based on visible prop.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragOffset.setValue(0);
      Animated.parallel([
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(sheetAnim, {
          toValue: 1,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(sheetAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag-down to dismiss. Same pattern as HomeBreakSearchSheet, DateOfBirthSheet,
  // HomeBreakViewSheet (proven in production): panHandlers go on the handle +
  // header View only — body content stays scrollable underneath.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          dragOffset.setValue(gs.dy);
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 100 || gs.vy > 0.5) {
          onCloseRef.current();
        } else {
          Animated.spring(dragOffset, {
            toValue: 0,
            tension: 65,
            friction: 11,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragOffset, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  // Reserve 40pt at the top so the sheet never crowds the status bar.
  const TOP_MARGIN = 40;
  const baseFixed = resolveSheetHeight(heightMode);
  const availableHeight = Math.max(0, SCREEN_HEIGHT - keyboardHeight - TOP_MARGIN);
  // Cap fixed heights so the sheet never extends behind the keyboard.
  const cappedFixed = baseFixed != null ? Math.min(baseFixed, availableHeight) : undefined;
  const cappedMax = Math.min(Math.round(SCREEN_HEIGHT * 0.9), availableHeight);
  // Slide-in translation: when sheetAnim=0 the sheet sits below screen.
  const slideTranslate = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_HEIGHT, 0],
  });
  const translateY = Animated.add(Animated.add(slideTranslate, dragOffset), keyboardOffset);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      {/* RNGH gestures (used by sliders inside sheet content) require this
          root inside the Modal — gestures don't bubble through RN's Modal. */}
      <GestureHandlerRootView style={styles.root}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            cappedFixed != null ? { height: cappedFixed } : { maxHeight: cappedMax },
            { transform: [{ translateY }] },
          ]}
        >
          {/* Drag area — swipe down on the handle/header to dismiss.
              Body content underneath stays scrollable. Matches the proven
              pattern used by HomeBreakSearchSheet et al. */}
          <View {...pan.panHandlers}>
            <View style={styles.handle} />
            <View
              style={[
                styles.header,
                hideHeaderDivider && styles.headerNoDivider,
                subtitle ? styles.headerWithSubtitle : null,
              ]}
            >
              {/* Left spacer balances the close button width so the title
                  stays optically centered. */}
              <View style={styles.headerSide} />
              <View style={styles.headerTitleBlock}>
                <Text
                  style={[styles.title, largeTitle && styles.titleLarge]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={C.inkBody} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Content — scrollable if it overflows. Extra bottom padding when
              a footer is present so the last interactive element doesn't
              crowd against the footer's top border. */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={[
              styles.contentInner,
              footer ? styles.contentInnerWithFooter : null,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              style={[
                styles.footer,
                { paddingBottom: Math.max(insets.bottom, 12) },
              ]}
            >
              {footer}
            </View>
          ) : (
            <View style={{ height: Math.max(insets.bottom, 12) }} />
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.overlay,
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: C.handle,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  headerNoDivider: {
    borderBottomWidth: 0,
  },
  headerWithSubtitle: {
    paddingTop: 22,
    paddingBottom: 22,
  },
  headerSide: { width: 32 },
  headerTitleBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: C.inkBody,
    textAlign: 'center',
  },
  titleLarge: {
    fontSize: 24,
    lineHeight: 28,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: '#7B7B7B',
    textAlign: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 0,
  },
  contentInner: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
  contentInnerWithFooter: {
    // Sheets with a footer (e.g. "Set" button) get extra breathing room
    // beneath the last item so it doesn't visually touch the footer divider.
    paddingBottom: 24,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.divider,
    backgroundColor: C.surface,
    // Subtle top shadow so the footer feels elevated above the scroll edge.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 4,
  },
});

export default WizardBottomSheet;
