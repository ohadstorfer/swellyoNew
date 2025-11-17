-- Fix RLS policies on users and surfers tables to allow reading
-- basic profile info for users who are in conversations together
-- Uses SECURITY DEFINER function to avoid RLS recursion

-- Step 0: Drop existing function if it exists
DROP FUNCTION IF EXISTS public.are_users_in_conversation(uuid, uuid);

-- Step 1: Create a function to check if two users are in a conversation together
-- This function bypasses RLS to avoid recursion
CREATE OR REPLACE FUNCTION public.are_users_in_conversation(user1_id uuid, user2_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Check if both users are members of the same conversation
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_members cm1
    INNER JOIN public.conversation_members cm2 
      ON cm1.conversation_id = cm2.conversation_id
    WHERE cm1.user_id = user1_id
      AND cm2.user_id = user2_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.are_users_in_conversation(uuid, uuid) TO authenticated;

-- Step 2: Update users table SELECT policy
-- Allow users to see their own data OR basic info of users they're in conversations with
DROP POLICY IF EXISTS "Users can view own data" ON public.users;
DROP POLICY IF EXISTS "Users can view conversation members" ON public.users;

-- Users can view their own data
CREATE POLICY "Users can view own data"
ON public.users
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Users can view basic info of users they're in conversations with
CREATE POLICY "Users can view conversation members"
ON public.users
FOR SELECT
TO authenticated
USING (
  -- User is in a conversation with this user (using function to avoid recursion)
  public.are_users_in_conversation(auth.uid(), users.id)
);

-- Step 3: Update surfers table SELECT policy
-- Allow users to see their own surfer data OR basic info of surfers they're in conversations with
DROP POLICY IF EXISTS "Users can view own surfer data" ON public.surfers;
DROP POLICY IF EXISTS "Users can view conversation member surfers" ON public.surfers;

-- Users can view their own surfer data
CREATE POLICY "Users can view own surfer data"
ON public.surfers
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can view basic info of surfers they're in conversations with
CREATE POLICY "Users can view conversation member surfers"
ON public.surfers
FOR SELECT
TO authenticated
USING (
  -- User is in a conversation with this surfer (using function to avoid recursion)
  public.are_users_in_conversation(auth.uid(), surfers.user_id)
);

-- Verify policies are created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('users', 'surfers')
ORDER BY tablename, policyname;

