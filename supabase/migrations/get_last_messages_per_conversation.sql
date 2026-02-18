-- Create function to get the most recent message for each conversation
-- Uses PostgreSQL DISTINCT ON to guarantee exactly one message per conversation
-- This solves the issue where only the first few conversations show last message text
-- when some conversations have many recent messages that consume the query limit

CREATE OR REPLACE FUNCTION get_last_messages_per_conversation(conv_ids uuid[])
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  rendered_body jsonb,
  attachments jsonb,
  is_system boolean,
  edited boolean,
  deleted boolean,
  created_at timestamptz,
  updated_at timestamptz,
  type varchar,
  image_metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (conversation_id)
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.rendered_body,
    m.attachments,
    m.is_system,
    m.edited,
    m.deleted,
    m.created_at,
    m.updated_at,
    m.type,
    m.image_metadata
  FROM messages m
  WHERE m.conversation_id = ANY(conv_ids)
    -- Note: We include deleted messages so they can be displayed with "deleted" placeholder
  ORDER BY m.conversation_id, m.created_at DESC;
$$;

-- Grant execute permission to authenticated and anon roles
GRANT EXECUTE ON FUNCTION get_last_messages_per_conversation TO authenticated;
GRANT EXECUTE ON FUNCTION get_last_messages_per_conversation TO anon;

-- Add comment explaining the function
COMMENT ON FUNCTION get_last_messages_per_conversation IS 'Returns the most recent (last) message for each conversation in the provided array. Uses DISTINCT ON to guarantee exactly one message per conversation, ensuring all conversations get their last messages regardless of message distribution.';

