-- Add RLS policy for messages table to allow Realtime subscriptions
-- CRITICAL: Supabase Realtime respects RLS - if a user can't SELECT a row,
-- they won't receive INSERT/UPDATE/DELETE events for that row

-- Step 1: Ensure RLS is enabled on messages table
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Step 2: Create function to check if user is a conversation member (if it doesn't exist)
-- This function bypasses RLS to avoid recursion
CREATE OR REPLACE FUNCTION public.is_user_conversation_member(check_user_id uuid, conv_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- This function runs with elevated privileges (SECURITY DEFINER)
  -- It can read conversation_members without triggering RLS recursion
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = conv_id
      AND cm.user_id = check_user_id
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_user_conversation_member(uuid, uuid) TO authenticated;

-- Step 3: Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;

-- Step 4: Create SELECT policy - allows users to see messages in conversations they're members of
-- CRITICAL: This is required for Realtime subscriptions to work
CREATE POLICY "Users can view messages in their conversations"
ON public.messages
FOR SELECT
TO authenticated
USING (
  -- User is a member of the conversation (using function to avoid RLS recursion)
  public.is_user_conversation_member(auth.uid(), conversation_id)
);

-- Step 5: Create INSERT policy - allows users to send messages in conversations they're members of
CREATE POLICY "Users can insert messages in their conversations"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  -- User is a member of the conversation
  public.is_user_conversation_member(auth.uid(), conversation_id)
  AND
  -- User is the sender
  sender_id = auth.uid()
);

-- Step 6: Create UPDATE policy - allows users to edit their own messages
CREATE POLICY "Users can update their own messages"
ON public.messages
FOR UPDATE
TO authenticated
USING (
  -- User is the sender
  sender_id = auth.uid()
  AND
  -- User is a member of the conversation
  public.is_user_conversation_member(auth.uid(), conversation_id)
)
WITH CHECK (
  -- User is still the sender (can't change sender_id)
  sender_id = auth.uid()
  AND
  -- User is still a member of the conversation
  public.is_user_conversation_member(auth.uid(), conversation_id)
);

-- Step 7: Verify policies are created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'messages'
ORDER BY policyname;

-- Step 8: Verify RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'messages';

