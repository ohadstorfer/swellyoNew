-- Add profile_video_url column to surfers table
-- This stores the URL to the user's custom surf level video

ALTER TABLE surfers 
ADD COLUMN IF NOT EXISTS profile_video_url varchar(2048);

-- Add comment for documentation
COMMENT ON COLUMN surfers.profile_video_url IS 'URL to user-uploaded custom surf level video stored in profile-surf-videos bucket';

