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
import { Animated, Dimensions, Easing, LayoutChangeEvent } from 'react-native';

const SCREEN_H = Dimensions.get('window').height;

export function useSheetTransition(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Start fully below the screen; corrected to the measured height on layout.
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const sheetH = useRef(0);
  const animatedIn = useRef(false);

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

  return { mounted, backdropOpacity, translateY, onSheetLayout };
}
