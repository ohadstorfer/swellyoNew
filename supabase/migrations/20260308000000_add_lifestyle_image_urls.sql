-- Add lifestyle_image_urls to surfers (keyword -> bucket URL map from onboarding chat copy flow)
ALTER TABLE surfers
ADD COLUMN IF NOT EXISTS lifestyle_image_urls jsonb DEFAULT NULL;

COMMENT ON COLUMN surfers.lifestyle_image_urls IS 'Map of lifestyle keyword to image URL (bucket or uploaded); set when EXPO_PUBLIC_LOCAL_MODE onboarding copy completes.';
