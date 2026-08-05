// Trip detail tabs — shared chrome on the trip detail screen. Underline style
// (Figma node 12557-4992). The active tab is bold with an accent underline;
// switching animates smoothly: the weight crossfades (two stacked text layers)
// and the accent underline slides between segments.
//
// Overview and Plan are the traveler's two tabs. An operator hosting the trip
// gets a third, Dashboard — so this takes a LIST of tabs rather than the two it
// used to hardcode. Everything below is sized off `tabs.length`, never off a
// literal 2.
//
// Only shown to members (host + approved); non-members never see it.

import React, { useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { ff } from '../../theme/fonts';

export type TripTab = 'overview' | 'plan' | 'dashboard';

export const TAB_LABEL: Record<TripTab, string> = {
  overview: 'Overview',
  plan: 'Plan',
  dashboard: 'Dashboard',
};

interface Props {
  value: TripTab;
  onChange: (tab: TripTab) => void;
  /** Which tabs this viewer gets, in order. Defaults to the traveler's two. */
  tabs?: TripTab[];
}

const DEFAULT_TABS: TripTab[] = ['overview', 'plan'];

// The indicator MOVES across the screen rather than entering or leaving it, so
// it accelerates and decelerates — ease-out would have it arrive already
// stopped. Same curve the app's other on-screen movement uses.
const SLIDE = { duration: 220, easing: Easing.bezier(0.77, 0, 0.175, 1) };

export const TripTabToggle: React.FC<Props> = ({ value, onChange, tabs = DEFAULT_TABS }) => {
  const count = tabs.length;
  const index = Math.max(0, tabs.indexOf(value));

  // Animated in tab-INDEX units, not pixels, so the same value drives both the
  // slide and each label's weight crossfade.
  const position = useSharedValue(index);
  const width = useSharedValue(0);

  useEffect(() => {
    position.value = withTiming(index, SLIDE);
  }, [index, position]);

  // Only translateX is animated. The indicator's WIDTH is a static percentage
  // below — putting it in here would run a layout property through the UI
  // thread on every frame of the slide, for a value that never changes during
  // one.
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (position.value * width.value) / count }],
  }));

  return (
    <View
      style={styles.container}
      onLayout={e => {
        width.value = e.nativeEvent.layout.width;
      }}
    >
      {tabs.map((tab, i) => (
        <TabSegment
          key={tab}
          label={TAB_LABEL[tab]}
          index={i}
          position={position}
          selected={tab === value}
          onPress={() => onChange(tab)}
        />
      ))}

      <Animated.View
        style={[styles.indicator, { width: `${100 / count}%` }, indicatorStyle]}
      />
    </View>
  );
};

/**
 * One tab. Two stacked text layers — bold and regular — crossfaded by distance
 * from the active index, so the label never reflows mid-animation the way a
 * `fontWeight` swap would.
 */
const TabSegment: React.FC<{
  label: string;
  index: number;
  position: SharedValue<number>;
  selected: boolean;
  onPress: () => void;
}> = ({ label, index, position, selected, onPress }) => {
  // 1 when this tab is active, 0 once the indicator is a full tab away. The
  // clamp is what keeps a three-tab jump (Overview -> Dashboard) from flashing
  // the middle label as it passes over Plan.
  const weight = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(position.value - index));
    return { opacity: 1 - d };
  });
  const regular = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(position.value - index));
    return { opacity: d };
  });

  return (
    <TouchableOpacity
      style={styles.segment}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={styles.labelWrap}>
        <Animated.Text numberOfLines={1} style={[styles.label, styles.bold, weight]}>
          {label}
        </Animated.Text>
        <Animated.Text
          numberOfLines={1}
          style={[styles.label, styles.reg, styles.overlay, regular]}
        >
          {label}
        </Animated.Text>
      </View>
    </TouchableOpacity>
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
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    lineHeight: 20,
    color: '#333333',
    textAlign: 'center',
    // Android clips the last glyph when the regular layer measures slightly
    // wider than the bold-sized box (the overflow wraps to a hidden 2nd line).
    // Killing the extra font padding tightens metrics; numberOfLines={1} keeps
    // each layer on one line.
    includeFontPadding: false,
  },
  // Weight is carried by the weight-specific family (Inter-Bold / Inter-Regular).
  // On NATIVE we must NOT also set `fontWeight` — pairing a custom weight-
  // specific family with a numeric `fontWeight` breaks Android font selection and
  // the bold layer falls back to a narrower system font, so the box it sizes ends
  // up too small and the regular layer gets clipped. On WEB `ff()` returns the
  // plain CSS family, which DOES need `fontWeight` to render bold — so keep it
  // there. The 4px gutter is a safety margin so neither weight's metrics ever
  // touch the box edge.
  bold: {
    fontFamily: ff('Inter', '700'),
    paddingHorizontal: 4,
    ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : null),
  },
  reg: {
    fontFamily: ff('Inter', '400'),
    ...(Platform.OS === 'web' ? { fontWeight: '400' as const } : null),
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Accent underline — one segment wide, slides to the active tab. Sits on top
  // of the container's hairline. Width comes from the animated style, because
  // it depends on how many tabs this viewer has.
  indicator: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    height: 3,
    backgroundColor: '#05BCD3',
  },
});

export default TripTabToggle;
