-- Migration: Add image messaging support to messages table
-- File: supabase/migrations/add_image_messaging_support.sql

-- Step 1: Add type column (default 'text' for backward compatibility)
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text', 'image'));

-- Step 2: Add image_metadata JSONB column (nullable - null during upload)
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS image_metadata JSONB;

-- Step 3: Create index on type for filtering
CREATE INDEX IF NOT EXISTS idx_messages_type 
ON public.messages(type) 
WHERE type = 'image';

-- Step 4: Create index on image_metadata for queries
CREATE INDEX IF NOT EXISTS idx_messages_image_metadata 
ON public.messages USING GIN (image_metadata);

-- Step 5: Add constraint (allow null during upload)
ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS check_image_metadata;

ALTER TABLE public.messages
ADD CONSTRAINT check_image_metadata 
CHECK (
  (type = 'text' AND image_metadata IS NULL) OR
  (type = 'image' AND (image_metadata IS NULL OR image_metadata IS NOT NULL))
);

-- Step 6: Update existing messages to have type='text' explicitly
UPDATE public.messages
SET type = 'text'
WHERE type IS NULL;

-- Step 7: Make type NOT NULL (after setting defaults)
ALTER TABLE public.messages
ALTER COLUMN type SET NOT NULL;

-- Step 8: Add comment for documentation
COMMENT ON COLUMN public.messages.type IS 'Message type: text or image';
COMMENT ON COLUMN public.messages.image_metadata IS 'Image metadata for image messages: {image_url, thumbnail_url, width, height, file_size, mime_type, storage_path}. Null during upload, populated after upload completes.';


