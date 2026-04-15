ALTER TABLE public.surfers
  ADD COLUMN IF NOT EXISTS is_mobile_user boolean NOT NULL DEFAULT false;
