-- Simple SQL script to add is_demo_user column
-- Run this in Supabase SQL Editor BEFORE creating demo surfers

-- Step 1: Add the column with default false
ALTER TABLE public.surfers 
ADD COLUMN IF NOT EXISTS is_demo_user BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Create an index for better query performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_surfers_is_demo_user 
ON public.surfers(is_demo_user) 
WHERE is_demo_user = true;

-- Step 3: Update all existing demo users (users with @demo.swellyo.com email)
-- This will mark all previously created demo users
UPDATE public.surfers s
SET is_demo_user = true
FROM public.users u
WHERE s.user_id = u.id 
  AND u.email LIKE '%@demo.swellyo.com'
  AND s.is_demo_user = false;


