-- Migration to update all existing demo users and add trigger for future demo users
-- This ensures all demo users (emails starting with "demo") are properly flagged

-- Step 1: Run the function to update all existing demo users
SELECT * FROM update_demo_users_by_email();

-- Step 2: Create trigger function to automatically flag new demo users
CREATE OR REPLACE FUNCTION auto_flag_demo_users()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if user email starts with "demo"
  IF EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = NEW.user_id 
    AND email LIKE 'demo%'
  ) THEN
    NEW.is_demo_user = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger on surfers table to automatically flag demo users
DROP TRIGGER IF EXISTS trigger_auto_flag_demo_users ON public.surfers;
CREATE TRIGGER trigger_auto_flag_demo_users
  BEFORE INSERT OR UPDATE ON public.surfers
  FOR EACH ROW
  EXECUTE FUNCTION auto_flag_demo_users();

COMMENT ON FUNCTION auto_flag_demo_users() IS 'Automatically sets is_demo_user = true when a surfer record is created/updated for a user with email starting with "demo"';
COMMENT ON TRIGGER trigger_auto_flag_demo_users ON public.surfers IS 'Automatically flags demo users based on email pattern when surfer records are created or updated';

