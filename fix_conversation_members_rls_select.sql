-- Fix conversation_members SELECT policy to allow users to see all members
-- of conversations they're part of, not just conversations they created
-- Uses SECURITY DEFINER function to avoid RLS recursion

-- Step 1: Create a function to check if user is a member of a conversation
-- This function bypasses RLS to avoid recursion
DROP FUNCTION IF EXISTS public.is_user_conversation_member(uuid, uuid);

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

GRANT EXECUTE ON FUNCTION public.is_user_conversation_member(uuid, uuid) TO authenticated;

-- Step 2: Drop the existing policy
DROP POLICY IF EXISTS "conversation_members_select" ON public.conversation_members;

-- Step 3: Create a new policy that allows users to see all members of conversations they're in
-- Uses the SECURITY DEFINER function to avoid recursion
CREATE POLICY "conversation_members_select" ON public.conversation_members
  FOR SELECT
  TO authenticated
  USING (
    -- User can see their own membership
    user_id = auth.uid()
    OR
    -- User can see all members if they created the conversation
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
    OR
    -- User can see all members if they are a member of the conversation
    -- This is the key fix: allow users to see other members of conversations they're in
    -- Uses SECURITY DEFINER function to avoid recursion
    public.is_user_conversation_member(auth.uid(), conversation_members.conversation_id)
  );

-- Verify the policy is created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'conversation_members'
  AND policyname = 'conversation_members_select';

