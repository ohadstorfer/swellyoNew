import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ff, fs } from '../../theme/fonts';
import { Images } from '../../assets/images';

/**
 * Empty state for the Trips tab › My Trips — shown when the user is in no trips.
 * Figma: 17029:25489.
 *
 * Two variants, one layout. Only operators can create a trip, so everyone else
 * gets the same button pointing at Explore instead.
 *
 * Sizes come from the Figma variables (Headings/M H-3 = Montserrat Bold 24/1.2,
 * Body/B-3 = Inter 400 12/18), NOT from the flattened px in the code export.
 */

const TEXT = '#333333';      // Text/M - 01
const ACCENT = '#05BCD3';    // Fill/M - Accent
const WHITE = '#FFFFFF';     // Icon/M - white

/** plus-circle (untitled-ui), stroked in white. */
function PlusCircleIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={WHITE} strokeWidth={1.5} />
      <Path
        d="M12 8V16M8 12H16"
        stroke={WHITE}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const COPY = {
  create: {
    body: 'Create or join a trip and start your surf adventure.',
    button: 'Create your first trip',
    testID: 'trips-empty-create-button',
  },
  explore: {
    body: 'Join a trip and start your surf adventure.',
    button: 'Explore trips',
    testID: 'trips-empty-explore-button',
  },
} as const;

interface NoTripsEmptyStateProps {
  variant: keyof typeof COPY;
  onPress: () => void;
}

export default function NoTripsEmptyState({ variant, onPress }: NoTripsEmptyStateProps) {
  const copy = COPY[variant];
  return (
    <View style={styles.container}>
      <Image
        source={Images.noTripsIllustration}
        style={styles.illustration}
        resizeMode="contain"
      />

      <View style={styles.content}>
        <View style={styles.copy}>
          <Text style={styles.title}>No trips yet?</Text>
          <Text style={styles.body}>
            Your next wave is waiting.{'\n'}
            {copy.body}
          </Text>
        </View>

        <TouchableOpacity
          testID={copy.testID}
          style={styles.button}
          activeOpacity={0.9}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={copy.button}
        >
          {variant === 'create' && <PlusCircleIcon />}
          <Text style={styles.buttonText}>{copy.button}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  // Figma "Illustation" group — 79 × 93 line-art palm + surfboard.
  illustration: {
    width: 79,
    height: 93,
  },
  content: {
    width: '100%',
    maxWidth: 334,
    gap: 24,
  },
  copy: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    // Headings/M H-3
    fontFamily: ff('Montserrat', '700'),
    fontSize: fs(24),
    lineHeight: 29,
    letterSpacing: -1,
    color: TEXT,
    textAlign: 'center',
    ...(Platform.OS === 'web' && { fontWeight: '700' as const }),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  body: {
    // Body/B-3
    fontFamily: ff('Inter', '400'),
    fontSize: fs(12),
    lineHeight: 18,
    color: TEXT,
    textAlign: 'center',
    ...(Platform.OS === 'web' && { fontWeight: '400' as const }),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  buttonText: {
    fontFamily: ff('Montserrat', '600'),
    fontSize: fs(16),
    lineHeight: 22,
    color: WHITE,
    textAlign: 'center',
    ...(Platform.OS === 'web' && { fontWeight: '600' as const }),
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
});
