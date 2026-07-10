/**
 * WhatsApp-style album bubble: a 2×2 grid over 4+ consecutive captionless
 * media messages from one sender (grouping decided by utils/mediaAlbums).
 *
 * The grid shows the first 4 items in send order (oldest = top-left). With
 * more than 4, the 4th tile gets a dark "+N" scrim that opens the host's
 * AlbumGridModal. Every tile keeps its message's own affordances: tap opens
 * the fullscreen viewer, long-press opens the per-message menu, and the
 * upload-first pipeline's states render per tile (spinner while uploading,
 * alert scrim + tap-to-retry on failure).
 *
 * The host supplies the time label and ReadReceipt node (they own
 * getReceiptState and formatTime) plus all message-level callbacks — this
 * component is purely presentational over Message rows.
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  GestureResponderEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '../services/messaging/messagingService';
import { ff } from '../theme/fonts';

interface MediaAlbumBubbleProps {
  /** Chronological (oldest first), length ≥ 4. */
  items: Message[];
  onPressItem: (message: Message) => void;
  onLongPressItem: (message: Message, event: GestureResponderEvent) => void;
  onRetryItem: (message: Message) => void;
  /** Tap on the "+N" scrim tile. */
  onPressMore: () => void;
  timeLabel: string;
  /** Host-rendered ReadReceipt for the album's newest item (own sends only). */
  receipt?: React.ReactNode;
}

const isVideoMessage = (m: Message): boolean => m.type === 'video' || !!m.video_metadata;

/** Bubble-grade thumbnail for a tile — same fallbacks as the single bubbles. */
export const albumTileUri = (m: Message): string => {
  if (isVideoMessage(m)) {
    return m.video_metadata?.thumbnail_url || m._localPreviewUri || '';
  }
  return (
    m.image_metadata?.thumbnail_url || m.image_metadata?.image_url || m._localPreviewUri || ''
  );
};

/**
 * One tile — shared with AlbumGridModal so the +N expansion renders media,
 * upload states, and interactions identically.
 */
export const AlbumTile: React.FC<{
  message: Message;
  size: number;
  onPress: (m: Message) => void;
  onLongPress: (m: Message, e: GestureResponderEvent) => void;
  onRetry: (m: Message) => void;
  /** Overrides the tap (the album's "+N" tile). */
  onPressOverride?: () => void;
  moreCount?: number;
  borderRadius?: number;
}> = ({ message, size, onPress, onLongPress, onRetry, onPressOverride, moreCount, borderRadius = 4 }) => {
  const uri = albumTileUri(message);
  const isVideo = isVideoMessage(message);
  const uploading = message.upload_state === 'uploading';
  const failed = message.upload_state === 'failed';
  const showMore = !!moreCount && moreCount > 0;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={{ width: size, height: size, borderRadius, overflow: 'hidden', backgroundColor: '#1a1a1a' }}
      onPress={() => {
        if (failed) {
          onRetry(message);
          return;
        }
        if (uploading) return;
        if (showMore && onPressOverride) {
          onPressOverride();
          return;
        }
        onPress(message);
      }}
      onLongPress={(e) => onLongPress(message, e)}
    >
      {!!uri && (
        <ExpoImage
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      )}
      {isVideo && !uploading && !failed && !showMore && (
        <View style={styles.tileCenterOverlay} pointerEvents="none">
          <Ionicons name="play-circle" size={Math.min(40, size * 0.4)} color="rgba(255,255,255,0.9)" />
        </View>
      )}
      {uploading && (
        <View style={[styles.tileCenterOverlay, styles.tileScrim]} pointerEvents="none">
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      )}
      {failed && (
        <View style={[styles.tileCenterOverlay, styles.tileScrim]} pointerEvents="none">
          <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
          <Text style={styles.tileRetryText}>Retry</Text>
        </View>
      )}
      {showMore && (
        <View style={[styles.tileCenterOverlay, styles.moreScrim]} pointerEvents="none">
          <Text style={styles.moreText}>+{moreCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// Mirrors the host screens' bubble sizing: MESSAGE_BUBBLE_MAX_WIDTH there is
// `screenWidth - 106`, and the caller wraps this component in the same
// mediaFrameBubble 3px-per-side inset (imageMessageBubble also sets
// overflow:hidden on that wrapper). Subtracting both here keeps the grid from
// ever exceeding the bubble's own max width — which would silently clip the
// rightmost tile column instead of erroring. Capped at 300 on large phones.
const GRID_WIDTH = Math.min(Dimensions.get('window').width - 106 - 6, 300);
const TILE_GAP = 2;
const TILE_SIZE = (GRID_WIDTH - TILE_GAP) / 2;

export const MediaAlbumBubble: React.FC<MediaAlbumBubbleProps> = ({
  items,
  onPressItem,
  onLongPressItem,
  onRetryItem,
  onPressMore,
  timeLabel,
  receipt,
}) => {
  const visible = items.slice(0, 4);
  const moreCount = items.length - 4;

  return (
    <View style={styles.bubble}>
      <View style={styles.grid}>
        {visible.map((m, i) => (
          <AlbumTile
            key={m.client_id || m.id}
            message={m}
            size={TILE_SIZE}
            onPress={onPressItem}
            onLongPress={onLongPressItem}
            onRetry={onRetryItem}
            onPressOverride={i === 3 && moreCount > 0 ? onPressMore : undefined}
            moreCount={i === 3 ? moreCount : 0}
            borderRadius={4}
          />
        ))}
      </View>
      {/* Time + ticks pill, bottom-right over the grid — same treatment as the
          captionless image bubble's timestamp overlay. */}
      <View style={styles.timestampPill} pointerEvents="none">
        <Text style={styles.timestampText}>{timeLabel}</Text>
        {receipt}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bubble: {
    width: GRID_WIDTH,
    borderRadius: 13,
    overflow: 'hidden',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
  },
  tileCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  moreScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  moreText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 34,
    color: '#FFFFFF',
  },
  tileRetryText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 11,
    color: '#FFFFFF',
    marginTop: 2,
  },
  timestampPill: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    gap: 3,
  },
  timestampText: {
    fontFamily: ff('Inter'),
    fontSize: 11,
    color: '#FFFFFF',
  },
});
