import React, { useCallback } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { HeaderLogoIcon } from './HeaderLogoIcon';
import { NotificationCenter } from './notifications/NotificationCenter';

interface MainHeaderProps {
  /** User id for the notification bell. */
  userId: string | null;
  /** Left-side title block — the Lineup greeting or the "Trips" title. */
  title: React.ReactNode;
  /** Optional actions rendered to the LEFT of the bell (e.g. the dev kebab). */
  rightActions?: React.ReactNode;
  /** Render the signature-gradient hairline under the bar (Lineup). */
  bottomBorder?: boolean;
  /** Optional content under the bar, inside the dark area (Trips tabs). */
  below?: React.ReactNode;
  /** Space (px) below the bar content. Default 8 (Figma → 60px bar). The
   *  content stays top-anchored; this only adds room underneath, so the
   *  Lineup's 2-line greeting isn't cramped against the bottom border. */
  spaceBelow?: number;
  /** testID for the left (logo + title) block. */
  testID?: string;
}

/**
 * Dark branded header shared by the two top-level tab screens — The Lineup and
 * Trips. Owns the #212121 bar, 16px gutter, Swellyo logo and notification bell,
 * so both screens stay pixel-aligned by construction. Everything that differs
 * between them is a slot: `title`, `rightActions`, `bottomBorder`, `below`.
 *
 * The screen still owns its SafeAreaView (edges top) — this is just the bar.
 */
export const MainHeader: React.FC<MainHeaderProps> = ({
  userId,
  title,
  rightActions,
  bottomBorder = false,
  below,
  spaceBelow = 8,
  testID,
}) => {
  // The title gently fades in each time the screen gains focus, so switching
  // between Lineup and Trips reads as a soft title change. A single shared-value
  // opacity fade — no remount, no React state, no movement — so nothing re-
  // renders the page. The trick that avoids any flicker: we fade IN on focus and
  // reset to 0 on BLUR (the cleanup), i.e. while the screen is off-screen. So the
  // title is never snapped to 0 while visible — by the time you see this screen
  // again it's already at 0 and only ever animates upward. On first mount it
  // starts at 0 and fades in once.
  const titleOpacity = useSharedValue(0);
  useFocusEffect(
    useCallback(() => {
      titleOpacity.value = withTiming(1, {
        duration: 550,
        easing: Easing.inOut(Easing.ease),
      });
      return () => {
        // Runs on blur, while this screen is hidden — invisible reset.
        titleOpacity.value = 0;
      };
    }, [titleOpacity])
  );
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value }));

  return (
    <View style={styles.container}>
      <View style={[styles.bar, { paddingBottom: spaceBelow }]}>
        <View testID={testID} style={styles.left}>
          <HeaderLogoIcon size={40} />
          <Animated.View style={titleStyle}>{title}</Animated.View>
        </View>
        <View style={styles.right}>
          {rightActions}
          <NotificationCenter userId={userId} />
        </View>
      </View>

      {below}

      {bottomBorder && (
        <LinearGradient
          colors={['#05BCD3', '#DBCDBC']}
          locations={[0, 0.7]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.bottomBorder}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#212121',
    position: 'relative',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    // Matches the Figma header Container (node 13373:6865): 8px above the 44px
    // bell, content top-anchored (→ 60px bar with the default spaceBelow). The
    // notch is handled by the screen's SafeAreaView. paddingBottom comes from
    // the `spaceBelow` prop so the Lineup can add room under its 2-line
    // greeting WITHOUT moving the content down or changing the top spacing.
    paddingTop: Platform.OS === 'web' ? 16 : 8,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bottomBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
  },
});
