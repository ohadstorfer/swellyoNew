/**
 * LockedRecordingBar
 *
 * Replaces the composer when a voice recording has been locked (user slid up
 * past the lock threshold). The recorder keeps running hands-free; the user
 * can tap trash to cancel or send to finalize.
 *
 * v1 intentionally omits a pause button — expo-av's Recording.pauseAsync has
 * platform caveats (no-op on older Android) that complicate the state model.
 * Trash + send is the WhatsApp-derived MVP.
 */

import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../styles/theme';

// Bar count is computed at runtime from the measured waveform width so the
// waveform always fills the space between the timer and the send button.
// FALLBACK_BAR_COUNT is only used for the very first render, before the
// onLayout callback fires.
const FALLBACK_BAR_COUNT = 30;
const BAR_WIDTH = 2;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 18;

interface LockedRecordingBarProps {
  durationMs: number;
  liveWaveform: number[];
  primaryColor: string;
  onCancel: () => void;
  onSend: () => void;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

const SendIcon = ({ color = '#FFFFFF' }: { color?: string }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10.4995 13.5001L20.9995 3.00005M10.6271 13.8281L13.2552 20.5861C13.4867 21.1815 13.6025 21.4791 13.7693 21.566C13.9139 21.6414 14.0862 21.6415 14.2308 21.5663C14.3977 21.4796 14.5139 21.1821 14.7461 20.587L21.3364 3.69925C21.5461 3.16207 21.6509 2.89348 21.5935 2.72185C21.5437 2.5728 21.4268 2.45583 21.2777 2.40604C21.1061 2.34871 20.8375 2.45352 20.3003 2.66315L3.41258 9.25349C2.8175 9.48572 2.51997 9.60183 2.43326 9.76873C2.35809 9.91342 2.35819 10.0857 2.43353 10.2303C2.52043 10.3971 2.81811 10.5128 3.41345 10.7444L10.1715 13.3725C10.2923 13.4195 10.3527 13.443 10.4036 13.4793C10.4487 13.5114 10.4881 13.5509 10.5203 13.596C10.5566 13.6468 10.5801 13.7073 10.6271 13.8281Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const LockedRecordingBar: React.FC<LockedRecordingBarProps> = ({
  durationMs,
  liveWaveform,
  primaryColor,
  onCancel,
  onSend,
}) => {
  // Measure the waveform container so the bars fill all available horizontal
  // space (between the timer and the send button). Without this, the bars
  // sit at a fixed FALLBACK count and leave a visible empty gap on wider
  // screens.
  const [waveformWidth, setWaveformWidth] = useState(0);
  const barCount = useMemo(() => {
    if (waveformWidth <= 0) return FALLBACK_BAR_COUNT;
    const fits = Math.floor(waveformWidth / (BAR_WIDTH + BAR_GAP));
    return Math.max(20, fits);
  }, [waveformWidth]);

  // Pad / window the live samples to the computed bar count so the bar width
  // stays stable regardless of how recently recording started.
  const padded: number[] = useMemo(() => {
    if (liveWaveform.length >= barCount) {
      return liveWaveform.slice(liveWaveform.length - barCount);
    }
    const head = new Array(barCount - liveWaveform.length).fill(0);
    return [...head, ...liveWaveform];
  }, [liveWaveform, barCount]);

  return (
    <View style={styles.bar}>
      <TouchableOpacity
        onPress={onCancel}
        style={styles.iconButton}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      >
        <Ionicons name="trash-outline" size={24} color="#E74C3C" />
      </TouchableOpacity>

      <View style={styles.center}>
        <View style={styles.dot} />
        <Text style={styles.timer}>{mmss(durationMs)}</Text>
        <View
          style={styles.waveform}
          onLayout={(e) => {
            const w = Math.floor(e.nativeEvent.layout.width);
            // 1px tolerance to avoid render loops on sub-pixel layout deltas.
            if (Math.abs(w - waveformWidth) >= 1) setWaveformWidth(w);
          }}
        >
          {padded.map((sample, i) => {
            const height =
              MIN_BAR_HEIGHT + sample * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
            return (
              <View
                key={i}
                style={{
                  width: BAR_WIDTH,
                  height,
                  marginRight: i === padded.length - 1 ? 0 : BAR_GAP,
                  backgroundColor: colors.brandTeal,
                  borderRadius: BAR_WIDTH / 2,
                  // Newer bars more opaque — matches the recording overlay.
                  opacity: 0.5 + (i / padded.length) * 0.5,
                }}
              />
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        onPress={onSend}
        style={[styles.sendButton, { backgroundColor: primaryColor }]}
        activeOpacity={0.7}
      >
        <SendIcon color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 48,
  },
  iconButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
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
    minWidth: 36,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR_HEIGHT + 2,
    paddingLeft: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
});
