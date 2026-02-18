-- Simplify user_activity table
-- Remove redundant is_online and updated_at fields
-- Online status is now calculated from last_seen_at (within 5 minutes = online)

-- Drop the redundant columns
ALTER TABLE public.user_activity 
  DROP COLUMN IF EXISTS is_online,
  DROP COLUMN IF EXISTS updated_at;

-- Update the trigger function to only update last_seen_at
CREATE OR REPLACE FUNCTION update_user_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_activity (user_id, last_seen_at)
  VALUES (NEW.id, now())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    last_seen_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the simplified design
COMMENT ON TABLE public.user_activity IS 
'Simplified user activity tracking. Online status is calculated from last_seen_at (active within 5 minutes = online).';

