/**
 * WhatsApp-style review screen for a MULTI-select gallery pick (≥2 items).
 *
 * One fullscreen pager over the picked photos/videos, a per-item caption bar,
 * a thumbnail filmstrip in selection order, and a send FAB with a count badge.
 * Single-item picks never come here — they keep the shipped ImagePreviewModal /
 * VideoPreviewModal flow — so this component owns the batch UX end to end:
 * deletes (trash), per-photo crop (via the host's cropImage helper), and
 * per-item captions keyed by uri (a crop carries the caption to the new uri).
 *
 * Send hands the ordered items back to the host, which loops them through the
 * existing upload-first handleImageSend/handleVideoSend — this component never
 * touches the pipeline.
 *
 * Videos: only the ACTIVE page mounts a live player (one useVideoPlayer at a
 * time — swiping away unmounts and releases it); inactive video pages show a
 * generated poster. Poster generation uses expo-video-thumbnails, which is not
 * linked in Expo Go — guarded like videoUploadService, falling back to a dark
 * tile with a ▶ glyph.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Image,
  Text,
  TextInput,
  StyleSheet,
  Platform,
  FlatList,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ff } from '../theme/fonts';

export interface MediaReviewItem {
  uri: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  /** Seconds (hosts convert the picker's milliseconds at the boundary). */
  duration?: number;
  mimeType?: string;
  fileSize?: number;
}

interface MediaReviewModalProps {
  visible: boolean;
  items: MediaReviewItem[];
  onSend: (items: Array<MediaReviewItem & { caption?: string }>) => void;
  onCancel: () => void;
  /** Host's existing cropImage helper (photos only; absent → no crop button). */
  onCropImage?: (
    uri: string,
    width: number,
    height: number,
  ) => Promise<{ uri: string; width: number; height: number } | null>;
  primaryColor?: string;
}

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const TrashIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Pencil — same "edit/crop" affordance as ImagePreviewContent.
const CropIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const SendIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="#FFFFFF" />
  </Svg>
);

const PlayIcon = ({ size = 56 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.5-6.86a1.03 1.03 0 0 0 0-1.76L9.56 4.26A1.03 1.03 0 0 0 8 5.14z" fill="#FFFFFF" />
  </Svg>
);

/**
 * The one live player. Mounted only for the active page, so swiping away
 * unmounts it and releases the player (mirrors VideoPreviewContent's
 * playingChange wiring). Starts paused, tap toggles.
 */
const ActiveVideoPage: React.FC<{ uri: string }> = ({ uri }) => {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.audioMixingMode = 'mixWithOthers';
  });
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying: next }) => {
      setIsPlaying(next);
    });
    setIsPlaying(player.playing);
    return () => sub.remove();
  }, [player]);

  const toggle = () => {
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch {}
  };

  return (
    <View style={styles.flex}>
      <VideoView player={player} style={styles.media} contentFit="contain" nativeControls={false} />
      {/* Absolute-fill tap target ABOVE the VideoView so the toggle can't be
          swallowed by the native view. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={toggle} />
      {!isPlaying && (
        <View style={styles.playOverlay} pointerEvents="none">
          <PlayIcon size={64} />
        </View>
      )}
    </View>
  );
};

export const MediaReviewModal: React.FC<MediaReviewModalProps> = ({
  visible,
  items: initialItems,
  onSend,
  onCancel,
  onCropImage,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Local working copy — deletes and crop swaps stay local until Send.
  const [items, setItems] = useState<MediaReviewItem[]>(initialItems);
  const [activeIndex, setActiveIndex] = useState(0);
  // Captions keyed by uri (stable across reorders/deletes; crop migrates the key).
  const [captions, setCaptions] = useState<Record<string, string>>({});
  // Poster thumbs for video items (filmstrip + inactive pages).
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const requestedThumbsRef = useRef<Set<string>>(new Set());

  const pagerRef = useRef<FlatList<MediaReviewItem>>(null);

  // Same synchronous re-entrancy guard as ImagePreviewContent: onSend is async
  // on the host side, so the FAB stays live long enough for a double-tap to
  // dispatch the whole batch twice without this.
  const sendingRef = useRef(false);

  // Reset per open. Hosts mount this conditionally, so this mostly runs once
  // on mount — but a re-open with recycled state must start clean.
  useEffect(() => {
    if (visible) {
      setItems(initialItems);
      setCaptions({});
      setActiveIndex(0);
      sendingRef.current = false;
    }
  }, [visible, initialItems]);

  // Generate video posters lazily. expo-video-thumbnails is not linked in Expo
  // Go — require() there trips the global handler even inside try/catch, so
  // gate on isExpoGo first (same pattern as videoUploadService).
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        const { isExpoGo } = require('../utils/keyboardAvoidingView');
        if (isExpoGo) return;
        const VideoThumbnails = require('expo-video-thumbnails');
        for (const it of items) {
          if (!it.isVideo || requestedThumbsRef.current.has(it.uri)) continue;
          requestedThumbsRef.current.add(it.uri);
          try {
            const { uri } = await VideoThumbnails.getThumbnailAsync(it.uri, {
              time: 0,
              quality: 0.6,
            });
            if (!alive) return;
            setVideoThumbs((prev) => ({ ...prev, [it.uri]: uri }));
          } catch {
            // Poster stays absent → dark tile with ▶.
          }
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [visible, items]);

  const jumpTo = (index: number, animated = true) => {
    setActiveIndex(index);
    pagerRef.current?.scrollToOffset({ offset: index * width, animated });
  };

  const removeCurrent = () => {
    const next = items.filter((_, i) => i !== activeIndex);
    if (next.length === 0) {
      onCancel();
      return;
    }
    const newIndex = Math.min(activeIndex, next.length - 1);
    setItems(next);
    setActiveIndex(newIndex);
    // Snap without animation once the shorter list has laid out.
    requestAnimationFrame(() => {
      pagerRef.current?.scrollToOffset({ offset: newIndex * width, animated: false });
    });
  };

  const handleCrop = async () => {
    const item = items[activeIndex];
    if (!item || item.isVideo || !onCropImage) return;
    const result = await onCropImage(item.uri, item.width ?? 0, item.height ?? 0);
    if (!result) return; // cancel / cropper missing — item unchanged
    // Carry the caption to the new uri key before swapping the item.
    setCaptions((prev) => {
      const caption = prev[item.uri];
      if (caption == null) return prev;
      const { [item.uri]: _removed, ...rest } = prev;
      return { ...rest, [result.uri]: caption };
    });
    setItems((prev) =>
      prev.map((it, i) =>
        i === activeIndex
          ? { ...it, uri: result.uri, width: result.width, height: result.height }
          : it,
      ),
    );
  };

  const handleSend = () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    onSend(
      items.map((it) => ({ ...it, caption: captions[it.uri]?.trim() || undefined })),
    );
  };

  const activeItem = items[activeIndex];

  const renderPage = ({ item, index }: { item: MediaReviewItem; index: number }) => (
    <View style={{ width, height: '100%' }}>
      {item.isVideo ? (
        index === activeIndex ? (
          <ActiveVideoPage uri={item.uri} />
        ) : (
          <View style={styles.flex}>
            {videoThumbs[item.uri] ? (
              <Image source={{ uri: videoThumbs[item.uri] }} style={styles.media} resizeMode="contain" />
            ) : (
              <View style={[styles.media, styles.posterFallback]} />
            )}
            <View style={styles.playOverlay} pointerEvents="none">
              <PlayIcon size={64} />
            </View>
          </View>
        )
      ) : (
        <Image source={{ uri: item.uri }} style={styles.media} resizeMode="contain" />
      )}
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.container}>
        <FlatList
          ref={pagerRef}
          data={items}
          renderItem={renderPage}
          keyExtractor={(it) => it.uri}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={(e) => {
            const index = Math.round(e.nativeEvent.contentOffset.x / width);
            if (index !== activeIndex && index >= 0 && index < items.length) {
              setActiveIndex(index);
            }
          }}
          extraData={`${activeIndex}-${Object.keys(videoThumbs).length}`}
          style={styles.flex}
        />

        {/* Bottom chrome — caption for the CURRENT item, filmstrip, send FAB.
            Same KAV pattern as ImagePreviewContent (padding on iOS only). */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.chromeFill}
          pointerEvents="box-none"
        >
          <View style={[styles.bottomChrome, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TextInput
              style={styles.captionInput}
              value={activeItem ? (captions[activeItem.uri] ?? '') : ''}
              onChangeText={(text) => {
                if (!activeItem) return;
                const key = activeItem.uri;
                setCaptions((prev) => ({ ...prev, [key]: text }));
              }}
              placeholder="Add a caption..."
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              maxLength={500}
              multiline
            />
            <View style={styles.stripRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.flex}
                contentContainerStyle={styles.stripContent}
                keyboardShouldPersistTaps="handled"
              >
                {items.map((it, i) => (
                  <Pressable
                    key={it.uri}
                    onPress={() => jumpTo(i)}
                    style={[
                      styles.thumb,
                      i === activeIndex && { borderColor: primaryColor, borderWidth: 2 },
                    ]}
                  >
                    {it.isVideo ? (
                      videoThumbs[it.uri] ? (
                        <Image source={{ uri: videoThumbs[it.uri] }} style={styles.thumbImage} />
                      ) : (
                        <View style={[styles.thumbImage, styles.posterFallback]} />
                      )
                    ) : (
                      <Image source={{ uri: it.uri }} style={styles.thumbImage} />
                    )}
                    {it.isVideo && (
                      <View style={styles.thumbPlayOverlay} pointerEvents="none">
                        <PlayIcon size={18} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable
                style={[styles.sendFab, { backgroundColor: primaryColor }]}
                onPress={handleSend}
                accessibilityRole="button"
                accessibilityLabel={`Send ${items.length} items`}
              >
                <SendIcon />
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{items.length}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Top chrome */}
        <View style={[styles.iconButton, styles.closeButton, { top: insets.top + 12 }]}>
          <Pressable
            style={styles.iconFill}
            onPress={onCancel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Discard all"
          >
            <CloseIcon />
          </Pressable>
        </View>
        <View style={[styles.topRightRow, { top: insets.top + 12 }]}>
          {activeItem && !activeItem.isVideo && onCropImage && (
            <View style={styles.iconButton}>
              <Pressable
                style={styles.iconFill}
                onPress={() => void handleCrop()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Edit photo"
              >
                <CropIcon />
              </Pressable>
            </View>
          )}
          <View style={styles.iconButton}>
            <Pressable
              style={styles.iconFill}
              onPress={removeCurrent}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Remove this item"
            >
              <TrashIcon />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const THUMB_SIZE = 52;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    backgroundColor: '#1A1A1A',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chromeFill: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  bottomChrome: {
    paddingHorizontal: 8,
    gap: 8,
  },
  captionInput: {
    backgroundColor: '#2B2B2B',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    color: '#FFFFFF',
    fontFamily: ff('Inter'),
    fontSize: 16,
    maxHeight: 100,
  },
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stripContent: {
    gap: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  sendFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    // Nudge the send glyph's visual center (it leans left in its viewBox).
    paddingLeft: 3,
  },
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 12,
    color: '#111111',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
  },
  iconFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  topRightRow: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    gap: 10,
  },
});
