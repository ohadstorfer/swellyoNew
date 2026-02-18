-- Add missing INSERT policy for user_activity table
-- This allows users to insert their own activity records when using upsert()
-- The original migration only had SELECT and UPDATE policies, but upsert() requires INSERT permission

-- Drop policy if it exists (for idempotency)
DROP POLICY IF EXISTS "Users can insert own activity" ON public.user_activity;

-- Create the INSERT policy
CREATE POLICY "Users can insert own activity"
ON public.user_activity
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

