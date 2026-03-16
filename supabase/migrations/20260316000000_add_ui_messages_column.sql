-- Add ui_messages column to swelly_chat_history for ordered UI message restoration
-- This stores every visible chat element (text, cards, action states, etc.) with order indexes
ALTER TABLE public.swelly_chat_history
  ADD COLUMN IF NOT EXISTS ui_messages jsonb NOT NULL DEFAULT '[]'::jsonb;
