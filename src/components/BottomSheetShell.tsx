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
// - Set `inline` when the sheet is opened from a screen that is ITSELF a presented
//   Modal. See the prop's note — without it the sheet silently never appears on iOS.

import React from 'react';
import {
  Modal,
  View,
  Pressable,
  Animated,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Dimensions,
  Platform,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSheetTransition } from '../hooks/useSheetTransition';

/**
 * How far the keyboard covers the screen, on iOS, for `avoidKeyboard` sheets.
 *
 * WHY NOT KeyboardAvoidingView (which is what this replaced on iOS): KAV with
 * `behavior="padding"` pads ITSELF, and it was wrapping the shell's
 * `styles.container` — the full-screen, `justifyContent: 'flex-end'` box that
 * every sheet is pinned to. Any padding there makes the container shorter than
 * the screen, and flex-end then faithfully pins the sheet to a bottom edge that
 * is no longer the screen's. That is the floating sheet: a gap underneath, the
 * trip screen showing through it, on every sheet that passed `avoidKeyboard`
 * and no others.
 *
 * The height is DERIVED FROM THE FRAME on every event rather than accumulated,
 * and forced to 0 on hide, so there is no state to go stale — a missed final
 * event cannot leave the sheet parked above the bottom.
 *
 * iOS only, deliberately. Android keeps its existing KeyboardAvoidingView: it
 * uses `behavior="height"` there, the reported bug is iOS-only, and Android's
 * bottom edge is already delicate (see `androidNavBarNudge` and expo/expo#39749).
 * RN's keyboard metrics are the wrong ruler on Android edge-to-edge anyway —
 * that is what `react-native-keyboard-controller` exists for in this project —
 * but rnkc is a no-op in Expo Go, which is where these sheets get tested.
 */
function useIosKeyboardInset(enabled: boolean): number {
  const [height, setHeight] = React.useState(0);

  React.useEffect(() => {
    if (!enabled || Platform.OS !== 'ios') {
      setHeight(0);
      return;
    }
    const apply = (e: { endCoordinates: { screenY: number } }) => {
      // Screen height minus where the keyboard's top edge sits. Off-screen
      // keyboard → screenY === screen height → 0. No accumulation, no drift.
      const screenH = Dimensions.get('window').height;
      setHeight(Math.max(0, screenH - e.endCoordinates.screenY));
    };
    const subs = [
      Keyboard.addListener('keyboardWillChangeFrame', apply),
      // Belt and braces: `willHide` sometimes arrives without a final frame
      // change, and a stale inset here is exactly the bug being fixed.
      Keyboard.addListener('keyboardWillHide', () => setHeight(0)),
      Keyboard.addListener('keyboardDidHide', () => setHeight(0)),
    ];
    return () => subs.forEach(s => s.remove());
  }, [enabled]);

  return height;
}

/**
 * Tallest height the Modal's own native window has ever reported, in dp. App-session scoped
 * because it is a property of the OS and the device, not of any one sheet: measuring it once
 * keeps every later sheet from re-rendering on layout. See `uncoveredBottom` below.
 */
let cachedWindowHeight = 0;


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
  /**
   * Render as a LAYER over the caller's own screen instead of presenting a Modal.
   *
   * REQUIRED whenever the sheet is opened from a screen that is ITSELF a
   * presented Modal. RN presents a Modal from `[self reactViewController]` — the
   * nearest view controller ABOVE it in the RN tree. A sheet that is a sibling of
   * a presented Modal resolves to the root controller, which is already
   * presenting, so UIKit refuses; RN still marks it presented and never retries.
   * The button that opened it just does nothing, with no error and no log.
   * (Reproduced by: DocumentReviewScreen → "Ask for a new one".)
   *
   * Nesting a real Modal instead would work, but two RN Modals dismissing in
   * overlapping frames strand an invisible view controller on iOS that swallows
   * every touch on the screen underneath. One Modal per screen; everything else
   * is a view inside it — the same rule DocumentViewer and PassportDetailsPanel
   * already follow.
   *
   * The layer is absolutely positioned, so the caller must render it inside its
   * Modal (last child, so it stacks above the rest).
   */
  inline?: boolean;
}

export function BottomSheetShell({
  visible,
  onClose,
  children,
  backdropColor = 'rgba(0,0,0,0.45)',
  avoidKeyboard = false,
  swipeToDismiss = true,
  onDismissed,
  inline = false,
}: Props) {
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } =
    useSheetTransition(visible, onClose);
  const insets = useSafeAreaInsets();
  // Gated on `visible` as well as the prop: a closed sheet must not hold a
  // keyboard inset from the last time it was open.
  const keyboardInset = useIosKeyboardInset(avoidKeyboard && visible);

  // Android: the RN Modal draws in its OWN native window, and how much of the navigation bar
  // that window covers is not ours to decide — so MEASURE it, never assume.
  //
  // MEASURED ON DEVICE (Android 13 / api 33, Expo Go, 3-button nav, 2026-09-06):
  //   Dimensions screen = 800dp, Dimensions window = 722dp, insets t34 b44 (722 = 800 - 34 - 44),
  //   and the Modal's OWN box = 800dp. The modal window covers the WHOLE screen there.
  // So a bottom-anchored sheet already sits on the physical bottom and must NOT be moved.
  //
  // The previous fix here read `Dimensions.get('window')` (722 — the ACTIVITY's window, not the
  // Modal's), concluded the modal window stopped above the nav bar, and nudged every Android
  // sheet down by `insets.bottom`. That pushed the sheet a whole nav bar BELOW the screen: the
  // sheet's own `paddingBottom: insets.bottom` went off-screen instead of clearing the nav bar,
  // and pinned footers (the Save button) ended up under the system buttons.
  //
  // A nudge is still right on any device whose modal window really does stop short — RN sets
  // `setDecorFitsSystemWindows(true)` on the dialog when `navigationBarTranslucent` is off, and
  // whether that has any effect depends on the OS version (Android 15+ enforces edge-to-edge and
  // ignores it). `probe` below is an absolutely-filled, untouchable view sized to the modal
  // window, so `screen height - probe height` IS the slice of the bottom the window does not
  // cover; clamped to `insets.bottom` it is 0 on this device and one nav bar where the old
  // assumption held. Transform, not margin, so the measured sheet height — and with it the
  // slide-out animation — is unaffected. Sheets keep padding `insets.bottom` themselves; that is
  // correct either way. (expo/expo#39749 is why `navigationBarTranslucent` is still not the fix.)
  //
  // The probe sits OUTSIDE the KeyboardAvoidingView deliberately: KAV shrinks its own box, and a
  // reading from inside it says "the window misses the bottom" and nudges the sheet down over the
  // keyboard. The value is latched to the tallest reading and cached for the app session (the
  // window only ever shrinks, and the app is portrait-locked), so it is measured once and never
  // re-renders a sheet again.
  const [measuredWindowH, setMeasuredWindowH] = React.useState(cachedWindowHeight);
  // Sheets are mounted with their screen, long before they are opened, so most of them mount
  // BEFORE anything has measured — their state starts at 0 and would never learn the cached
  // value. (That is what pushed the operator-terms sheet 44dp down while the cancellation
  // sheet, which happened to measure first, was correct.) Re-read the cache on every open.
  React.useEffect(() => {
    if (mounted && cachedWindowHeight !== measuredWindowH) setMeasuredWindowH(cachedWindowHeight);
  }, [mounted, measuredWindowH]);
  const onProbeLayout = React.useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > cachedWindowHeight) cachedWindowHeight = h;
    // Sync even when this sheet did not raise the cache — see the effect above.
    setMeasuredWindowH(prev => (prev === cachedWindowHeight ? prev : cachedWindowHeight));
    if (h <= 0) return;
    if (__DEV__) {
      const screen = Dimensions.get('screen');
      const win = Dimensions.get('window');
      console.log(
        `[SheetMetrics] api=${Platform.Version} screenH=${screen.height} windowH=${win.height} ` +
          `modalWindowH=${h} insets={t:${insets.top},b:${insets.bottom}} ` +
          `nudge=${Math.max(0, Math.min(insets.bottom, Math.round(screen.height - h)))}`,
      );
    }
  }, [insets.top, insets.bottom]);

  const uncoveredBottom =
    measuredWindowH > 0
      ? Math.max(
          0,
          Math.min(insets.bottom, Math.round(Dimensions.get('screen').height - measuredWindowH)),
        )
      : // Nothing measured yet (first sheet of the session, mid-first-frame). Fail SAFE with
        // no nudge: the worst case is the sheet resting on the modal window's bottom edge,
        // which is a cosmetic gap on a device whose window stops short — where nudging blind
        // is what buries a pinned button under the nav bar.
        0;

  const androidNavBarNudge =
    Platform.OS === 'android' && uncoveredBottom > 0
      ? { transform: [{ translateY: uncoveredBottom }] }
      : undefined;

  // Sized to the modal window, invisible, and untouchable. Android only — iOS never nudges.
  // Kept mounted for as long as the sheet is open, NOT removed after the first reading: the
  // dialog window can report a short first layout (the activity's height, before the window's
  // own insets are applied) and only on a later pass its full height. Removing the probe on
  // the first reading latched that short value for the whole session and nudged every later
  // sheet down by a nav bar. It is one pointer-transparent view; the state only changes when
  // the reading grows, so it costs at most two renders per app launch.
  const probe =
    Platform.OS === 'android' ? (
      <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onProbeLayout} />
    ) : null;

  // `onDismiss` is iOS-only. Everywhere else the Modal has no teardown callback, so
  // fall back to the unmount of our own `mounted` flag — safe there because those
  // platforms present their pickers in-process. `inline` has no Modal at all, so it
  // takes the same fallback on every platform: there is no controller to tear down,
  // which is the whole reason the callback exists.
  const onDismissedRef = React.useRef(onDismissed);
  onDismissedRef.current = onDismissed;
  const wasMounted = React.useRef(mounted);
  React.useEffect(() => {
    if (Platform.OS === 'ios' && !inline) return;
    if (wasMounted.current && !mounted) onDismissedRef.current?.();
    wasMounted.current = mounted;
  }, [mounted, inline]);

  const isRenderProp = typeof children === 'function';
  const content = isRenderProp
    ? (children as (api: SheetApi) => React.ReactNode)({ panHandlers })
    : children;

  const body = (
    <View style={styles.container}>
      {/* Tap-to-close lives on the SCRIM — a sibling painted BELOW the sheet — and never on
          an ancestor of the sheet.
          WHY: a Pressable claims the touch on finger-DOWN. Wrapped around the sheet (which is
          what this used to be, plus an inner Pressable calling stopPropagation), it sits above
          every sheet's ScrollView, and on Android that fights the scroll: the first drag is
          swallowed and only a second one, after the responder has been handed over, scrolls.
          As a sibling it cannot: a tap on the sheet finds no responder among the sheet's own
          ancestors and correctly does nothing, while a tap outside the sheet lands here.
          Plain Pressable, not Animated-wrapped — those don't reliably capture touches, and the
          taps would leak to the screen behind. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor, opacity: backdropOpacity }]}
        />
      </Pressable>
      {/* The keyboard inset lives HERE, on a spacer wrapper — never on
          `styles.container` and never on the sheet itself.
          • Not the container: it is the full-screen `flex-end` box, and padding
            there shortens the box the sheet is pinned to. That was the bug.
          • Not the sheet: `onSheetLayout` measures the view below this one, and
            an inset folded into that measurement would make the slide-out
            animation travel the sheet's height PLUS the keyboard's.
          The scrim above is `absoluteFill`, so it keeps covering the whole screen
          regardless of what happens in here. */}
      <View style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : null}>
        <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
          {/* Whole-sheet swipe only when NOT using the render-prop (caller places it).
              A plain View, not a Pressable: nothing here needs to answer a tap, and a
              Pressable would put the responder back above the sheet's ScrollView. */}
          <View
            style={androidNavBarNudge}
            {...(swipeToDismiss && !isRenderProp ? panHandlers : {})}
          >
            {content}
          </View>
        </Animated.View>
      </View>
    </View>
  );

  // Android only. iOS is handled by `keyboardInset` above — see
  // useIosKeyboardInset for why KAV cannot wrap the container.
  const wrapped =
    avoidKeyboard && Platform.OS !== 'ios' ? (
      <KeyboardAvoidingView behavior="height" style={styles.flex}>
        {body}
      </KeyboardAvoidingView>
    ) : (
      body
    );

  // A layer, not a window. `mounted` (not `visible`) so the slide-out still plays.
  if (inline)
    return mounted ? (
      <View style={styles.layer}>
        {probe}
        {wrapped}
      </View>
    ) : null;

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
      {probe}
      {wrapped}
    </Modal>
  );
}

export default BottomSheetShell;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  // `inline` only. Above DocumentViewer's own inline layer (zIndex 50), because a
  // sheet opened from the viewer has to sit on top of it.
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 60 },
});
