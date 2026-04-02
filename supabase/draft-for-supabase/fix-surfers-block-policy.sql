-- Drop the permissive version (doesn't work because other permissive policies override it)
DROP POLICY "surfers_block_filter" ON surfers;

-- Recreate as RESTRICTIVE — this means: even if other policies allow access,
-- this one MUST ALSO pass. Blocked users will be denied.
CREATE POLICY "surfers_block_filter" ON surfers
AS RESTRICTIVE
FOR SELECT USING (
  NOT EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = surfers.user_id AND blocked_id = auth.uid())
       OR (blocker_id = auth.uid() AND blocked_id = surfers.user_id)
  )
);
