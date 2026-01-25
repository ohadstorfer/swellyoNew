-- Create storage bucket for user-uploaded profile surf videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-surf-videos', 'profile-surf-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Drop policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Public read access for profile surf videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload profile surf videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update profile surf videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete profile surf videos" ON storage.objects;

-- Allow public read access to all files in the bucket
CREATE POLICY "Public read access for profile surf videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-surf-videos');

-- Allow authenticated users to upload their own videos
-- Path structure: {userId}/profile-surf-video-{timestamp}.mp4
-- OR temp/{userId}/profile-surf-video-{timestamp}.mp4 (for temporary uploads before processing)
CREATE POLICY "Authenticated users can upload profile surf videos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'profile-surf-videos' 
  AND auth.role() = 'authenticated'
  AND (
    -- Allow uploads to user's own folder: {userId}/...
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Allow uploads to temp folder: temp/{userId}/...
    ((storage.foldername(name))[1] = 'temp' AND (storage.foldername(name))[2] = auth.uid()::text)
  )
);

-- Allow authenticated users to update their own videos
CREATE POLICY "Authenticated users can update profile surf videos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'profile-surf-videos' 
  AND auth.role() = 'authenticated'
  AND (
    -- Allow updates to user's own folder: {userId}/...
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Allow updates to temp folder: temp/{userId}/...
    ((storage.foldername(name))[1] = 'temp' AND (storage.foldername(name))[2] = auth.uid()::text)
  )
);

-- Allow authenticated users to delete their own videos
CREATE POLICY "Authenticated users can delete profile surf videos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'profile-surf-videos' 
  AND auth.role() = 'authenticated'
  AND (
    -- Allow deletes from user's own folder: {userId}/...
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Allow deletes from temp folder: temp/{userId}/...
    ((storage.foldername(name))[1] = 'temp' AND (storage.foldername(name))[2] = auth.uid()::text)
  )
);

