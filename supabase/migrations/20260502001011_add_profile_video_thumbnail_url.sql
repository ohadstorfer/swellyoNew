-- Adds a poster-image URL for the user-uploaded surf video.
-- Set client-side after uploadProfileVideoS3 finishes the S3 PUT: the client
-- captures a frame via expo-video-thumbnails (native) / canvas (web), uploads
-- it to the profile-images bucket, then writes the public URL here.
--
-- Read by ProfileEditPanel as a fallback below the in-flight local thumbnail
-- and above the static demo image, so the surf-skill card keeps showing the
-- user's clip after a reload.

ALTER TABLE public.surfers
  ADD COLUMN profile_video_thumbnail_url character varying NULL;

COMMENT ON COLUMN public.surfers.profile_video_thumbnail_url IS
  'Public URL of a poster image for the user-uploaded surf video. Stored under profile-images/{user_id}/video-thumbnail-*.jpg.';
