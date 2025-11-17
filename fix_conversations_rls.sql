-- Fix RLS policies for conversations and conversation_members tables
-- This ensures authenticated users can create conversations and add members

-- Step 1: Drop function and ALL existing policies
DROP FUNCTION IF EXISTS public.is_conversation_member(uuid, uuid);
DROP POLICY IF EXISTS "conversations_select_members" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_authenticated" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_admin_or_creator" ON public.conversations;
DROP POLICY IF EXISTS "conversation_members_select" ON public.conversation_members;
DROP POLICY IF EXISTS "conversation_members_insert_self_or_admin" ON public.conversation_members;
DROP POLICY IF EXISTS "conversation_members_update" ON public.conversation_members;
DROP POLICY IF EXISTS "conversation_members_delete" ON public.conversation_members;

-- Step 2: Recreate conversations policies with simpler, direct checks

-- SELECT: Users can see conversations where they are members OR conversations they created
-- Use a security definer function to break recursion
-- The function runs with elevated privileges to bypass RLS
CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- This function runs with elevated privileges (SECURITY DEFINER)
  -- It can read conversation_members without triggering RLS recursion
  -- because it runs as the function owner, not the calling user
  RETURN EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = conv_id
      AND cm.user_id = check_user_id
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;

CREATE POLICY "conversations_select_members" ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    -- User created the conversation
    created_by = auth.uid()
    OR
    -- User is a member (using function to avoid recursion)
    public.is_conversation_member(id, auth.uid())
  );

-- INSERT: Authenticated users can create conversations where they are the creator
CREATE POLICY "conversations_insert_authenticated" ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- UPDATE: Only the creator or admins can update
CREATE POLICY "conversations_update_admin_or_creator" ON public.conversations
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = conversations.id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = conversations.id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  );

-- Step 3: Recreate conversation_members policies

-- SELECT: Users can see their own membership OR members of conversations they created
-- Use direct field check to avoid recursion
CREATE POLICY "conversation_members_select" ON public.conversation_members
  FOR SELECT
  TO authenticated
  USING (
    -- User can see their own membership
    user_id = auth.uid()
    OR
    -- User can see all members if they created the conversation
    -- Check conversations table directly without triggering RLS recursion
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );

-- INSERT: Users can add themselves OR add others if they created the conversation
-- Avoid recursion by only checking conversations table, not conversation_members
CREATE POLICY "conversation_members_insert_self_or_admin" ON public.conversation_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User can add themselves
    user_id = auth.uid()
    OR
    -- User can add others if they created the conversation (for new conversations)
    -- This is safe because we check conversations table, not conversation_members
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );

-- UPDATE: Users can update their own membership, or creator can update
-- Avoid recursion by checking conversations table
CREATE POLICY "conversation_members_update" ON public.conversation_members
  FOR UPDATE
  TO authenticated
  USING (
    -- User can update their own membership
    user_id = auth.uid()
    OR
    -- Creator can update any member
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );

-- DELETE: Users can leave themselves, or creator can remove others
-- Avoid recursion by checking conversations table
CREATE POLICY "conversation_members_delete" ON public.conversation_members
  FOR DELETE
  TO authenticated
  USING (
    -- User can remove themselves
    user_id = auth.uid()
    OR
    -- Creator can remove any member
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );

-- Step 4: Verify policies are created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('conversations', 'conversation_members')
ORDER BY tablename, policyname;

