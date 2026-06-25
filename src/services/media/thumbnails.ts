// Pure helpers that map a Supabase public-object URL to the matching static
// thumbnail URL in the `image-thumbnails` bucket. No network, no transform —
// this is the replacement for the metered /render/image/ endpoint.
//
// The thumbnails themselves are generated server-side (generate-thumbnail edge
// fn, fired by a storage.objects trigger). See
// docs/superpowers/specs/2026-06-25-self-hosted-thumbnails-design.md.

export const THUMBNAILS_BUCKET = 'image-thumbnails';

/** Square cover variants generated per image. Snap requests to one of these. */
export const SQUARE_LADDER = [48, 320] as const;

/** Width-bound (aspect-preserved) variant, used by social/og previews. */
export const WIDTH_VARIANT = 1280;

/**
 * Cache-buster appended to thumbnail URLs (`?v=N`). Thumbnails are overwritten
 * in place (same URL) with a 1-year cache-control, so devices/CDN keep serving
 * the old bytes. Bump this whenever thumbnails are regenerated to force a
 * refetch. v2 = after the EXIF-orientation fix (2026-06-25).
 */
export const THUMB_CACHE_VERSION = 2;

const OBJECT_MARKER = '/storage/v1/object/public/';

/** Smallest ladder size >= requested px (caps at the largest ladder size). */
export const snapSquareSize = (px: number): number =>
  SQUARE_LADDER.find((s) => s >= px) ?? SQUARE_LADDER[SQUARE_LADDER.length - 1];

const defaultBase = (): string => process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';

/**
 * Rewrite a Supabase public-object URL into its static square thumbnail URL.
 * - Non-Supabase URLs (e.g. Google avatars) are returned unchanged.
 * - URLs already pointing at the thumbnails bucket are returned unchanged.
 * - `null`/empty → `null`.
 * `baseUrl` defaults to EXPO_PUBLIC_SUPABASE_URL; injectable for tests.
 */
export const toThumbUrl = (
  url: string | null | undefined,
  px: number,
  baseUrl: string = defaultBase(),
): string | null => {
  if (!url) return null;
  const i = url.indexOf(OBJECT_MARKER);
  if (i === -1) return url; // not a Supabase public object — leave as-is
  const rest = url.slice(i + OBJECT_MARKER.length); // "<bucket>/<path>"
  if (rest.startsWith(`${THUMBNAILS_BUCKET}/`)) return url; // already a thumb
  const base = baseUrl || url.slice(0, i);
  const size = snapSquareSize(px);
  return `${base}${OBJECT_MARKER}${THUMBNAILS_BUCKET}/${rest}__${size}.jpg?v=${THUMB_CACHE_VERSION}`;
};

/**
 * Width-bound (aspect-preserved) thumbnail URL, used by og previews. Same rules
 * as `toThumbUrl` but produces the `__<width>w.jpg` variant.
 */
export const toWidthThumbUrl = (
  url: string | null | undefined,
  width: number = WIDTH_VARIANT,
  baseUrl: string = defaultBase(),
): string | null => {
  if (!url) return null;
  const i = url.indexOf(OBJECT_MARKER);
  if (i === -1) return url;
  const rest = url.slice(i + OBJECT_MARKER.length);
  if (rest.startsWith(`${THUMBNAILS_BUCKET}/`)) return url;
  const base = baseUrl || url.slice(0, i);
  return `${base}${OBJECT_MARKER}${THUMBNAILS_BUCKET}/${rest}__${width}w.jpg?v=${THUMB_CACHE_VERSION}`;
};
