/**
 * AudioMessageBubble
 *
 * Self-contained voice-message bubble. Renders a play/pause button, waveform
 * progress, and duration. Subscribes to the global audioPlaybackService so
 * starting a new bubble automatically pauses any other voice message currently
 * playing.
 *
 * Rendered by both DirectMessageScreen and DirectGroupChat for messages with
 * type === 'audio'.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../styles/theme';
import { audioPlaybackService, PlaybackState } from '../services/messaging/audioPlaybackService';
import type { Message } from '../services/messaging/messagingService';

const MAX_BAR_COUNT = 50;
const BAR_WIDTH = 2;
const BAR_GAP = 2;
// Horizontal chrome inside the audio container: paddingH (20) + play button (36) +
// play marginRight (8) + time marginLeft (12) + time minWidth (32).
const CHROME_WIDTH = 108;
const BUBBLE_IDEAL_WIDTH = MAX_BAR_COUNT * (BAR_WIDTH + BAR_GAP) + CHROME_WIDTH; // ~308
// Must stay in sync with MESSAGE_BUBBLE_MAX_WIDTH in the chat screens (window.width - 106).
// Otherwise the audio container's fixed width overflows the bubble's maxWidth and gets clipped
// by `overflow: 'hidden'` on imageMessageBubble.
const BUBBLE_WIDTH = Math.min(BUBBLE_IDEAL_WIDTH, Dimensions.get('window').width - 106);
// Waveform-area width depends on the bubble width above; downsample bars to fit it
// so they don't overflow into the time text on narrow screens.
const BAR_COUNT = Math.max(
  20,
  Math.min(MAX_BAR_COUNT, Math.floor((BUBBLE_WIDTH - CHROME_WIDTH) / (BAR_WIDTH + BAR_GAP)))
);
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 22;

interface AudioMessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onLongPress?: (event: GestureResponderEvent) => void;
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const AudioMessageBubble: React.FC<AudioMessageBubbleProps> = ({
  message,
  isOwn,
  onLongPress,
}) => {
  const { id, audio_metadata, upload_state, _localPreviewUri } = message;
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    isLoading: false,
    positionMs: 0,
    durationMs: 0,
  });
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    const unsubscribe = audioPlaybackService.subscribe(id, (state) => {
      if (!isMountedRef.current) return;
      setPlayback(state);
    });
    return unsubscribe;
  }, [id]);

  const isUploading = upload_state === 'uploading';
  const isFailed = upload_state === 'failed';

  // Source for playback: prefer the uploaded URL; fall back to local file
  // while the optimistic message is still uploading so the sender can hear it.
  const playUrl = audio_metadata?.audio_url || _localPreviewUri || '';

  // Warm the cache as soon as the bubble mounts so tapping play is instant.
  useEffect(() => {
    if (!playUrl || isUploading) return;
    audioPlaybackService.preload(id, playUrl);
  }, [id, playUrl, isUploading]);

  const waveform: number[] = useMemo(() => {
    const samples = audio_metadata?.waveform;
    const source = (samples && samples.length > 0) ? samples : new Array(MAX_BAR_COUNT).fill(0.3);
    if (source.length <= BAR_COUNT) return source;
    // Downsample so bars never overflow the waveform area on narrow screens.
    const out: number[] = new Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      out[i] = source[Math.floor((i / BAR_COUNT) * source.length)];
    }
    return out;
  }, [audio_metadata?.waveform]);

  const totalDurationMs = audio_metadata?.duration_ms ?? playback.durationMs ?? 0;
  const progressMs = playback.isPlaying ? playback.positionMs : 0;
  const progressFraction = totalDurationMs > 0 ? progressMs / totalDurationMs : 0;
  const playedBarIndex = Math.floor(progressFraction * waveform.length);

  const displayMs = playback.isPlaying
    ? Math.max(0, totalDurationMs - playback.positionMs)
    : totalDurationMs;

  const handlePlayPress = () => {
    if (!playUrl) return;
    if (audioPlaybackService.isActive(id) && playback.isPlaying) {
      audioPlaybackService.pause(id);
    } else {
      audioPlaybackService.play(id, playUrl);
    }
  };

  const renderLeftButton = () => {
    if (isUploading || playback.isLoading) {
      return <ActivityIndicator size="small" color="#FFFFFF" />;
    }
    if (isFailed) {
      return <Ionicons name="alert-circle" size={28} color="#E74C3C" />;
    }
    const iconName = playback.isPlaying ? 'pause' : 'play';
    return (
      <Ionicons
        name={iconName}
        size={20}
        color="#FFFFFF"
        style={!playback.isPlaying ? { marginLeft: 2 } : undefined}
      />
    );
  };

  // Both own and other chat bubbles in Swellyo are white, so we don't theme
  // the audio content per side — accent everything in brand teal. The outer
  // bubble's asymmetric corners + position handle own/other visual distinction.
  const playButtonBg = colors.brandTeal;
  const playedColor = colors.brandTeal;
  const unplayedColor = 'rgba(0,0,0,0.22)';
  const timeColor = colors.textSecondary;

  return (
    <Pressable
      onLongPress={(e) => onLongPress?.(e)}
      delayLongPress={350}
    >
      <View style={styles.container}>
        <TouchableOpacity
          style={[styles.playButton, { backgroundColor: playButtonBg }]}
          onPress={handlePlayPress}
          disabled={isUploading || !playUrl}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {renderLeftButton()}
        </TouchableOpacity>

        <View style={styles.waveform}>
          {waveform.map((sample, i) => {
            const height = MIN_BAR_HEIGHT + sample * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
            const color = i < playedBarIndex ? playedColor : unplayedColor;
            return (
              <View
                key={i}
                style={{
                  width: BAR_WIDTH,
                  height,
                  marginRight: i === waveform.length - 1 ? 0 : BAR_GAP,
                  backgroundColor: color,
                  borderRadius: BAR_WIDTH / 2,
                }}
              />
            );
          })}
        </View>

        <Text style={[styles.time, { color: timeColor }]}>{formatTime(displayMs)}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    width: BUBBLE_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR_HEIGHT + 2,
  },
  time: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 12,
    minWidth: 32,
    textAlign: 'right',
  },
});
