import React, { useEffect, useState } from 'react';
import { Image, ImageProps } from 'expo-image';
import { getStorageThumbUrl } from '../services/media/imageService';

type ThumbProps = Omit<ImageProps, 'source'> & {
  /** Original Supabase public URL (or any URL). */
  uri?: string | null;
  /** Rendered px size; snapped to the nearest thumbnail ladder size. */
  size: number;
};

/**
 * expo-image that loads the static thumbnail for `uri` and falls back to the
 * original on error — covering the brief post-upload generation window and any
 * generation failure. Replaces direct `getStorageThumbUrl` + <Image> usage at
 * sites that render a small remote avatar/hero as the primary image.
 *
 * Resets its fallback state when `uri` changes so it is safe inside recycled
 * FlatList rows.
 */
export const Thumb: React.FC<ThumbProps> = ({ uri, size, onError, ...rest }) => {
  const thumb = getStorageThumbUrl(uri, size) ?? uri ?? null;
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
