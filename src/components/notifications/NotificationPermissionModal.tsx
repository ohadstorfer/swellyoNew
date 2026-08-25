import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TripIcon, type TripIconName } from '../trips/tripIcons';
import { ff } from '../../theme/fonts';

/**
 * "Stay in the loop" — the pre-permission popup (Figma 15098:17656).
 *
 * It exists so the one-shot iOS permission prompt is never the first thing the
 * user sees: this explains what push is for, and only the CTA triggers the OS
 * banner. The component is deliberately dumb about permissions — it renders and
 * reports taps; useNotificationPermissionPrompt owns when it appears and what
 * the CTA actually does.
 */

// Figma tokens (Swellyo Data Entry App V.1.3). Sizes resolved via
// get_variable_defs, not the flattened px in the design context.
const C = {
  card: '#FFFFFF',
  ink: '#333333',
  inkMuted: '#7B7B7B',
  inkFaint: '#A0A0A0',
  iconInk: '#222B30',
  tile: '#F7F7F7',
  cta: '#212121',
  ctaText: '#FFFFFF',
  // Colors/Accent/200 -> Colors/Accent/100, left to right (CSS 90deg).
  ringStart: '#B72DF2',
  ringEnd: '#FF5367',
  scrim: 'rgba(0, 0, 0, 0.45)',
};

/** Emil's strong ease-out — the built-in curves are too weak to feel intentional. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ENTER_MS = 220;
const EXIT_MS = 150;
/** Rows cascade in behind the card. Short enough to never gate the CTA. */
const ROW_STAGGER_MS = 50;

const ROWS: { icon: TripIconName; title: string; subtitle: string; strokeWidth?: number }[] = [
  {
    icon: 'calendar-date',
    title: "You're in!",
    subtitle: 'Know the moment a trip accepts you',
    // calendar-date's viewBox is 14.5 where the other two rows are 18, so the
    // same strokeWidth would draw visibly heavier. 14.5/18 lands it on the
    // identical 1px stroke. (Rendered px = strokeWidth / viewBox * size.)
    strokeWidth: 14.5 / 18,
  },
  {
    icon: 'user-check-01',
    title: 'Surfers want to join',
    subtitle: 'A surfer wants in on your trip',
  },
  {
    icon: 'message-text-circle-02',
    title: 'New messages',
    subtitle: 'Stay connected with your crew.',
  },
];

interface NotificationPermissionModalProps {
  visible: boolean;
  /** Primary CTA. The parent decides whether this opens the OS prompt or Settings. */
  onTurnOn: () => void;
  /** "Maybe later", the backdrop, and Android back all land here. */
  onDismiss: () => void;
}

/** Scales down on press so the button feels like it heard the tap. */
const PressScale: React.FC<{
  onPress: () => void;
  style?: any;
  accessibilityLabel: string;
  children: React.ReactNode;
  testID?: string;
}> = ({ onPress, style, accessibilityLabel, children, testID }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (value: number) =>
    Animated.timing(scale, {
      toValue: value,
      duration: 120,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
};

export const NotificationPermissionModal: React.FC<NotificationPermissionModalProps> = ({
  visible,
  onTurnOn,
  onDismiss,
}) => {
  // The Modal has to outlive `visible` so the exit animation can play.
  const [mounted, setMounted] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const rows = useRef(ROWS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(on => {
        if (!cancelled) setReduceMotion(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      rows.forEach(r => r.setValue(0));
      Animated.parallel([
        Animated.timing(progress, {
          toValue: 1,
          duration: ENTER_MS,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
        ...rows.map((row, i) =>
          Animated.timing(row, {
            toValue: 1,
            duration: ENTER_MS,
            delay: ENTER_MS * 0.5 + i * ROW_STAGGER_MS,
            easing: EASE_OUT,
            useNativeDriver: true,
          })
        ),
      ]).start();
      return;
    }

    if (!mounted) return;
    // Exit is faster than enter — the system responding should never feel slow.
    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    // `mounted` is read, not tracked: adding it would re-run the exit on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  // Never animate from scale(0) — nothing in the real world appears from nothing.
  const cardScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      // Android: without this the scrim stops short of the navigation bar and
      // the dim edge is visible against it.
      navigationBarTranslucent={Platform.OS === 'android'}
      onRequestClose={onDismiss}
    >
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: progress,
              transform: reduceMotion ? [] : [{ scale: cardScale }],
            },
          ]}
        >
          {/* Gradient ring: React Native has no gradient border, so the gradient
              is the whole circle and an opaque inner disc leaves only the 1px
              edge showing. */}
          <LinearGradient
            colors={[C.ringStart, C.ringEnd]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.bellRing}
          >
            <View style={styles.bellRingInner}>
              <TripIcon name="bell-ringing-04" size={36} color={C.iconInk} strokeWidth={1.5} />
            </View>
          </LinearGradient>

          <View style={styles.body}>
            <View style={styles.heading}>
              <Text style={styles.title}>Stay in the loop</Text>
              <Text style={styles.subtitle}>Don’t miss the moments that matter.</Text>
            </View>

            <View style={styles.rows}>
              {ROWS.map((row, i) => (
                <Animated.View
                  key={row.title}
                  style={[
                    styles.row,
                    {
                      opacity: rows[i],
                      transform: reduceMotion
                        ? []
                        : [
                            {
                              translateY: rows[i].interpolate({
                                inputRange: [0, 1],
                                outputRange: [6, 0],
                              }),
                            },
                          ],
                    },
                  ]}
                >
                  <View style={styles.rowIcon}>
                    <TripIcon
                      name={row.icon}
                      size={18}
                      color={C.iconInk}
                      strokeWidth={row.strokeWidth ?? 1}
                    />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
                  </View>
                </Animated.View>
              ))}
            </View>

            <View style={styles.cta}>
              <PressScale
                onPress={onTurnOn}
                style={styles.ctaButton}
                accessibilityLabel="Turn on notifications"
                testID="notification-permission-turn-on"
              >
                <TripIcon name="bell-01" size={24} color={C.ctaText} strokeWidth={1.5} />
                <Text style={styles.ctaText}>Turn on notifications</Text>
              </PressScale>

              <PressScale
                onPress={onDismiss}
                style={styles.later}
                accessibilityLabel="Maybe later"
                testID="notification-permission-later"
              >
                <Text style={styles.laterText}>Maybe later</Text>
              </PressScale>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

export default NotificationPermissionModal;

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: C.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 344,
    backgroundColor: C.card,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  // 60×60: 36px glyph + 12 padding, ringed in the accent gradient with its own
  // soft purple glow (Figma: 0 2 14 rgba(183,45,242,0.24)).
  bellRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    // The ring's width. Everything inside is covered by bellRingInner.
    padding: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.ringStart,
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 14,
    elevation: 4,
  },
  bellRingInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    // Figma fills the disc rgba(255,255,255,0.3), which over the white card is
    // just white — and it has to be opaque here or the gradient reads through.
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { width: '100%', gap: 32 },
  heading: { alignItems: 'center', gap: 2 },
  title: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 22,
    lineHeight: 32,
    color: C.ink,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: C.inkMuted,
    textAlign: 'center',
  },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.card,
  },
  rowIcon: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: C.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: C.ink,
  },
  rowSubtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: C.inkFaint,
  },
  cta: { gap: 16 },
  ctaButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: C.cta,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  ctaText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: 16,
    lineHeight: 22,
    color: C.ctaText,
    textAlign: 'center',
  },
  later: { paddingVertical: 4 },
  laterText: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    lineHeight: 18,
    color: C.ink,
    textAlign: 'center',
  },
});
