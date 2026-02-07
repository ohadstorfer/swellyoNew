-- Create function to update demo users based on email pattern
-- This function finds all users with emails starting with "demo" and sets is_demo_user = true

CREATE OR REPLACE FUNCTION update_demo_users_by_email()
RETURNS TABLE(updated_count INTEGER, user_ids UUID[]) AS $$
DECLARE
  updated_count INTEGER := 0;
  user_ids UUID[];
BEGIN
  -- Update surfers table where user email starts with "demo"
  UPDATE public.surfers s
  SET is_demo_user = true
  FROM public.users u
  WHERE s.user_id = u.id
    AND u.email LIKE 'demo%'
    AND (s.is_demo_user IS NULL OR s.is_demo_user = false);
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  -- Get list of updated user IDs
  SELECT ARRAY_AGG(DISTINCT u.id)
  INTO user_ids
  FROM public.users u
  WHERE u.email LIKE 'demo%';
  
  RETURN QUERY SELECT updated_count, COALESCE(user_ids, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_demo_users_by_email() IS 'Finds all users with emails starting with "demo" and sets their is_demo_user flag to true in the surfers table';

