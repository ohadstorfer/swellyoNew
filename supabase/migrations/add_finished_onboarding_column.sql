-- Add finished_onboarding column to surfers table
-- This migration adds the column to track if a user has completed onboarding

-- Step 1: Add the column with default false
ALTER TABLE public.surfers 
ADD COLUMN IF NOT EXISTS finished_onboarding BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Create an index for better query performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_surfers_finished_onboarding 
ON public.surfers(finished_onboarding) 
WHERE finished_onboarding = true;









