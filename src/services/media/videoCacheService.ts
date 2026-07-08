import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Persistent, URL-keyed, LRU-bounded on-device video cache (native only).
//
// Why: profile videos (~6 MB each) were streamed fresh from the network on every
// profile open because playback never consulted the disk. This module downloads a
// remote video ONCE, stores it under a hash of its full URL, and returns the local
// `file://` URI for playback. A looping player then replays from disk with zero
// network. See docs/superpowers/specs/2026-07-07-egress-reduction-design.md (Lane A).
//
// Replacement is automatic: profile-video URLs carry a timestamp in the filename,
// so a re-upload produces a NEW url → a natural cache miss → fresh download; the
// stale file ages out of the LRU. No invalidation logic needed.
//
// Web is a no-op: browsers already dedupe repeat fetches via the HTTP cache, and the
// primary egress (and platform) is native.

const CACHE_DIR = `${FileSystem.cacheDirectory}video-cache/`;
const INDEX_PATH = `${CACHE_DIR}index.json`;
/** LRU size cap. cacheDirectory is OS-purgeable, so this is a soft ceiling. */
const MAX_CACHE_BYTES = 400 * 1024 * 1024; // 400 MB

interface IndexEntry {
  url: string;
  size: number;
  lastAccess: number;
}
type CacheIndex = Record<string, IndexEntry>; // key: cache filename

let indexCache: CacheIndex | null = null;
let indexLoad: Promise<CacheIndex> | null = null;
/** De-dupe concurrent resolves of the same URL (e.g. own + others' card mounting). */
const inFlight = new Map<string, Promise<string>>();

/** FNV-1a with two seeds → 64-bit hex. Deterministic, dependency-free, collision-safe at our scale. */
const hashUrl = (url: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
};

const extFromUrl = (url: string): string => {
  const m = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? `.${m[1].toLowerCase()}` : '.mp4';
};

const cacheFileName = (url: string): string => `${hashUrl(url)}${extFromUrl(url)}`;

const ensureDir = async (): Promise<void> => {
  try {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  } catch {
    // already exists / benign
  }
};

const loadIndex = async (): Promise<CacheIndex> => {
  if (indexCache) return indexCache;
  if (!indexLoad) {
    indexLoad = (async () => {
      try {
        const info = await FileSystem.getInfoAsync(INDEX_PATH);
        if (info.exists) {
          const raw = await FileSystem.readAsStringAsync(INDEX_PATH);
          indexCache = JSON.parse(raw) as CacheIndex;
        } else {
          indexCache = {};
        }
      } catch {
        indexCache = {};
      }
      return indexCache;
    })();
  }
  return indexLoad;
};

const saveIndex = async (idx: CacheIndex): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(idx));
  } catch {
    // best-effort; a lost index entry only risks a redundant re-download later
  }
};

/** Evict least-recently-accessed files until under the size cap. */
const evictIfNeeded = async (idx: CacheIndex): Promise<void> => {
  let total = 0;
  for (const k in idx) total += idx[k].size || 0;
  if (total <= MAX_CACHE_BYTES) return;
  const entries = Object.entries(idx).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [fname, entry] of entries) {
    if (total <= MAX_CACHE_BYTES) break;
    try {
      await FileSystem.deleteAsync(`${CACHE_DIR}${fname}`, { idempotent: true });
    } catch {
      // ignore; still drop it from the index
    }
    total -= entry.size || 0;
    delete idx[fname];
  }
};

/**
 * Resolve a remote video URL to a local `file://` URI, downloading once if needed.
 * Returns the original URL on web, when passed an empty URL, or if download fails
 * (so playback always has a usable source — it just isn't cached that time).
 */
export const getCachedVideoUri = async (remoteUrl: string): Promise<string> => {
  if (Platform.OS === 'web' || !remoteUrl) return remoteUrl;
  // Already local (e.g. a previously-resolved file:// URI) — nothing to do.
  if (remoteUrl.startsWith('file://')) return remoteUrl;

  const existing = inFlight.get(remoteUrl);
  if (existing) return existing;

  const task = (async (): Promise<string> => {
    await ensureDir();
    const fname = cacheFileName(remoteUrl);
    const localUri = `${CACHE_DIR}${fname}`;
    const idx = await loadIndex();

    // Cold-start durable: consult the disk, not just an in-memory map.
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists && (info as any).size > 0) {
      idx[fname] = { url: remoteUrl, size: (info as any).size, lastAccess: Date.now() };
      void saveIndex(idx);
      return localUri;
    }

    const result = await FileSystem.downloadAsync(remoteUrl, localUri);
    if (result.status < 200 || result.status >= 300) {
      try {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
      } catch {}
      throw new Error(`video cache download failed: ${result.status}`);
    }

    const dinfo = await FileSystem.getInfoAsync(localUri);
    idx[fname] = { url: remoteUrl, size: (dinfo as any).size || 0, lastAccess: Date.now() };
    await evictIfNeeded(idx);
    void saveIndex(idx);
    return localUri;
  })().finally(() => {
    inFlight.delete(remoteUrl);
  });

  inFlight.set(remoteUrl, task);
  // Fall back to the remote URL if caching fails, so playback still works.
  return task.catch(() => remoteUrl);
};

/** Warm the cache in the background (fire-and-forget). */
export const prefetchVideo = (remoteUrl: string): void => {
  if (!remoteUrl) return;
  void getCachedVideoUri(remoteUrl);
};
