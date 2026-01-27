-- Create or update user_activity table to track user online status
-- This helps avoid sending emails when user is actively using the app
CREATE TABLE IF NOT EXISTS public.user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_online boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_activity_last_seen 
  ON user_activity(last_seen_at);

-- Function to update user activity
CREATE OR REPLACE FUNCTION update_user_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_activity (user_id, last_seen_at, is_online, updated_at)
  VALUES (NEW.id, now(), true, now())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    last_seen_at = now(),
    is_online = true,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own activity
CREATE POLICY "Users can view own activity"
ON public.user_activity
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy: Users can update their own activity
CREATE POLICY "Users can update own activity"
ON public.user_activity
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

