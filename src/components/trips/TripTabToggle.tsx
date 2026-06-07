// Overview / Plan tabs — shared chrome on the trip detail screen. Underline
// style (Figma node 12557-4992). The active tab is bold with an accent
// underline; switching animates smoothly: the weight crossfades (two stacked
// text layers) and the accent underline slides between halves. Only shown to
// members (host + approved); non-members never see it.

import React, { useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

export type TripTab = 'overview' | 'plan';

interface Props {
  value: TripTab;
  onChange: (tab: TripTab) => void;
}

export const TripTabToggle: React.FC<Props> = ({ value, onChange }) => {
  // 0 = overview active, 1 = plan active. Drives both the weight crossfade and
  // the sliding underline.
  const progress = useSharedValue(value === 'plan' ? 1 : 0);
  const width = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(value === 'plan' ? 1 : 0, { duration: 220 });
  }, [value, progress]);

  // Accent underline slides to the active half.
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (width.value / 2) }],
  }));
  // Bold layer is visible when that tab is active; regular layer is its inverse.
  const ovBold = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const ovReg = useAnimatedStyle(() => ({ opacity: progress.value }));
  const plBold = useAnimatedStyle(() => ({ opacity: progress.value }));
  const plReg = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <View
      style={styles.container}
      onLayout={e => {
        width.value = e.nativeEvent.layout.width;
      }}
    >
      <TouchableOpacity
        style={styles.segment}
        onPress={() => onChange('overview')}
        activeOpacity={0.8}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === 'overview' }}
        accessibilityLabel="Overview"
      >
        <View style={styles.labelWrap}>
          <Animated.Text style={[styles.label, styles.bold, ovBold]}>Overview</Animated.Text>
          <Animated.Text style={[styles.label, styles.reg, styles.overlay, ovReg]}>
            Overview
          </Animated.Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.segment}
        onPress={() => onChange('plan')}
        activeOpacity={0.8}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === 'plan' }}
        accessibilityLabel="Plan"
      >
        <View style={styles.labelWrap}>
          <Animated.Text style={[styles.label, styles.bold, plBold]}>Plan</Animated.Text>
          <Animated.Text style={[styles.label, styles.reg, styles.overlay, plReg]}>
            Plan
          </Animated.Text>
        </View>
      </TouchableOpacity>

      <Animated.View style={[styles.indicator, indicatorStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  // Bleeds edge-to-edge out of the detail view's 16px gutter, like a tab bar.
  container: {
    flexDirection: 'row',
    marginTop: 4,
    marginHorizontal: -16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  segment: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sized by the (always-present) bold layer so the width never reflows; the
  // regular layer is overlaid and crossfaded on top.
  labelWrap: {
    position: 'relative',
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    color: '#333333',
    textAlign: 'center',
  },
  bold: { fontWeight: '700' },
  reg: { fontWeight: '400' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Accent underline — half-width, slides between the two tabs. Sits on top of
  // the container's hairline.
  indicator: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    height: 3,
    width: '50%',
    backgroundColor: '#05BCD3',
  },
});

export default TripTabToggle;
