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

import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, LayoutChangeEvent, PanResponder } from 'react-native';

const SCREEN_H = Dimensions.get('window').height;

// Drag past this many px (or flick faster than this velocity) to dismiss; else
// the sheet springs back to its resting position.
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 1.2;

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

  useEffect(() => {
    if (visible) {
      // Reset to hidden, then animate in once we know the sheet's height.
      animatedIn.current = false;
      backdropOpacity.setValue(0);
      translateY.setValue(sheetH.current || SCREEN_H);
      setMounted(true);
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: sheetH.current || SCREEN_H,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    sheetH.current = h;
    if (!animatedIn.current && visible) {
      animatedIn.current = true;
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
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
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
