-- Add cover_image_url to surfers (per-user profile cover photo).
-- Mirrors profile_image_url: nullable varchar(2048).
ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS cover_image_url varchar(2048);
