-- Create PUBLIC storage bucket for message images
-- File: supabase/migrations/create_message_images_bucket.sql

-- Step 1: Create PUBLIC storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-images', 'message-images', true)  -- PUBLIC bucket
ON CONFLICT (id) DO NOTHING;

-- Step 2: RLS Policies for PUBLIC bucket
-- Policy 1: Users can upload images to conversations they're members of
CREATE POLICY IF NOT EXISTS "Users can upload message images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'message-images'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT conversation_id 
      FROM conversation_members 
      WHERE user_id = auth.uid()
    )
  )
);

-- Policy 2: Users can read images from conversations they're members of
CREATE POLICY IF NOT EXISTS "Users can read message images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'message-images'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT conversation_id 
      FROM conversation_members 
      WHERE user_id = auth.uid()
    )
  )
);

-- Policy 3: Users can delete their own message images (within edit window)
CREATE POLICY IF NOT EXISTS "Users can delete own message images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'message-images'
  AND (
    (storage.foldername(name))[2] IN (
      SELECT id::text
      FROM messages
      WHERE sender_id = auth.uid()
        AND created_at > now() - interval '15 minutes'
    )
  )
);



