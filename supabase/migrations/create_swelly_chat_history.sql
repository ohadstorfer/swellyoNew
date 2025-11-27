-- Create table for storing Swelly chat history
CREATE TABLE IF NOT EXISTS public.swelly_chat_history (
  chat_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.swelly_chat_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own chat history
CREATE POLICY "Users can view own chat history"
ON public.swelly_chat_history
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy: Users can insert their own chat history
CREATE POLICY "Users can insert own chat history"
ON public.swelly_chat_history
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own chat history
CREATE POLICY "Users can update own chat history"
ON public.swelly_chat_history
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_swelly_chat_history_user_id ON public.swelly_chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_swelly_chat_history_conversation_id ON public.swelly_chat_history(conversation_id);


