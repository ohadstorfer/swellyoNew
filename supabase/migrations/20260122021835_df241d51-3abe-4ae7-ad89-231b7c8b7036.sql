-- Create storage bucket for surf level videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('surf-level-videos', 'surf-level-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to all files in the bucket
CREATE POLICY "Public read access for surf level videos"
ON storage.objects FOR SELECT
USING (bucket_id = 'surf-level-videos');

-- Allow authenticated users to upload (for admin purposes)
CREATE POLICY "Authenticated users can upload surf level videos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'surf-level-videos' AND auth.role() = 'authenticated');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update surf level videos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'surf-level-videos' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete surf level videos"
ON storage.objects FOR DELETE
USING (bucket_id = 'surf-level-videos' AND auth.role() = 'authenticated');