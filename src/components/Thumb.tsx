import React, { useEffect, useState } from 'react';
import { Image, ImageProps } from 'expo-image';
import { getStorageThumbUrl } from '../services/media/imageService';
import { toWidthThumbUrl } from '../services/media/thumbnails';

type ThumbProps = Omit<ImageProps, 'source'> & {
  /** Original Supabase public URL (or any URL). */
  uri?: string | null;
  /** Square rendered px; snapped to the nearest square ladder size. Default 320.
   *  Ignored when `widthPx` is set. */
  size?: number;
  /** If set, load the aspect-preserved WIDTH thumbnail (`__<w>w.jpg`) instead of a
   *  square variant — for wide hero/cover images (trip cards, profile cover). */
  widthPx?: number;
};

/**
 * expo-image that loads the static thumbnail for `uri` and falls back to the
 * original on error — covering the brief post-upload generation window and any
 * generation failure. Replaces direct `getStorageThumbUrl` + <Image> usage at
 * sites that render a small remote avatar/hero as the primary image.
 *
 * Pass `widthPx` for wide images (uses the aspect-preserved width variant) or
 * `size` for square avatars (the default). Either way, a missing thumbnail falls
 * back to the original, so it is safe to render before a backfill completes.
 *
 * Resets its fallback state when `uri` changes so it is safe inside recycled
 * FlatList rows.
 */
export const Thumb: React.FC<ThumbProps> = ({ uri, size = 320, widthPx, onError, ...rest }) => {
  const thumb = (widthPx ? toWidthThumbUrl(uri, widthPx) : getStorageThumbUrl(uri, size)) ?? uri ?? null;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const src = failed ? uri : thumb;

  return (
    <Image
      {...rest}
      source={src ? { uri: src } : undefined}
      onError={(e) => {
        // Thumb missing (not generated yet / gen failed) → show the original.
        if (!failed && uri && thumb !== uri) setFailed(true);
        onError?.(e);
      }}
    />
  );
};

export default Thumb;
