-- Create table to track message email notifications and manage batching
CREATE TABLE IF NOT EXISTS public.message_email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  email_sent_at timestamptz,
  batch_id uuid, -- Groups messages from same sender to same recipient
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(message_id, recipient_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_message_notifications_recipient_sender 
  ON message_email_notifications(recipient_id, sender_id, email_sent_at NULLS FIRST);
  
CREATE INDEX IF NOT EXISTS idx_message_notifications_batch 
  ON message_email_notifications(batch_id) 
  WHERE email_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_notifications_conversation 
  ON message_email_notifications(conversation_id);

-- Enable RLS
ALTER TABLE public.message_email_notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own notification records (for debugging)
CREATE POLICY "Users can view own notifications"
ON public.message_email_notifications
FOR SELECT
TO authenticated
USING (auth.uid() = recipient_id);

