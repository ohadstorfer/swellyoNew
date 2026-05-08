/**
 * RecordingOverlay — replaces the text input while a voice message is recording.
 * Renders inline (same height/shape as the text field) so the surrounding
 * composer container stays visually stable. The mic button to the right keeps
 * its position; the user can slide left from there to cancel.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../styles/theme';

const LIVE_BAR_COUNT = 30;
const BAR_WIDTH = 2;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 18;

interface RecordingOverlayProps {
  durationMs: number;
  liveWaveform: number[]; // last ~30 normalized samples (0..1)
  isCancelArmed: boolean; // true when user has slid past the cancel threshold
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export const RecordingOverlay: React.FC<RecordingOverlayProps> = ({
  durationMs,
  liveWaveform,
  isCancelArmed,
}) => {
  // Pad waveform to a fixed bar count so width stays stable regardless of
  // how recently recording started.
  const padded: number[] = (() => {
    if (liveWaveform.length >= LIVE_BAR_COUNT) {
      return liveWaveform.slice(liveWaveform.length - LIVE_BAR_COUNT);
    }
    const out = new Array(LIVE_BAR_COUNT - liveWaveform.length).fill(0);
    return [...out, ...liveWaveform];
  })();

  return (
    <View style={[styles.container, isCancelArmed && styles.containerArmed]}>
      <View style={styles.dot} />
      <Text style={styles.timer}>{formatTime(durationMs)}</Text>

      <View style={styles.waveform}>
        {padded.map((sample, i) => {
          const height = MIN_BAR_HEIGHT + sample * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
          return (
            <View
              key={i}
              style={{
                width: BAR_WIDTH,
                height,
                marginRight: i === padded.length - 1 ? 0 : BAR_GAP,
                backgroundColor: isCancelArmed ? '#E74C3C' : colors.brandTeal,
                borderRadius: BAR_WIDTH / 2,
                opacity: 0.5 + (i / padded.length) * 0.5, // newer bars more opaque
              }}
            />
          );
        })}
      </View>

      <View style={styles.hint}>
        <Ionicons
          name={isCancelArmed ? 'trash' : 'chevron-back'}
          size={14}
          color={isCancelArmed ? '#E74C3C' : colors.textSecondary}
        />
        <Text
          style={[
            styles.hintText,
            isCancelArmed && { color: '#E74C3C', fontWeight: '600' },
          ]}
          numberOfLines={1}
        >
          {isCancelArmed ? 'Release to cancel' : 'Slide to cancel'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: 40,
  },
  containerArmed: {
    opacity: 0.85,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E74C3C',
    marginRight: 8,
  },
  timer: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    minWidth: 40,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: MAX_BAR_HEIGHT + 2,
    paddingHorizontal: 8,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hintText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 2,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
});
