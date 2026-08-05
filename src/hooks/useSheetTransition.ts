// useSheetTransition — drives bottom-sheet enter/exit with the backdrop and the
// content animating SEPARATELY: the dark scrim FADES in (opacity), while the
// sheet itself SLIDES up from below. (The default Modal animationType="slide"
// slides everything together, so the scrim looked like it slid in too.)
//
// Usage — the tap-to-close target is a plain <Pressable> (a Pressable wrapped by
// Animated.createAnimatedComponent does NOT reliably capture touches, so taps
// leak through to the screen behind). The dim is a separate non-interactive
// layer so it can fade independently of the sliding sheet:
//   const { mounted, backdropOpacity, translateY, onSheetLayout } = useSheetTransition(visible);
//   <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
//     <Pressable style={{ flex: 1, justifyContent: 'flex-end' }} onPress={onClose}>
//       <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: backdropOpacity }]} />
//       <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
//         <Pressable onPress={e => e.stopPropagation()}>…sheet…</Pressable>
//       </Animated.View>
//     </Pressable>
//   </Modal>
//
// Keep the Modal mounted via `mounted` (not `visible`) so the exit animation can
// play before unmount.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, LayoutChangeEvent, PanResponder } from 'react-native';

const SCREEN_H = Dimensions.get('window').height;

// Drag past this many px (or flick faster than this velocity) to dismiss; else
// the sheet springs back to its resting position.
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 1.2;

const ENTER_MS = 320;
const EXIT_MS = 220;

// An interrupted Animated sequence calls its completion callback with
// `finished: false` — or, when the value is seized by another animation, not at
// all. Both backstops below exist because a dropped callback here is not a
// cosmetic glitch: the Modal stays mounted, fully transparent and full-screen,
// swallowing every touch in the app. That is indistinguishable from a freeze
// from the outside (the JS thread is fine, nothing is drawn, nothing is logged).
// A gesture that springs the sheet back, or a re-open mid-close, is enough to
// trigger it. See the `project_modal_onshow_touch_lock` note.
const EXIT_FALLBACK_MS = EXIT_MS + 120;
// onLayout lands on the first frame in practice; if it is ever missed the sheet
// would sit parked off-screen behind that same invisible Modal, so enter anyway.
// 250ms matches the fallback already used for SwellyTopicOverlay — long enough
// that a slow first layout still wins the race and animates from its real height.
const ENTER_FALLBACK_MS = 250;

export function useSheetTransition(visible: boolean, onClose?: () => void) {
  const [mounted, setMounted] = useState(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Start fully below the screen; corrected to the measured height on layout.
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const sheetH = useRef(0);
  const animatedIn = useRef(false);

  // Keep the latest onClose without rebuilding the PanResponder each render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Backstops for the two animation callbacks (see the constants above).
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEnterTimer = useCallback(() => {
    if (enterTimer.current !== null) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
  }, []);
  const clearExitTimer = useCallback(() => {
    if (exitTimer.current !== null) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
  }, []);

  // Never leave a timer behind: firing after unmount would setState on a dead
  // component, and a stale exit timer could unmount a sheet that just re-opened.
  useEffect(() => {
    return () => {
      clearEnterTimer();
      clearExitTimer();
    };
  }, [clearEnterTimer, clearExitTimer]);

  // One-shot: whichever gets there first (onLayout or the fallback) wins.
  const runEnter = useCallback(
    (h: number) => {
      if (animatedIn.current) return;
      animatedIn.current = true;
      clearEnterTimer();
      translateY.setValue(h); // exact hidden position (just below the edge)
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: ENTER_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    },
    [backdropOpacity, translateY, clearEnterTimer],
  );

  // Idempotent: safe to call from both the animation callback and the fallback.
  const finishExit = useCallback(() => {
    clearExitTimer();
    animatedIn.current = false;
    setMounted(false);
  }, [clearExitTimer]);

  useEffect(() => {
    if (visible) {
      // A re-open cancels any pending unmount from the close we interrupted.
      clearExitTimer();
      // Reset to hidden, then animate in once we know the sheet's height.
      animatedIn.current = false;
      backdropOpacity.setValue(0);
      translateY.setValue(sheetH.current || SCREEN_H);
      setMounted(true);
      clearEnterTimer();
      enterTimer.current = setTimeout(
        () => runEnter(sheetH.current || SCREEN_H),
        ENTER_FALLBACK_MS,
      );
    } else if (mounted) {
      clearEnterTimer();
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: sheetH.current || SCREEN_H,
          duration: EXIT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // Only the clean finish unmounts here. An interrupted exit leaves it to
        // the timer below, which a re-open clears — so re-opening mid-close does
        // not get torn down by a stale callback.
        if (finished) finishExit();
      });
      clearExitTimer();
      exitTimer.current = setTimeout(finishExit, EXIT_FALLBACK_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    sheetH.current = h;
    if (visible) runEnter(h);
  };

  // Swipe-to-dismiss. Spread these onto the grabber/header (the non-scrolling top
  // of the sheet) so a downward drag there pulls the sheet down — past a
  // threshold it closes, otherwise it springs back. Attaching to the handle (not
  // the whole sheet) keeps it from fighting any ScrollView inside the body.
  const panResponder = useRef(
    PanResponder.create({
      // Only claim clearly-downward drags; taps and horizontal moves pass through.
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          // Let the visible→false effect play the slide-out from the dragged
          // position (smooth hand-off); the parent owns the actual close.
          onCloseRef.current?.();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 18,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 18,
        }).start();
      },
    })
  ).current;

  return { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers: panResponder.panHandlers };
}
