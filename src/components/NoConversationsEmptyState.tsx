import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { ff, fs } from '../theme/fonts';

/**
 * Empty state for the Lineup list — shown when the user has no conversations.
 * Figma: Home Screen › Frame 39422 (14351:55077).
 *
 * The companion "Tap to get started" label + arrow live in `SwellyTapHint`,
 * rendered in the nav layer so they can point at the floating Swelly avatar.
 */

const TEXT = '#333333'; // Text/M - 01
const DOT = '#05BCD3';

/** message-chat-circle, with the six typing dots Figma layers on top. */
function MessageChatCircleIcon() {
  return (
    <Svg width={57} height={57} viewBox="0 0 57 57" fill="none">
      <G transform="translate(3.75 3.75)">
        <Path
          d="M10.7241 22.9184C10.5765 21.967 10.4999 20.9924 10.4999 20C10.4999 9.50659 19.0625 1 29.6249 1C40.1874 1 48.7499 9.50659 48.7499 20C48.7499 22.3704 48.313 24.6395 47.5148 26.7319C47.349 27.1665 47.2661 27.3838 47.2284 27.5535C47.1911 27.7216 47.1768 27.8398 47.1727 28.0119C47.1686 28.1857 47.1922 28.377 47.2393 28.7598L48.1954 36.5265C48.2989 37.3673 48.3507 37.7876 48.2108 38.0933C48.0883 38.3611 47.8706 38.5737 47.6001 38.6901C47.2913 38.8228 46.8723 38.7614 46.0341 38.6386L38.4691 37.5297C38.0741 37.4718 37.8766 37.4428 37.6967 37.4438C37.5188 37.4448 37.3956 37.458 37.2215 37.4946C37.0455 37.5316 36.8206 37.6158 36.3708 37.7843C34.273 38.5701 31.9995 39 29.6249 39C28.6317 39 27.6562 38.9248 26.7038 38.7798M14.375 48.5C21.4166 48.5 27.125 42.6517 27.125 35.4375C27.125 28.2233 21.4166 22.375 14.375 22.375C7.33338 22.375 1.62501 28.2233 1.62501 35.4375C1.62501 36.8877 1.85567 38.2826 2.28144 39.586C2.46142 40.1369 2.55141 40.4124 2.58095 40.6006C2.61178 40.7971 2.61719 40.9074 2.6057 41.106C2.5947 41.2961 2.54712 41.5111 2.45196 41.941L1.00001 48.5L8.11267 47.5286C8.50089 47.4756 8.69501 47.4491 8.86451 47.4502C9.043 47.4514 9.13773 47.4611 9.31277 47.496C9.47901 47.5292 9.72614 47.6164 10.2204 47.7908C11.5227 48.2504 12.9204 48.5 14.375 48.5Z"
          stroke={TEXT}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
      {/* Big bubble (upper right) */}
      <Circle cx={25.5} cy={24} r={2} fill={DOT} />
      <Circle cx={33.5} cy={24} r={2} fill={DOT} />
      <Circle cx={41.5} cy={24} r={2} fill={DOT} />
      {/* Small bubble (lower left) */}
      <Circle cx={11} cy={39} r={2} fill={DOT} />
      <Circle cx={18} cy={39} r={2} fill={DOT} />
      <Circle cx={25} cy={39} r={2} fill={DOT} />
    </Svg>
  );
}

export default function NoConversationsEmptyState() {
  return (
    <View style={styles.container}>
      <MessageChatCircleIcon />
      <View style={styles.copy}>
        <Text style={styles.title}>No conversations yet</Text>
        <Text style={styles.body}>
          Start connecting with surfers for your next trip.{'\n'}
          Tap Swelly to get matched.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 16,
    paddingTop: 40,
    paddingHorizontal: 30,
    paddingBottom: 24,
  },
  copy: {
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
  },
  title: {
    // Headings/M H-5
    fontFamily: ff('Montserrat', '700'),
    fontSize: fs(18),
    lineHeight: 24,
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
});
