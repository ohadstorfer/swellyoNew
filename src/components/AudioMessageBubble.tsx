/**
 * AudioMessageBubble
 *
 * Self-contained voice-message bubble (WhatsApp-style). Renders, per row:
 *   row 1: [inner-side avatar] play/pause · waveform progress
 *   row 2: duration (under the waveform start) · clock time + receipt (right)
 *
 * The avatar sits on the bubble's INNER side (own → left, received → right)
 * with a small mic badge, vertically centered on the waveform row. Subscribes
 * to the global audioPlaybackService so starting a new bubble auto-pauses any
 * other voice message currently playing.
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
import { ProfileImage } from './ProfileImage';
import { colors } from '../styles/theme';
import { audioPlaybackService, PlaybackState } from '../services/messaging/audioPlaybackService';
import type { Message } from '../services/messaging/messagingService';

const MAX_BAR_COUNT = 50;
const BAR_WIDTH = 2;
const BAR_GAP = 2;
const AVATAR_SIZE = 44;
const AVATAR_MARGIN = 8;
const PLAY_SIZE = 36;
const PLAY_MARGIN = 8;
// Duration on row 2 sits exactly under the waveform start (i.e. after the play
// button), so this is the play button's footprint.
const WAVEFORM_INSET = PLAY_SIZE + PLAY_MARGIN;
// Horizontal chrome inside the audio container that is NOT waveform:
// paddingH (20) + avatar (44) + avatar margin (8) + play button (36) + play margin (8).
const CHROME_WIDTH = 20 + AVATAR_SIZE + AVATAR_MARGIN + PLAY_SIZE + PLAY_MARGIN;
const BUBBLE_IDEAL_WIDTH = MAX_BAR_COUNT * (BAR_WIDTH + BAR_GAP) + CHROME_WIDTH;
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
  /** Resolved avatar URL for the sender (own → current user, received → sender). */
  avatarUrl?: string | null;
  /** Sender display name — drives the initials placeholder when no avatar. */
  senderName?: string;
  /** Pre-formatted clock time (e.g. "14:22") shown bottom-right, like normal messages. */
  timeText?: string;
  /** Read-receipt node (own messages only); rendered next to the clock time. */
  receipt?: React.ReactNode;
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
  avatarUrl,
  senderName,
  timeText,
  receipt,
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

  // NOTE: intentionally NO eager preload on mount. Previously the bubble called
  // audioPlaybackService.preload(id, playUrl) here, which downloaded the full
  // audio for every bubble that scrolled into the FlatList window even if never
  // played — a major egress source. `play()` already loads on demand (cached →
  // in-flight → load-now) and shows a brief spinner on the first tap, so first
  // play is still correct and every later play is instant from the LRU cache.

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
  // Use positionMs directly so the played bars + countdown STAY where you paused.
  // The service preserves positionMs on pause and resets it to 0 on finish/idle,
  // so this is correct for all states (idle 0, playing ticking, paused held).
  const progressMs = playback.positionMs;
  const progressFraction = totalDurationMs > 0 ? progressMs / totalDurationMs : 0;
  const playedBarIndex = Math.floor(progressFraction * waveform.length);

  const displayMs = progressMs > 0
    ? Math.max(0, totalDurationMs - progressMs)
    : totalDurationMs;

  const handlePlayPress = () => {
    if (!playUrl) return;
    if (audioPlaybackService.isActive(id) && playback.isPlaying) {
      audioPlaybackService.pause(id);
    } else {
      audioPlaybackService.play(id, playUrl);
    }
  };

  // Theme per side so the waveform/time stay legible on the celeste (own) vs
  // white (received) outer bubble. No filled play-button circle (WhatsApp-style)
  // — just the triangle. Own: bright white waveform + icon on celeste.
  // Own: played bars paint DARK GRAY against the white unplayed bars so playback
  // progress is clearly visible (pure white vs 85% white read as the same color).
  const accentColor = isOwn ? '#3A3A3A' : colors.brandTeal;            // played bars
  const unplayedColor = isOwn ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.22)';
  const iconColor = isOwn ? '#FFFFFF' : 'rgba(0,0,0,0.45)';            // play/pause glyph
  const metaColor = isOwn ? 'rgba(255,255,255,0.85)' : 'rgba(60,60,60,0.75)';

  const renderPlayIcon = () => {
    if (isUploading || playback.isLoading) {
      return <ActivityIndicator size="small" color={iconColor} />;
    }
    if (isFailed) {
      return <Ionicons name="alert-circle" size={28} color="#E74C3C" />;
    }
    const iconName = playback.isPlaying ? 'pause' : 'play';
    return (
      <Ionicons
        name={iconName}
        size={26}
        color={iconColor}
        style={!playback.isPlaying ? { marginLeft: 1 } : undefined}
      />
    );
  };

  // Avatar with a mic badge on the side that faces the waveform (own → badge
  // bottom-right, received → bottom-left). Vertically centered on the waveform
  // row via a negative top margin (the play button defines that row's height).
  const renderAvatar = () => (
    <View
      style={[
        styles.avatarWrap,
        // Own: inherit the container's center alignment (centered on the whole
        // bubble). Received: pin to the top and nudge up so the avatar centers on
        // the waveform row instead (the play button defines that row's height).
        // Both sides: inherit the container's center alignment and cancel the
        // asymmetric padding (8 top / 2 bottom) with marginBottom so the avatar
        // is centered on the FULL bubble. Received mirrors sent, flipped side.
        isOwn
          ? { marginRight: AVATAR_MARGIN, marginBottom: 6 }
          : { marginLeft: AVATAR_MARGIN, marginBottom: 6 },
      ]}
    >
      <ProfileImage
        imageUrl={avatarUrl || undefined}
        name={senderName || 'User'}
        style={styles.avatar}
        showOnlineIndicator={false}
      />
      <View style={[styles.micBadge, isOwn ? { right: -2 } : { left: -2 }]}>
        <Ionicons name="mic" size={10} color={colors.brandTeal} />
      </View>
    </View>
  );

  return (
    <Pressable
      onLongPress={(e) => onLongPress?.(e)}
      delayLongPress={350}
    >
      <View style={[styles.container, isOwn ? styles.containerOwn : styles.containerReceived]}>
        {isOwn && renderAvatar()}

        <View style={styles.column}>
          <View style={styles.topRow}>
            <TouchableOpacity
              style={styles.playButton}
              onPress={handlePlayPress}
              disabled={isUploading || !playUrl}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {renderPlayIcon()}
            </TouchableOpacity>

            <View style={styles.waveform}>
              {waveform.map((sample, i) => {
                const height = MIN_BAR_HEIGHT + sample * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
                const color = i < playedBarIndex ? accentColor : unplayedColor;
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
          </View>

          <View style={[styles.bottomRow, isOwn && styles.bottomRowOwn]}>
            <Text style={[styles.duration, { color: metaColor }]}>{formatTime(displayMs)}</Text>
            <View style={styles.metaRight}>
              {!!timeText && <Text style={[styles.time, { color: metaColor }]}>{timeText}</Text>}
              {receipt}
            </View>
          </View>
        </View>

        {!isOwn && renderAvatar()}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    width: BUBBLE_WIDTH,
    flexDirection: 'row',
    // Center the avatar vertically within the whole bubble (both rows).
    alignItems: 'center',
    // Tight vertical padding so the sender name (above) and the time/duration
    // (below) sit close to the waveform.
    paddingVertical: 3,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
  },
  // Sent bubbles: a bit more breathing room above the waveform, tighter below.
  containerOwn: {
    paddingTop: 8,
    paddingBottom: 2,
  },
  // Received bubbles: mirror the sent bubble's vertical rhythm exactly so the
  // avatar centers in the full card and its top isn't clipped by overflow:hidden.
  containerReceived: {
    paddingTop: 8,
    paddingBottom: 2,
  },
  column: {
    flex: 1,
    flexDirection: 'column',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playButton: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: PLAY_MARGIN,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR_HEIGHT + 2,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Push the duration to start under the waveform (past the play button).
    paddingLeft: WAVEFORM_INSET,
    marginTop: 0,
  },
  // Sent bubbles: pull the duration/time row up tighter under the waveform.
  bottomRowOwn: {
    marginTop: -3,
  },
  duration: {
    fontSize: 12,
    fontWeight: '500',
  },
  metaRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  time: {
    fontSize: 13,
    fontWeight: '300',
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  micBadge: {
    position: 'absolute',
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
});
