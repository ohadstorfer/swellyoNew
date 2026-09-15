import { supabase } from '../lib/supabase';

/**
 * Putting a photo on a crew member from the browser.
 *
 * Product Specs §"Manage non-active (not in app) staff member": "Add new —
 * name, image, role (eg photographer), description."
 *
 * ── The comment this replaces ──────────────────────────────────────────────
 * `AddCrewDialog` used to say a Listed credit "wants a photo upload this
 * project has no path for", and `CrewMemberDialog` sent people to the app.
 * That was true of Supabase Storage, where the crew bucket's policies would
 * have had to be widened. It was never true of the actual upload path: crew
 * photos go through the `image-upload-s3` edge function, which hands back a
 * PRESIGNED PUT url. Both halves are a plain `fetch`, so the browser can do
 * exactly what the phone does, with no new policy and no new bucket.
 *
 * ── Why the key is derived server-side ─────────────────────────────────────
 * The function builds `<bucket>/<userId>/<kind>-<ts>.jpg` from the caller's own
 * JWT, so a client cannot write outside its own folder whatever it asks for.
 * That is the boundary; nothing here is trusted.
 *
 * ⚠️ `kind` is on a server-side allowlist. 'crew' is already on it — the app
 * uploads with it — but a NEW kind means editing and redeploying the edge
 * function, not just changing this file. A rejected kind comes back as a 400.
 *
 * Rule 1: no new table, no new function, no migration. This calls the app's.
 */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL?.trim()}/functions/v1/image-upload-s3`;

/** 1MB is generous for a face at 512px. Anything bigger is a camera original
 *  that would take the operator a minute to upload for no visible gain. */
const MAX_UPLOAD_BYTES = 1_000_000;

export async function uploadCrewPhoto(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That is not an image. Pick a JPEG or a PNG.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You are signed out. Sign in and try again.');

  // Resized before it is sent, not after. The app compresses with
  // expo-image-manipulator; a canvas is the browser's version of the same
  // step, and without it a 6MB phone photo is uploaded whole.
  const blob = await downscale(file, 1024);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error('That photo is too large even after resizing. Try a smaller one.');
  }

  const signRes = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'get-upload-url',
      userId,
      bucket: 'trip-images',
      kind: 'crew',
    }),
  });
  if (!signRes.ok) {
    throw new Error(`Could not start the upload (${signRes.status}). Please try again.`);
  }

  const { uploadUrl, publicUrl } = (await signRes.json()) as {
    uploadUrl: string;
    publicUrl: string;
  };

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!put.ok) throw new Error('The photo did not upload. Please try again.');

  return publicUrl;
}

/**
 * Draw the image into a canvas no bigger than `maxDimension` and read it back
 * as a JPEG.
 *
 * Deliberately always JPEG, matching the app and the `Content-Type` the
 * presigned PUT is signed for. A PNG of a photograph is several times the size
 * for no visible difference, and a signed URL will refuse a body whose type
 * does not match what it was signed with.
 */
async function downscale(file: File, maxDimension: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize images.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Could not read that image.');
  return blob;
}
