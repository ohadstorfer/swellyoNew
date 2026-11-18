import { supabase } from '../lib/supabase';
import { SayError } from './sayError';

/**
 * Trip photos from the browser: the cover (`hero`), the stay photo and its
 * gallery (`accommodation`), and itinerary day photos (`hero`, as the app does).
 *
 * Same path as `services/images.ts` (crew photos) — the `image-upload-s3` edge
 * function hands back a presigned PUT, and the key is built server-side from the
 * caller's JWT. Kept in its own file rather than widening `uploadCrewPhoto`, so
 * the create-trip work and this page do not edit the same file.
 *
 * Both kinds are already on the function's allowlist for `trip-images`
 * (`hero`, `accommodation`, `crew`); a new kind would mean redeploying it.
 * Rule 1 holds: no table, no function, no migration.
 *
 * 2048px at q0.85, matching the app's `uploadTripImage`. That also keeps the
 * source under generate-thumbnail-s3's 5 MB guard.
 */

export type TripImageKind = 'hero' | 'accommodation';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL?.trim()}/functions/v1/image-upload-s3`;
const MAX_DIMENSION = 2048;
const MAX_UPLOAD_BYTES = 5_000_000;

export async function uploadTripImage(
  file: File,
  userId: string,
  kind: TripImageKind,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new SayError('That is not an image. Pick a JPEG or a PNG.');
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new SayError('You are signed out. Sign in and try again.');

  const blob = await downscale(file, MAX_DIMENSION);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new SayError('That photo is too large even after resizing. Try a smaller one.');
  }

  const signRes = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'get-upload-url', userId, bucket: 'trip-images', kind }),
  });
  if (!signRes.ok) {
    throw new SayError(`Could not start the upload (${signRes.status}). Please try again.`);
  }
  const { uploadUrl, publicUrl } = (await signRes.json()) as { uploadUrl: string; publicUrl: string };

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!put.ok) throw new SayError('The photo did not upload. Please try again.');
  return publicUrl;
}

/**
 * Several photos, ONE AT A TIME. The object key is `<kind>-<timestamp>.jpg`, so
 * two uploads signed in the same millisecond would overwrite each other — the
 * app's itinerary upload is sequential for the same reason.
 */
export async function uploadTripImages(
  files: File[],
  userId: string,
  kind: TripImageKind,
): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) urls.push(await uploadTripImage(f, userId, kind));
  return urls;
}

/** Always JPEG: the presigned PUT is signed for image/jpeg. */
async function downscale(file: File, maxDimension: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new SayError('This browser cannot resize images.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new SayError('Could not read that image.');
  return blob;
}
