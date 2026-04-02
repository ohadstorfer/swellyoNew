-- Block visibility: if you blocked someone, they can't see your surfer profile
-- and if someone blocked you, you can't see theirs.
-- This replaces the existing SELECT policy on surfers (if any) or adds a new one.

-- First check existing policies with: SELECT * FROM pg_policies WHERE tablename = 'surfers';
-- Then drop the existing SELECT policy if needed before creating the new one.

-- New policy: deny access if either direction of blocking exists
CREATE POLICY "surfers_block_filter" ON surfers
FOR SELECT USING (
  -- Allow if no block exists in either direction
  NOT EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = surfers.user_id AND blocked_id = auth.uid())
       OR (blocker_id = auth.uid() AND blocked_id = surfers.user_id)
  )
);

-- NOTE: If surfers already has a SELECT policy, you may need to drop it first:
-- DROP POLICY "existing_policy_name" ON surfers;
-- Then run the CREATE POLICY above.
-- Alternatively, if surfers uses permissive policies, this restrictive approach won't work.
-- In that case, modify the existing policy to include the NOT EXISTS check.
