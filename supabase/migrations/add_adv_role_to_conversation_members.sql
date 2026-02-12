-- Add adv_role column to conversation_members table
-- This column tracks whether a user is an "adv_giver" or "adv_seeker" 
-- in conversations created through trip planning recommendations
-- 
-- Values:
--   - 'adv_giver': The user who was recommended (receives the message)
--   - 'adv_seeker': The user who initiated contact (sends the message)
--   - NULL: For group chats or conversations not created through trip planning

ALTER TABLE public.conversation_members 
ADD COLUMN IF NOT EXISTS adv_role VARCHAR(20) CHECK (adv_role IN ('adv_giver', 'adv_seeker'));

-- Add comment to document the column
COMMENT ON COLUMN public.conversation_members.adv_role IS 
'Role in trip planning context: adv_giver (recommended user) or adv_seeker (initiating user). NULL for non-trip-planning conversations.';











