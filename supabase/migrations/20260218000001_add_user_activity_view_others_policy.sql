-- Allow users to view other users' activity for online status checks
-- This is needed for presence/online status features in direct messages

DROP POLICY IF EXISTS "Users can view conversation member activity" ON public.user_activity;

CREATE POLICY "Users can view conversation member activity"
ON public.user_activity
FOR SELECT
TO authenticated
USING (
  -- Allow viewing activity of users they're in conversations with
  EXISTS (
    SELECT 1 FROM public.conversation_members cm1
    JOIN public.conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
    WHERE cm1.user_id = auth.uid()
      AND cm2.user_id = user_activity.user_id
  )
);

