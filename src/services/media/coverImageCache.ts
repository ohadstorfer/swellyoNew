import { Image } from 'expo-image';
import { toWidthThumbUrl } from './thumbnails';

/**
 * Which URL actually works for a profile cover: the `__1280w` thumbnail, or the
 * original when the thumbnail was never generated (S3 answers 403).
 *
 * Without this, every profile open asks for the thumbnail first, waits for the
 * 403, and only then loads the original — a ~0.5s round trip before a cover
 * that is already on disk. The avatar has no such probe, which is why it shows
 * first.
 */
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();

const isCached = async (url: string): Promise<boolean> => {
  try {
    return !!(await Image.getCachePathAsync(url));
  } catch {
    return false; // web / unsupported — treat as not cached
  }
};

/** The URL to render right now, or null if we have not resolved it yet. */
export const getResolvedCoverUrl = (uri: string | null | undefined): string | null =>
  (uri && resolved.get(uri)) || null;

/** Record what the screen found out by itself (thumbnail failed → original). */
export const setResolvedCoverUrl = (uri: string, url: string): void => {
  resolved.set(uri, url);
};

/**
 * Find the working URL and make sure its bytes are in the expo-image cache.
 * Disk is checked before the network, so a cover seen in an earlier session
 * resolves without any request.
 */
export const warmCoverImage = (uri: string | null | undefined): Promise<void> => {
  if (!uri || resolved.has(uri)) return Promise.resolve();
  const running = inflight.get(uri);
  if (running) return running;

  const thumb = toWidthThumbUrl(uri) ?? uri;
  const run = (async () => {
    try {
      if (await isCached(thumb)) {
        resolved.set(uri, thumb);
      } else if (thumb !== uri && (await isCached(uri))) {
        resolved.set(uri, uri);
      } else if (await Image.prefetch(thumb, 'memory-disk')) {
        resolved.set(uri, thumb);
      } else if (thumb !== uri && (await Image.prefetch(uri, 'memory-disk'))) {
        resolved.set(uri, uri);
      }
    } catch {
      // best-effort — the screen still loads the cover the slow way
    } finally {
      inflight.delete(uri);
    }
  })();
  inflight.set(uri, run);
  return run;
};

export const clearCoverImageCache = (): void => {
  resolved.clear();
  inflight.clear();
};
