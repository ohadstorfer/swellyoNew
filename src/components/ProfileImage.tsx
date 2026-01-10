import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Image, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from './Text';
import { Shimmer } from './skeletons/Shimmer';

interface ProfileImageProps {
  imageUrl?: string | null;
  name?: string;
  style?: any;
  showLoadingIndicator?: boolean;
  onError?: () => void;
  onLoad?: () => void;
}

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
export const ProfileImage: React.FC<ProfileImageProps> = ({
  imageUrl,
  name = 'User',
  style,
  showLoadingIndicator = false,
  onError,
  onLoad,
}) => {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const currentImageUrlRef = useRef<string | null | undefined>(imageUrl);

  // Reset loading and error state when imageUrl changes
  useEffect(() => {
    // Only reset if imageUrl actually changed
    if (currentImageUrlRef.current !== imageUrl) {
      currentImageUrlRef.current = imageUrl;
      setImageError(false);
      // Set loading to true initially (will show skeleton while loading)
      setIsLoading(true);
    }
  }, [imageUrl]);

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
    console.error('ProfileImage: Error loading image:', error, 'URL:', imageUrl);
    setImageError(true);
    setIsLoading(false);
    if (onError) {
      onError();
    }
  }, [imageUrl, onError]);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setImageError(false);
    if (onLoad) {
      onLoad();
    }
  }, [onLoad]);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
  }, []);

  const hasValidImage = imageUrl && imageUrl.trim() !== '' && !imageError;

  return (
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
      {hasValidImage && (
        <Image
          source={{ uri: imageUrl! }}
          style={[
            styles.image,
            {
              borderRadius,
              opacity: isLoading ? 0 : 1, // Hide image while loading
            },
          ]}
          resizeMode="cover"
          onError={handleError}
          onLoad={handleLoad}
          onLoadStart={handleLoadStart}
          {...(Platform.OS === 'web' && {
            loading: 'lazy' as any,
            decoding: 'async' as any,
            objectFit: 'cover' as any,
            // Use smooth interpolation - prefer smooth/blurry over pixelated/jagged edges
            imageRendering: 'auto' as any,
            // Use proper width/height for better browser optimization
            width: containerSize,
            height: containerSize,
          })}
        />
      )}
      
      {/* Show avatar icon while loading with shimmer animation */}
      {isLoading && (
        <View style={[styles.loadingIconContainer, { borderRadius }]}>
          <Shimmer>
            <View style={styles.iconWrapper}>
              <Svg width={containerSize * 0.7} height={containerSize * 0.7} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M3 20C5.33579 17.5226 8.50702 16 12 16C15.493 16 18.6642 17.5226 21 20M16.5 7.5C16.5 9.98528 14.4853 12 12 12C9.51472 12 7.5 9.98528 7.5 7.5C7.5 5.01472 9.51472 3 12 3C14.4853 3 16.5 5.01472 16.5 7.5Z"
                  stroke="#222B30"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          </Shimmer>
        </View>
      )}
      
      {/* Show initials as fallback when not loading and no valid image */}
      {!hasValidImage && !isLoading && (
        <View
          style={[
            styles.placeholder,
            {
              borderRadius,
            },
          ]}
        >
          <Text
            style={[
              styles.placeholderText,
              {
                fontSize,
              },
            ]}
          >
            {getInitials(name)}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
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
});

