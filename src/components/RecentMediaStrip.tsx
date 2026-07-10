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

interface RecentMediaStripProps {
  onSelect: (asset: GalleryAsset) => void;
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

export function RecentMediaStrip({ onSelect }: RecentMediaStripProps) {
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

  const handleSelect = useCallback(
    async (asset: MediaLibrary.Asset) => {
      if (selectingRef.current) return;
      selectingRef.current = true;
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        const uri = info.localUri ?? info.uri;
        onSelect({
          uri,
          isVideo: asset.mediaType === MediaLibrary.MediaType.video,
          width: asset.width > 0 ? asset.width : undefined,
          height: asset.height > 0 ? asset.height : undefined,
          duration: asset.duration > 0 ? asset.duration : undefined,
        });
      } catch (error) {
        console.warn('[RecentMediaStrip] failed to resolve asset:', error);
      } finally {
        selectingRef.current = false;
      }
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
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.thumbWrap, pressed && styles.pressed]}
            onPress={() => void handleSelect(item)}
            accessibilityRole="imagebutton"
          >
            <Image
              source={{ uri: item.uri }}
              style={styles.thumb}
              contentFit="cover"
              recyclingKey={item.id}
              transition={80}
            />
            {item.mediaType === MediaLibrary.MediaType.video && (
              <View style={styles.durationBadge}>
                <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
              </View>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

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
