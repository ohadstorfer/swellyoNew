import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Text } from '../Text';

export type JoinRequestActionState =
  | 'idle'
  | 'approving'
  | 'declining'
  | 'approved'
  | 'declined';

interface JoinRequestActionBarProps {
  /** Title of the trip the user requested to join (for context). */
  tripTitle: string;
  state: JoinRequestActionState;
  onApprove: () => void;
  onDecline: () => void;
  /** Called once the bar has finished collapsing after a decision, so the
   *  parent can unmount it. The profile itself stays open. */
  onDismissed: () => void;
}

const HOLD_MS = 650; // time the "Approved ✓" / "Declined" pill stays before collapsing

/**
 * Solid white bar pinned at the top of a requester's profile, shown to the host
 * when that user has a pending request to join one of the host's trips.
 *
 * On a decision the two buttons cross-fade into a confirmation pill, hold
 * briefly, then the bar slides up and collapses its own height — the cover
 * eases back up and the profile stays open.
 */
export const JoinRequestActionBar: React.FC<JoinRequestActionBarProps> = ({
  tripTitle,
  state,
  onApprove,
  onDecline,
  onDismissed,
}) => {
  const insets = useSafeAreaInsets();
  const decided = state === 'approved' || state === 'declined';
  const busy = state === 'approving' || state === 'declining';

  // Captured natural height, so we can animate height → 0 on collapse.
  const [barHeight, setBarHeight] = useState(0);
  const measured = useRef(false);
  const collapse = useSharedValue(0); // 0 = open, 1 = fully collapsed

  useEffect(() => {
    if (!decided || barHeight === 0) return;
    collapse.value = withDelay(
      HOLD_MS,
      withTiming(1, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDismissed)();
      }),
    );
  }, [decided, barHeight]);

  const collapseStyle = useAnimatedStyle(() => ({
    height: barHeight > 0 ? barHeight * (1 - collapse.value) : undefined,
    opacity: 1 - collapse.value,
    transform: [{ translateY: -8 * collapse.value }],
  }));

  return (
    <Animated.View style={[styles.collapseWrap, collapseStyle]}>
      <View
        style={[styles.bar, { paddingTop: insets.top + 10 }]}
        onLayout={(e) => {
          if (!measured.current) {
            measured.current = true;
            setBarHeight(e.nativeEvent.layout.height);
          }
        }}
      >
        <Text style={styles.subtitle} numberOfLines={1}>
          {`Wants to join · ${tripTitle}`}
        </Text>

        {decided ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.row}>
            <View
              style={[
                styles.pill,
                state === 'approved' ? styles.pillApproved : styles.pillDeclined,
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  state === 'approved'
                    ? styles.pillTextApproved
                    : styles.pillTextDeclined,
                ]}
              >
                {state === 'approved' ? 'Approved ✓' : 'Declined'}
              </Text>
            </View>
          </Animated.View>
        ) : (
          <Animated.View exiting={FadeOut.duration(150)} style={styles.row}>
            <Pressable
              onPress={onDecline}
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                styles.declineBtn,
                pressed && styles.pressed,
              ]}
            >
              {state === 'declining' ? (
                <ActivityIndicator size="small" color="#222B30" />
              ) : (
                <Text style={[styles.btnText, styles.declineText]}>Decline</Text>
              )}
            </Pressable>

            <Pressable
              onPress={onApprove}
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                styles.approveBtn,
                pressed && styles.pressed,
              ]}
            >
              {state === 'approving' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[styles.btnText, styles.approveText]}>Approve</Text>
              )}
            </Pressable>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  collapseWrap: {
    overflow: 'hidden',
    zIndex: 20,
  },
  bar: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECEFF1',
  },
  subtitle: {
    fontSize: 12.5,
    color: '#7A828A',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9CED4',
  },
  approveBtn: {
    backgroundColor: '#212121',
  },
  btnText: {
    fontSize: 15,
  },
  declineText: {
    color: '#222B30',
    fontWeight: '600',
  },
  approveText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  // Emil: subtle press feedback — the bar should feel like it's listening.
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  pill: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillApproved: {
    backgroundColor: '#1B7F4B',
  },
  pillDeclined: {
    backgroundColor: '#F1F3F5',
  },
  pillText: {
    fontSize: 15,
    fontWeight: '700',
  },
  pillTextApproved: {
    color: '#FFFFFF',
  },
  pillTextDeclined: {
    color: '#7A828A',
  },
});
