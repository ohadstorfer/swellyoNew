import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  interpolateColor,
  Easing,
  SharedValue,
  DerivedValue,
} from 'react-native-reanimated';
import { Images } from '../../assets/images';

// Graduated frost: many micro-bands, each adding a sliver of blur. Per-band
// steps are small enough (1-6) that no single edge is visible, while the
// stack compounds to a strong frost right behind the bar.
const BLUR_BANDS = [
  { top: '0%' as const, intensity: 1 },
  { top: '12%' as const, intensity: 2 },
  { top: '25%' as const, intensity: 2 },
  { top: '38%' as const, intensity: 3 },
  { top: '50%' as const, intensity: 3 },
  { top: '62%' as const, intensity: 4 },
  { top: '74%' as const, intensity: 5 },
  { top: '85%' as const, intensity: 6 },
];

// Collapsed pose: how far the bar sinks and shrinks when the user scrolls away
const COLLAPSE_TRANSLATE_Y = 26;
const COLLAPSE_SCALE = 0.9;
// The frost zone compresses toward the bottom edge alongside the bar
const FROST_COLLAPSE_SCALE = 0.72;
// Minimum scroll delta (px) before we read it as a direction change —
// filters out touch jitter.
const NAV_DIR_THRESHOLD = 8;
const TIMING = { duration: 450, easing: Easing.out(Easing.cubic) };
// The active-pill hand-off: exponential ease-OUT — launches at full speed
// immediately, all the slowness lives in the long settle at the end
const ITEM_TIMING = { duration: 350, easing: Easing.out(Easing.exp) };
const ITEM_SIZE = 66; // square side of an inactive item

export interface TripsBottomNavControl {
  /** 0 = resting, 1 = collapsed. Drive animations off this. */
  progress: SharedValue<number>;
  /**
   * Feed vertical scroll events here. `key` separates scroll surfaces (each
   * tab tracks its own last offset), so switching tabs doesn't produce a
   * phantom delta.
   */
  onVerticalScroll: (key: string, e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Discrete collapse (e.g. sideways deck swipe) — animates on its own. */
  collapse: () => void;
  /** Discrete restore (tap on the bar). */
  expand: () => void;
}

/**
 * The bar owns its scroll behavior: screens just pipe their scroll events in.
 * Scroll down sinks the bar, scroll up / tapping it restores it; sideways
 * swipes collapse it too. All transitions are timed (not finger-tracked).
 */
export function useTripsBottomNavControl(): TripsBottomNavControl {
  const progress = useSharedValue(0);
  const lastY = useRef<Record<string, number>>({});
  // Where the bar is headed (0 or 1) — guards against re-firing the same
  // animation on every scroll event.
  const target = useRef(0);

  const animateTo = useCallback(
    (next: 0 | 1) => {
      if (target.current === next) return;
      target.current = next;
      progress.value = withTiming(next, TIMING);
    },
    [progress],
  );

  const onVerticalScroll = useCallback(
    (key: string, e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const prev = lastY.current[key];
      if (prev === undefined) {
        lastY.current[key] = y;
        return;
      }
      const dy = y - prev;
      if (Math.abs(dy) < NAV_DIR_THRESHOLD) return;
      lastY.current[key] = y;
      // Scroll down → sink; scroll up or top bounce → restore.
      animateTo(dy > 0 && y > 0 ? 1 : 0);
    },
    [animateTo],
  );

  const collapse = useCallback(() => animateTo(1), [animateTo]);

  const expand = useCallback(() => animateTo(0), [animateTo]);

  return useMemo(
    () => ({ progress, onVerticalScroll, collapse, expand }),
    [progress, onVerticalScroll, collapse, expand],
  );
}

export type NavKey = 'lineup' | 'trips' | 'profile';

const NAV_ITEMS: { key: NavKey; label: string; icon: ImageSourcePropType }[] = [
  { key: 'lineup', label: 'The Lineup', icon: Images.nav.theLineup },
  { key: 'trips', label: 'Trips', icon: Images.nav.trips },
  { key: 'profile', label: 'Profile', icon: Images.nav.profile },
];

/**
 * One bar item that morphs between a dark 66px square (inactive) and the
 * white labeled pill (active). `p` is 0..1 active-ness; everything —
 * width, colors, icon tint, label reveal — derives from it.
 */
const NavItem: React.FC<{
  p: DerivedValue<number>;
  label: string;
  icon: ImageSourcePropType;
  expandedWidth: number;
  onPress: () => void;
}> = ({ p, label, icon, expandedWidth, onPress }) => {
  const boxStyle = useAnimatedStyle(() => ({
    width: ITEM_SIZE + p.value * (expandedWidth - ITEM_SIZE),
    backgroundColor: interpolateColor(p.value, [0, 1], ['#333333', '#FFFFFF']),
  }));
  // maxWidth 0 removes the label from layout when inactive (keeps the icon
  // centered in the square); opacity fades it as the pill opens.
  const labelStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    maxWidth: p.value * 160,
  }));
  const iconStyle = useAnimatedStyle(() => ({
    tintColor: interpolateColor(p.value, [0, 1], ['#FAFAFA', '#333333']),
  }));

  return (
    <Reanimated.View style={[styles.item, boxStyle]}>
      <TouchableOpacity
        style={styles.itemTouch}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Reanimated.Image
          source={icon}
          style={[styles.icon, iconStyle]}
          resizeMode="contain"
        />
        <Reanimated.View style={[styles.labelClip, labelStyle]}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </Reanimated.View>
      </TouchableOpacity>
    </Reanimated.View>
  );
};

interface TripsBottomNavProps {
  control: TripsBottomNavControl;
  /**
   * Which item shows as the open pill — CONTROLLED by the app's navigation
   * state. The bar is a single persistent floating component above the
   * screens; pressing an item navigates instantly and the pill slides while
   * the page underneath swaps.
   */
  active: NavKey;
  /** Navigate to the user's own profile. */
  onProfilePress?: () => void;
  /** Navigate to The Lineup / messages. */
  onLineupPress?: () => void;
  /** Navigate to the Trips screen. */
  onTripsPress?: () => void;
}

/**
 * Floating bottom nav bar (Figma nodes 12268:32990 / 12279:78439).
 * The white pill slides to the pressed item (The Lineup / Trips / Profile) —
 * visual state only for now, no page navigation. Rendered once at the bottom
 * of TripsScreen so it overlays all three tabs. Collapse state persists
 * across tab switches.
 */
export default function TripsBottomNav({
  control,
  active,
  onProfilePress,
  onLineupPress,
  onTripsPress,
}: TripsBottomNavProps) {
  const { width } = useWindowDimensions();
  const { progress, expand } = control;
  // One activeness driver per item; withTiming retargets when `active` flips,
  // so the outgoing pill shrinks while the incoming one grows in sync.
  const lineupP = useDerivedValue<number>(
    () => withTiming(active === 'lineup' ? 1 : 0, ITEM_TIMING),
    [active],
  );
  const tripsP = useDerivedValue<number>(
    () => withTiming(active === 'trips' ? 1 : 0, ITEM_TIMING),
    [active],
  );
  const profileP = useDerivedValue<number>(
    () => withTiming(active === 'profile' ? 1 : 0, ITEM_TIMING),
    [active],
  );
  const itemProgress: Record<NavKey, DerivedValue<number>> = {
    lineup: lineupP,
    trips: tripsP,
    profile: profileP,
  };

  const barWidth = Math.min(346, width - 100);
  // bar padding (2x8) + the two inter-item gaps (2x8) + two squares
  const expandedWidth = barWidth - 32 - 2 * ITEM_SIZE;

  const handleItemPress = useCallback(
    (key: NavKey) => {
      expand();
      // Navigate immediately — the app state change flips `active`, and the
      // pill slides while the page underneath swaps (the bar itself persists
      // above the screens, so the animation is never cut off).
      if (key === 'profile' && onProfilePress) {
        onProfilePress();
      } else if (key === 'lineup' && onLineupPress) {
        onLineupPress();
      } else if (key === 'trips' && onTripsPress) {
        onTripsPress();
      }
    },
    [expand, onProfilePress, onLineupPress, onTripsPress],
  );

  const barAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: progress.value * COLLAPSE_TRANSLATE_Y },
      { scale: 1 - progress.value * (1 - COLLAPSE_SCALE) },
    ],
    // Collapsed bar fades down slightly (to 65%)
    opacity: 1 - progress.value * 0.35,
  }));

  // The frost shrinks with the bar: scaleY pinned to the bottom edge (the
  // translate compensates for RN scaling around the center), so the blur's
  // top edge sinks while the bottom stays put.
  const frostHeight = useSharedValue(0);
  const frostStyle = useAnimatedStyle(() => {
    const s = 1 - progress.value * (1 - FROST_COLLAPSE_SCALE);
    return {
      transform: [
        { translateY: ((1 - s) * frostHeight.value) / 2 },
        { scaleY: s },
      ],
    };
  });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Reanimated.View
        style={[StyleSheet.absoluteFill, frostStyle]}
        pointerEvents="none"
        onLayout={e => {
          frostHeight.value = e.nativeEvent.layout.height;
        }}
      >
        {BLUR_BANDS.map(band => (
          <BlurView
            key={band.top}
            intensity={band.intensity}
            tint="light"
            style={[styles.blurBand, { top: band.top }]}
            pointerEvents="none"
          />
        ))}
        <LinearGradient
          colors={['rgba(250,250,250,0)', 'rgba(250,250,250,0.55)', '#FAFAFA']}
          locations={[0, 0.45, 0.85]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </Reanimated.View>
      <Reanimated.View style={barAnimStyle}>
        <Pressable style={[styles.bar, { width: barWidth }]} onPress={expand}>
          {NAV_ITEMS.map(item => (
            <NavItem
              key={item.key}
              p={itemProgress[item.key]}
              label={item.label}
              icon={item.icon}
              expandedWidth={expandedWidth}
              onPress={() => handleItemPress(item.key)}
            />
          ))}
        </Pressable>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 90,
    paddingBottom: 44,
  },
  blurBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 24,
    backgroundColor: '#212121',
  },
  item: {
    height: ITEM_SIZE,
    borderRadius: 16,
    borderWidth: 1,
    // Same as the dark square's fill, so it's invisible until the pill turns
    // white (Figma shows a #333 hairline on the active pill).
    borderColor: '#333333',
    overflow: 'hidden',
  },
  itemTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  icon: {
    width: 20,
    height: 20,
  },
  labelClip: {
    overflow: 'hidden',
  },
  label: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    lineHeight: 22,
    color: '#333333',
  },
});
