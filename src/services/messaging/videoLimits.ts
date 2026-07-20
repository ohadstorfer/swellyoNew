/**
 * DM video limits — deliberately their own module.
 *
 * The send path has to enforce these BEFORE it paints the optimistic bubble,
 * and the bubble must appear on the very first frame after Send. Living in
 * `videoUploadService` (which the screens load with `await import()` to keep
 * the thumbnail/S3/AWS machinery out of the initial bundle) meant the bubble
 * waited on a dynamic import — under Metro in dev that's a chunk fetch over the
 * network, i.e. seconds of a dead screen after tapping Send.
 *
 * Kept dependency-free and tiny so a static import from the screens costs
 * nothing, while the heavy service stays lazy.
 */

export const MAX_VIDEO_SIZE_MB = 250;
export const MAX_VIDEO_DURATION_SECONDS = 120; // 2 minutes for DMs

/**
 * Reject clips over the DM limits. Callers holding picker metadata can enforce
 * this WITHOUT touching the file, which is what lets the bubble paint first.
 *
 * An unknown (0) size or duration passes: only `processVideo`, which reads the
 * real file, can rule on those.
 */
export function assertVideoWithinLimits(v: { fileSize?: number; duration?: number }): void {
  if ((v.fileSize ?? 0) > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
    throw new Error(`Video is too large (max ${MAX_VIDEO_SIZE_MB}MB)`);
  }
  if ((v.duration ?? 0) > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(`Video is too long (max ${MAX_VIDEO_DURATION_SECONDS}s)`);
  }
}
