-- Surf Skill media: allow a PHOTO as an alternative to the surf video.
--
-- WHY a separate column instead of reusing profile_video_url: that column has
-- video-only machinery hanging off it (MediaConvert post-processing, the
-- videoPreloadService warm-up, the on-disk video cache, pollForVideoUpdate).
-- Putting an image URL in there would need a "is this actually a photo?" guard
-- at every one of those call sites. One nullable column keeps the two media
-- types unambiguous.
--
-- The two are mutually exclusive by client convention (picking one clears the
-- other) — the card renders photo > video > demo clip.

ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS profile_photo_url varchar(2048);

COMMENT ON COLUMN public.surfers.profile_photo_url IS
  'Public S3 URL of a user-uploaded surf PHOTO for the Surf Skill card. Mutually exclusive with profile_video_url — the client clears one when setting the other.';
