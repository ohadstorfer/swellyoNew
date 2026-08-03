/**
 * Persisting the Surf Skill card's media.
 *
 * A user shows how they ride with EITHER a clip or a photo, never both — so
 * writing one always clears the other. Centralised here so onboarding and the
 * profile editor can't drift into writing only half of that pair (which would
 * leave a stale photo winning over a freshly uploaded video, since the card
 * renders photo > video > demo clip).
 */
import { uploadSurfPhoto } from '../storage/storageService';
import { supabaseDatabaseService } from '../database/supabaseDatabaseService';

export interface SurfPhotoSaveResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Upload a surf photo to S3 and point `surfers.profile_photo_url` at it,
 * clearing `profile_video_url` in the same write.
 *
 * Unlike `startProfileVideoUpload` this is awaited by its callers: photos are
 * small (2048px JPEG, ~1s) so there's nothing to hide behind a fire-and-forget,
 * and the caller needs the URL to update its own state.
 */
export async function uploadAndSaveSurfPhoto(
  photoUri: string,
  userId: string,
): Promise<SurfPhotoSaveResult> {
  const result = await uploadSurfPhoto(photoUri, userId);
  if (!result.success || !result.url) {
    return { success: false, error: result.error || 'Failed to upload photo' };
  }

  try {
    await supabaseDatabaseService.saveSurfer({
      profilePhotoUrl: result.url,
      profileVideoUrl: '', // a photo replaces the clip
    });
  } catch (err) {
    console.error('[surfSkillMedia] photo uploaded but saveSurfer failed:', err);
    return { success: false, url: result.url, error: 'Failed to save photo' };
  }

  return { success: true, url: result.url };
}

/**
 * Clear a previously saved surf photo. Call this when the user picks a VIDEO,
 * so the photo doesn't keep winning on the card.
 *
 * Best-effort and non-throwing: the video upload is the thing the user is
 * waiting on, and a failure here just leaves the old photo one save behind.
 */
export async function clearSurfPhoto(): Promise<void> {
  try {
    await supabaseDatabaseService.saveSurfer({ profilePhotoUrl: '' });
  } catch (err) {
    console.warn('[surfSkillMedia] could not clear surf photo:', err);
  }
}
