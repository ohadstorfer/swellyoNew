import { withTimeout } from './withTimeout';

const THUMBNAIL_TIMEOUT_MS = 60_000;

/**
 * Upload a video's required source and its optional poster concurrently.
 *
 * The source upload determines whether a video message may be created. A
 * poster improves the bubble presentation but isn't needed to play the video,
 * so its failure must never turn a successful video upload into a failed send.
 */
export async function uploadVideoWithOptionalThumbnail<T>(
  videoUpload: Promise<T>,
  thumbnailUpload: Promise<string>,
  videoTimeoutMs: number,
  thumbnailTimeoutMs = THUMBNAIL_TIMEOUT_MS,
): Promise<{ uploadResult: T; thumbnailUrl: string }> {
  const startedAt = Date.now();
  // Stage/result/elapsed are interpolated into the message rather than passed as
  // an object arg: log collectors drop object payloads, which turned these into
  // two indistinguishable "[videoSend] upload stage" lines — no way to tell
  // which of the two uploads settled, or whether it passed or failed.
  const requiredVideo = withTimeout(videoUpload, videoTimeoutMs, 'video-s3-upload').then(
    (uploadResult) => {
      console.log(`[videoSend] video-s3-upload SUCCESS in ${Date.now() - startedAt}ms`);
      return uploadResult;
    },
    (error) => {
      console.warn(
        `[videoSend] video-s3-upload FAILED in ${Date.now() - startedAt}ms: ${error?.message}`,
      );
      throw error;
    },
  );

  const optionalThumbnail = withTimeout(
    thumbnailUpload,
    thumbnailTimeoutMs,
    'video-thumbnail-upload',
  ).then(
    (thumbnailUrl) => {
      console.log(`[videoSend] video-thumbnail-upload SUCCESS in ${Date.now() - startedAt}ms`);
      return thumbnailUrl;
    },
    (error) => {
      console.warn(
        `[videoSend] video-thumbnail-upload FAILED in ${Date.now() - startedAt}ms: ${error?.message}`,
      );
      return '';
    },
  );

  const [uploadResult, thumbnailUrl] = await Promise.all([requiredVideo, optionalThumbnail]);
  return { uploadResult, thumbnailUrl };
}
