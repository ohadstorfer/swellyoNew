// BottomSheetShell — the global wrapper that gives EVERY bottom sheet the same
// background effect: the dark scrim FADES in/out (opacity) while the sheet itself
// SLIDES up separately, plus swipe-down-to-dismiss. It's headless on purpose —
// it owns only the Modal + animated backdrop + slide + swipe, and renders whatever
// `children` you give it, so each sheet keeps its OWN look (surface, header, body).
//
// Migrating a sheet: replace its hand-rolled
//   <Modal animationType="slide"><Pressable backdrop><Pressable sheet>…</Pressable></Pressable></Modal>
// with
//   <BottomSheetShell visible={visible} onClose={onClose}>
//     <View style={styles.yourSheetSurface}>…</View>
//   </BottomSheetShell>
//
// Notes:
// - Drag-to-dismiss is attached to the whole sheet by default. If the sheet has a
//   scrolling body, pass `swipeToDismiss={false}` (or gate the pan to a handle) so
//   the downward drag doesn't fight the ScrollView.
// - Set `avoidKeyboard` for sheets with a TextInput so the sheet rises with the keyboard.

import React from 'react';
import {
  Modal,
  Pressable,
  Animated,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSheetTransition } from '../hooks/useSheetTransition';

/** Gesture props to spread onto a drag handle (returned via the render-prop form). */
type SheetApi = { panHandlers: ReturnType<typeof useSheetTransition>['panHandlers'] };

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Sheet content. Pass a node and the whole sheet becomes the swipe target.
   * For sheets whose body scrolls (ScrollView / FlatList / picker), pass a
   * function instead and spread `panHandlers` onto your own grabber/header so
   * the downward drag doesn't fight the scroll. Example:
   *   {({ panHandlers }) => (<View><View {...panHandlers}><Grabber/></View>…</View>)}
   */
  children: React.ReactNode | ((api: SheetApi) => React.ReactNode);
  /** Scrim color (default matches the trip sheets). */
  backdropColor?: string;
  /** Wrap in KeyboardAvoidingView for sheets that contain a text input. */
  avoidKeyboard?: boolean;
  /** Attach the swipe-down-to-dismiss gesture to the whole sheet (default true).
   *  Ignored when `children` is a function — then you place the handlers yourself. */
  swipeToDismiss?: boolean;
  /**
   * Fires once the Modal is FULLY gone — after iOS has finished tearing down the
   * modal's UIViewController, not merely when the slide-out animation ends.
   * Anything that presents native UI (an OS picker, a permission alert) must wait
   * for this: UIKit refuses to present while another controller is dismissing, and
   * PHPicker (the photo library) hangs the main thread instead of failing loudly.
   */
  onDismissed?: () => void;
}

export function BottomSheetShell({
  visible,
  onClose,
  children,
  backdropColor = 'rgba(0,0,0,0.45)',
  avoidKeyboard = false,
  swipeToDismiss = true,
  onDismissed,
}: Props) {
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } =
    useSheetTransition(visible, onClose);
  const insets = useSafeAreaInsets();

  // Android edge-to-edge: the RN Modal draws in its OWN window and anchors content to
  // the SAFE AREA (window height excludes the nav bar), so a bottom-anchored sheet
  // floats `insets.bottom` above the physical bottom and the screen behind shows
  // through. The "correct" native fix (`navigationBarTranslucent` on the Modal) does
  // NOT work on Expo SDK 54 — verified broken in BOTH Expo Go AND a dev build, and it
  // matches the open Expo bug expo/expo#39749 (RN Modal forces the nav-bar inset). So we
  // nudge the sheet down into the nav-bar region on ALL Android with a transform
  // (transform, not margin, so measured height — and thus the slide-out animation — is
  // unaffected). Individual sheets pad `insets.bottom` to keep content clear of the nav
  // bar. When #39749 is fixed, drop this nudge and use navigationBarTranslucent instead.
  const androidNavBarNudge =
    Platform.OS === 'android' && insets.bottom > 0
      ? { transform: [{ translateY: insets.bottom }] }
      : undefined;

  // `onDismiss` is iOS-only. Everywhere else the Modal has no teardown callback, so
  // fall back to the unmount of our own `mounted` flag — safe there because those
  // platforms present their pickers in-process.
  const onDismissedRef = React.useRef(onDismissed);
  onDismissedRef.current = onDismissed;
  const wasMounted = React.useRef(mounted);
  React.useEffect(() => {
    if (Platform.OS === 'ios') return;
    if (wasMounted.current && !mounted) onDismissedRef.current?.();
    wasMounted.current = mounted;
  }, [mounted]);

  const isRenderProp = typeof children === 'function';
  const content = isRenderProp
    ? (children as (api: SheetApi) => React.ReactNode)({ panHandlers })
    : children;

  const body = (
    // Plain Pressable for the tap-to-close target (Animated-wrapped Pressables
    // don't reliably capture touches — taps would leak to the screen behind).
    <Pressable style={styles.container} onPress={onClose}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor, opacity: backdropOpacity }]}
      />
      <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
        {/* Whole-sheet swipe only when NOT using the render-prop (caller places it). */}
        <Pressable
          onPress={e => e.stopPropagation()}
          style={androidNavBarNudge}
          {...(swipeToDismiss && !isRenderProp ? panHandlers : {})}
        >
          {content}
        </Pressable>
      </Animated.View>
    </Pressable>
  );

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={Platform.OS === 'ios' ? onDismissed : undefined}
      // statusBarTranslucent (Android, no-op on iOS) lets the modal draw behind the
      // status bar — this one DOES work. navigationBarTranslucent is intentionally NOT
      // set: it's broken on SDK 54 (expo/expo#39749), so the bottom is handled by
      // `androidNavBarNudge` above instead.
      statusBarTranslucent
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </Modal>
  );
}

export default BottomSheetShell;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
});
