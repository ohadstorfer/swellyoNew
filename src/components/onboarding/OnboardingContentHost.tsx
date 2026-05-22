/**
 * Animated middle-content area for the onboarding scaffold. Header (above) and Next
 * button (below) live outside this host, so only the content here moves.
 *
 * On step change it keeps the outgoing content mounted, mounts the incoming content
 * offset by one host-width, and slides both horizontally (forward: incoming enters
 * from the right; back: from the left).
 *
 * Two slots with stable identities ("a" / "b") alternate roles. When a slide finishes,
 * the incoming content STAYS in the slot it animated into (same React key) instead of
 * being moved to a different slot — so React preserves the mounted subtree and there's
 * no unmount/remount flicker. The slide distance is the measured host width, so it's
 * correct on centered/max-width desktop web too.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { stepOrderIndex, type OnboardingStepKey } from './onboardingStepConfig';

const SLIDE_DURATION = 380;
const SLIDE_EASING = Easing.out(Easing.cubic);

type Role = 'a' | 'b';

interface Frame {
  key: OnboardingStepKey;
  role: Role;
}

interface Props {
  activeStepKey: OnboardingStepKey;
  renderStep: (key: OnboardingStepKey) => React.ReactNode;
}

export const OnboardingContentHost: React.FC<Props> = ({ activeStepKey, renderStep }) => {
  const [frames, setFrames] = useState<Frame[]>([{ key: activeStepKey, role: 'a' }]);

  const widthRef = useRef(0);
  const slidingRef = useRef(false);
  const settledKeyRef = useRef<OnboardingStepKey>(activeStepKey);
  const settledRoleRef = useRef<Role>('a');

  const txA = useSharedValue(0);
  const txB = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) widthRef.current = w;
  };

  const commit = (key: OnboardingStepKey, role: Role) => {
    settledKeyRef.current = key;
    settledRoleRef.current = role;
    // Keep the incoming content in the slot it slid into — same key => no remount.
    setFrames([{ key, role }]);
    slidingRef.current = false;
  };

  useEffect(() => {
    if (activeStepKey === settledKeyRef.current) return;

    const w = widthRef.current;
    const delta = stepOrderIndex(activeStepKey) - stepOrderIndex(settledKeyRef.current);
    const dir = delta >= 0 ? 1 : -1; // +1 forward (in from right), -1 back (in from left)

    // No measured width yet, or a slide already running → swap instantly in place.
    if (w <= 0 || slidingRef.current) {
      const role = settledRoleRef.current;
      (role === 'a' ? txA : txB).value = 0;
      settledKeyRef.current = activeStepKey;
      slidingRef.current = false;
      setFrames([{ key: activeStepKey, role }]);
      return;
    }

    const outRole = settledRoleRef.current;
    const inRole: Role = outRole === 'a' ? 'b' : 'a';
    const outTx = outRole === 'a' ? txA : txB;
    const inTx = inRole === 'a' ? txA : txB;

    slidingRef.current = true;
    // Position incoming off-screen before it mounts, then animate both slots.
    inTx.value = dir * w;
    setFrames([
      { key: settledKeyRef.current, role: outRole },
      { key: activeStepKey, role: inRole },
    ]);

    outTx.value = withTiming(-dir * w, { duration: SLIDE_DURATION, easing: SLIDE_EASING });
    inTx.value = withTiming(0, { duration: SLIDE_DURATION, easing: SLIDE_EASING }, (finished) => {
      if (finished) runOnJS(commit)(activeStepKey, inRole);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepKey]);

  const styleA = useAnimatedStyle(() => ({ transform: [{ translateX: txA.value }] }));
  const styleB = useAnimatedStyle(() => ({ transform: [{ translateX: txB.value }] }));

  return (
    <View style={styles.host} onLayout={onLayout}>
      {frames.map((frame) => (
        <Reanimated.View
          key={frame.role}
          style={[StyleSheet.absoluteFill, frame.role === 'a' ? styleA : styleB]}
        >
          {renderStep(frame.key)}
        </Reanimated.View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    overflow: 'hidden',
  },
});
