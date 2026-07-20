import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Text } from './Text';
import { Images } from '../assets/images';


interface ProfileImageProps {
  imageUrl?: string | null;
  /**
   * Optional second URL to try if `imageUrl` fails to load. Used when `imageUrl`
   * is a (best-effort) thumbnail — e.g. a trip cover served from the
   * `image-thumbnails` bucket — that may not exist yet or ever (the server-side
   * generator can OOM on very large photos). We fall back to the full original
   * instead of dropping straight to the silhouette. `<Thumb>` does the same for
   * non-avatar images; this brings the circular avatar in line.
   */
  fallbackImageUrl?: string | null;
  name?: string;
  style?: any;
  showLoadingIndicator?: boolean;
  onError?: () => void;
  onLoad?: () => void;
  isOnline?: boolean;
  showOnlineIndicator?: boolean;
}

const isUsable = (url?: string | null): url is string =>
  !!url && url.trim() !== '';

export type AvatarStage = 'primary' | 'fallback' | 'placeholder';

/**
 * Pick which URL the avatar should render given what has failed so far.
 * Pure + exported so the fallback logic is unit-tested without rendering
 * expo-image. A fallback identical to the primary is ignored (retrying it would
 * just fail again). Empty/whitespace/null are treated as "no image".
 */
export const resolveAvatarSource = (
  primary: string | null | undefined,
  fallback: string | null | undefined,
  primaryFailed: boolean,
  fallbackFailed: boolean,
): { url: string | null; stage: AvatarStage } => {
  if (isUsable(primary) && !primaryFailed) return { url: primary, stage: 'primary' };
  if (isUsable(fallback) && fallback !== primary && !fallbackFailed) {
    return { url: fallback, stage: 'fallback' };
  }
  return { url: null, stage: 'placeholder' };
};

/**
 * ProfileImage Component
 * 
 * Best practices implementation for rendering profile pictures:
 * - Optimized image loading with error handling
 * - Placeholder with user initials
 * - Loading state indicator
 * - Proper sizing controlled by parent via style prop
 * - Web-optimized rendering with smooth interpolation
 * - Prefers smooth/blurry over pixelated when scaling down large images
 */
export const ProfileImage: React.FC<ProfileImageProps> = React.memo(({
  imageUrl,
  fallbackImageUrl,
  name = 'User',
  style,
  showLoadingIndicator = false,
  onError,
  onLoad,
  isOnline = false,
  showOnlineIndicator = true,
}) => {
  // Two failure flags instead of one: the primary (usually a thumbnail) can fail
  // while the fallback (the full original) still loads. See resolveAvatarSource.
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const currentImageUrlRef = useRef<string | null | undefined>(imageUrl);
  const currentFallbackRef = useRef<string | null | undefined>(fallbackImageUrl);

  // Reset error state when either URL changes. `isLoading` is driven by
  // expo-image's onLoadStart/onLoad callbacks — forcing it to true here would
  // flash the silhouette overlay on memory-cache hits (where onLoadStart never
  // fires).
  useEffect(() => {
    if (
      currentImageUrlRef.current !== imageUrl ||
      currentFallbackRef.current !== fallbackImageUrl
    ) {
      currentImageUrlRef.current = imageUrl;
      currentFallbackRef.current = fallbackImageUrl;
      setPrimaryFailed(false);
      setFallbackFailed(false);
    }
  }, [imageUrl, fallbackImageUrl]);

  const { url: effectiveUrl, stage } = resolveAvatarSource(
    imageUrl,
    fallbackImageUrl,
    primaryFailed,
    fallbackFailed,
  );

  // Extract size from style to calculate borderRadius and fontSize
  // Use a stable reference to avoid unnecessary recalculations
  const containerSize = useMemo(() => {
    if (style) {
      // Try to get width or height from style
      const width = style.width || (Array.isArray(style) ? style.find((s: any) => s?.width)?.width : undefined);
      const height = style.height || (Array.isArray(style) ? style.find((s: any) => s?.height)?.height : undefined);
      return width || height || 60; // Default to 60 if not found
    }
    return 60;
  }, [style]);

  const borderRadius = containerSize / 2;
  const fontSize = Math.max(12, Math.min(48, containerSize * 0.4));

  // Get user initials for placeholder
  const getInitials = useCallback((name: string): string => {
    if (!name || name.trim() === '') return 'U';
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length === 1) {
      return nameParts[0].charAt(0).toUpperCase();
    }
    return (nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)).toUpperCase();
  }, []);

  const handleError = useCallback((error: any) => {
    // A missing best-effort thumbnail is expected (the server generator can OOM
    // on huge photos and never write one), so this is a warn, not an error —
    // and only when we've exhausted every source. Failing the primary just
    // advances to the fallback below.
    if (stage === 'fallback') {
      console.warn('ProfileImage: image failed (thumb + original):', 'URL:', effectiveUrl, error);
      setFallbackFailed(true);
      setIsLoading(false);
      if (onError) onError();
    } else {
      // stage === 'primary' (or placeholder, which can't render an <Image>).
      setPrimaryFailed(true);
      const willFallBack = resolveAvatarSource(imageUrl, fallbackImageUrl, true, false).stage === 'fallback';
      if (!willFallBack) {
        console.warn('ProfileImage: image failed to load:', 'URL:', effectiveUrl, error);
        setIsLoading(false);
        if (onError) onError();
      }
      // else: keep isLoading true through the fallback attempt (no flash).
    }
  }, [stage, effectiveUrl, imageUrl, fallbackImageUrl, onError]);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    if (onLoad) {
      onLoad();
    }
  }, [onLoad]);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
  }, []);

  const hasValidImage = !!effectiveUrl;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.container,
          {
            borderRadius,
          },
          style,
        ]}
      >
      {/* Always render Image if we have a valid URL (so onLoad can fire) */}
      {hasValidImage && Platform.OS === 'web' && effectiveUrl?.includes('googleusercontent.com') ? (
        // Use native img tag for Google images on web to handle CORS properly
        // eslint-disable-next-line jsx-a11y/alt-text
        <img
          src={effectiveUrl!}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            borderRadius,
            objectFit: 'cover',
            opacity: isLoading ? 0 : 1,
            display: 'block',
            transition: 'opacity 0.2s ease-in-out',
          }}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          onError={handleError}
          onLoad={handleLoad}
          loading="lazy"
        />
      ) : hasValidImage ? (
        <Image
          source={{ uri: effectiveUrl! }}
          style={[styles.image, { borderRadius }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
          recyclingKey={effectiveUrl || undefined}
          onError={handleError}
          onLoad={handleLoad}
          onLoadStart={handleLoadStart}
        />
      ) : null}
      
      {/* Surfer placeholder only as a fallback when there's no valid image URL.
          Avoid showing it during the initial isLoading=true window over a valid
          URL — that caused a cartoon flash on chat entry before the real avatar
          rendered. The gray container background covers the load gap instead. */}
      {!hasValidImage && (
        <View style={[styles.loadingIconContainer, { borderRadius }]}>
          <Image
            source={Images.defaultAvatar}
            style={styles.placeholderImage}
            contentFit="cover"
          />
        </View>
      )}

      {/* Online status indicator - green dot, bottom-right */}
      {isOnline && showOnlineIndicator && (
        <View style={[
          styles.onlineIndicator,
          { borderRadius: 5 },
          styles.onlineIndicatorBottomRight,
        ]} />
      )}

      </View>
    </View>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  return (
    prevProps.imageUrl === nextProps.imageUrl &&
    prevProps.fallbackImageUrl === nextProps.fallbackImageUrl &&
    prevProps.name === nextProps.name &&
    prevProps.style === nextProps.style &&
    prevProps.showLoadingIndicator === nextProps.showLoadingIndicator &&
    prevProps.isOnline === nextProps.isOnline &&
    prevProps.showOnlineIndicator === nextProps.showOnlineIndicator
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  container: {
    overflow: 'hidden', // Keep hidden to maintain circular shape
    backgroundColor: '#E4E4E4',
    ...(Platform.OS === 'web' && {
      display: 'block' as any,
      // Ensure container maintains aspect ratio
      aspectRatio: '1 / 1' as any,
    }),
  },
  image: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      display: 'block' as any,
      objectFit: 'cover' as any,
      // Use smooth interpolation for better quality when scaling down large images
      // This prevents pixelated/jagged edges (prefer smooth/blurry over shaky)
      imageRendering: 'auto' as any,
      // Ensure proper sizing
      maxWidth: '100%' as any,
      maxHeight: '100%' as any,
      // Better quality for scaled images with smooth rendering
      backfaceVisibility: 'hidden' as any,
      transform: 'translateZ(0)' as any,
    }),
  },
  placeholder: {
    backgroundColor: '#E4E4E4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  loadingIconContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#E4E4E4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderImage: {
    // The default-avatar asset is itself a full circle (transparent corners),
    // so it fills the whole avatar; the container's borderRadius clips edges.
    width: '100%',
    height: '100%',
  },
  onlineIndicator: {
    position: 'absolute',
    width: 10,
    height: 10,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 10,
  },
  onlineIndicatorBottomRight: {
    bottom: 2,
    right: 2,
  },
});

