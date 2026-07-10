/**
 * Horizontal filmstrip of the most recent gallery photos/videos, WhatsApp-style,
 * shown above the shutter inside ChatCameraModal.
 *
 * Knows nothing about the camera: its only output is `onSelect(asset)` with a
 * uri the upload pipeline can actually read. iOS MediaLibrary uris are `ph://`
 * asset references — useless to fetch/upload — so selection resolves the real
 * file path via getAssetInfoAsync().localUri before calling out.
 *
 * Gallery permission is optional by design: when missing, the strip renders a
 * single "allow access" tile instead. Denying photos must never break the camera.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { ff, fs } from '../theme/fonts';

export interface GalleryAsset {
  uri: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  /** seconds, video only */
  duration?: number;
}

/** Window-space rectangle of a tapped thumbnail, used to grow it to fullscreen. */
export interface StripFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecentMediaStripProps {
  /**
   * Fires the instant a thumbnail is tapped — synchronously, so the caller can
   * start the grow animation without waiting on the gallery. `displayUri` is the
   * thumbnail's own uri (safe to render immediately); `asset` resolves the real
   * uploadable file path in the background. The caller awaits `asset` before it
   * actually routes the pick downstream.
   */
  onSelect: (
    displayUri: string,
    frame: StripFrame,
    isVideo: boolean,
    asset: Promise<GalleryAsset>
  ) => void;
}

const ITEM_SIZE = 76;
const PAGE_SIZE = 30;

const GalleryPermissionIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Rect x={3} y={3} width={18} height={18} rx={2} stroke="#fff" strokeWidth={1.5} />
    <Circle cx={8.5} cy={8.5} r={1.5} stroke="#fff" strokeWidth={1.5} />
    <Path d="M21 15l-5-5L5 21" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

function formatDuration(seconds?: number): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A single filmstrip tile. Owns its own ref so it can report its exact
 * window-space frame on tap — the anchor the camera modal grows from. Kept as a
 * separate component because measuring needs a per-item ref, which a recycled
 * FlatList renderItem can't hold.
 */
const StripThumb = React.memo(function StripThumb({
  item,
  onPick,
}: {
  item: MediaLibrary.Asset;
  onPick: (item: MediaLibrary.Asset, frame: StripFrame) => void;
}) {
  const ref = useRef<View>(null);
  const isVideo = item.mediaType === MediaLibrary.MediaType.video;

  const handlePress = useCallback(() => {
    const node = ref.current;
    if (!node) {
      onPick(item, { x: 0, y: 0, width: ITEM_SIZE, height: ITEM_SIZE });
      return;
    }
    // measureInWindow is async; the tile is transform-free (only an opacity
    // press state) so the origin it reports is trustworthy.
    node.measureInWindow((x, y, width, height) => {
      onPick(item, {
        x,
        y,
        width: width || ITEM_SIZE,
        height: height || ITEM_SIZE,
      });
    });
  }, [item, onPick]);

  return (
    <Pressable
      ref={ref}
      style={({ pressed }) => [styles.thumbWrap, pressed && styles.pressed]}
      onPress={handlePress}
      accessibilityRole="imagebutton"
    >
      <Image
        source={{ uri: item.uri }}
        style={styles.thumb}
        contentFit="cover"
        recyclingKey={item.id}
        transition={80}
      />
      {isVideo && (
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
        </View>
      )}
    </Pressable>
  );
});

// Memoized: the camera modal re-renders once per second while recording (the
// timer readout), and this FlatList of thumbnails must not re-render with it.
export const RecentMediaStrip = React.memo(function RecentMediaStrip({
  onSelect,
}: RecentMediaStripProps) {
  const [permission, requestPermission] = MediaLibrary.usePermissions({
    granularPermissions: ['photo', 'video'],
  });
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const endCursorRef = useRef<string | undefined>(undefined);
  const hasNextRef = useRef(true);
  const loadingRef = useRef(false);
  // Guards double-taps while getAssetInfoAsync resolves the real file uri.
  const selectingRef = useRef(false);

  const loadPage = useCallback(async () => {
    if (loadingRef.current || !hasNextRef.current) return;
    loadingRef.current = true;
    try {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        first: PAGE_SIZE,
        after: endCursorRef.current,
      });
      endCursorRef.current = page.endCursor;
      hasNextRef.current = page.hasNextPage;
      setAssets(prev => [...prev, ...page.assets]);
    } catch (error) {
      console.warn('[RecentMediaStrip] failed to load gallery page:', error);
      hasNextRef.current = false;
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (permission?.granted) void loadPage();
  }, [permission?.granted, loadPage]);

  const handleAllowAccess = useCallback(() => {
    if (permission && !permission.canAskAgain) {
      void Linking.openSettings();
    } else {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const handlePick = useCallback(
    (asset: MediaLibrary.Asset, frame: StripFrame) => {
      if (selectingRef.current) return;
      selectingRef.current = true;
      const isVideo = asset.mediaType === MediaLibrary.MediaType.video;
      // Resolve the real file path in the background — iOS ph:// uris can't be
      // uploaded, but the display uri can be rendered right away, so the grow
      // animation starts now and the resolved asset lands when it's ready.
      const resolved = (async (): Promise<GalleryAsset> => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset);
          return {
            uri: info.localUri ?? info.uri,
            isVideo,
            width: asset.width > 0 ? asset.width : undefined,
            height: asset.height > 0 ? asset.height : undefined,
            duration: asset.duration > 0 ? asset.duration : undefined,
          };
        } finally {
          selectingRef.current = false;
        }
      })();
      onSelect(asset.uri, frame, isVideo, resolved);
    },
    [onSelect]
  );

  // Permission state still resolving — keep the row's height so the controls
  // below don't jump when the strip appears.
  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Pressable
          style={({ pressed }) => [styles.permissionTile, pressed && styles.pressed]}
          onPress={handleAllowAccess}
          accessibilityRole="button"
          accessibilityLabel="Allow photo access"
        >
          <GalleryPermissionIcon />
          <Text style={styles.permissionText}>Allow photo{'\n'}access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={assets}
        horizontal
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        onEndReached={() => void loadPage()}
        onEndReachedThreshold={2}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          hasNextRef.current ? <ActivityIndicator color="#fff" style={styles.loader} /> : null
        }
        renderItem={({ item }) => <StripThumb item={item} onPick={handlePick} />}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    height: ITEM_SIZE,
    marginBottom: 14,
  },
  listContent: {
    paddingHorizontal: 8,
    gap: 4,
  },
  loader: {
    marginLeft: 12,
    alignSelf: 'center',
  },
  thumbWrap: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  pressed: {
    opacity: 0.75,
  },
  durationBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  durationText: {
    color: '#fff',
    fontSize: fs(11),
    fontFamily: ff('Inter', '500'),
    includeFontPadding: false,
  },
  permissionTile: {
    marginLeft: 8,
    width: ITEM_SIZE * 1.6,
    height: ITEM_SIZE,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  permissionText: {
    color: '#fff',
    fontSize: fs(11),
    textAlign: 'center',
    lineHeight: 14,
    fontFamily: ff('Inter', '500'),
    includeFontPadding: false,
  },
});
