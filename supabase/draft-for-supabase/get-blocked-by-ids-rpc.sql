-- RPC function: get IDs of users who have blocked the current user
-- Needed for matching exclusion (RLS only shows rows where blocker_id = auth.uid())
CREATE OR REPLACE FUNCTION get_blocked_by_ids()
RETURNS uuid[] AS $$
  SELECT COALESCE(array_agg(blocker_id), '{}')
  FROM user_blocks
  WHERE blocked_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;
