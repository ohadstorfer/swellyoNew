-- Message search: trigram index + membership-scoped search RPC.
-- Serves BOTH global search (p_conversation_id NULL) and in-conversation
-- search (p_conversation_id set). Substring ILIKE so partial words and any
-- language (Hebrew/Spanish) match, WhatsApp-style.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Partial index: only live, non-empty bodies are searchable.
CREATE INDEX IF NOT EXISTS idx_messages_body_trgm
  ON public.messages USING gin (body extensions.gin_trgm_ops)
  WHERE deleted = false AND body <> '';

CREATE OR REPLACE FUNCTION public.search_messages(
  p_query text,
  p_conversation_id uuid DEFAULT NULL,
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  body text,
  message_created_at timestamptz,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  conversation_is_direct boolean,
  conversation_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    m.id,
    m.conversation_id,
    m.body,
    m.created_at,
    m.sender_id,
    sp.name,
    sp.profile_image_url,
    c.is_direct,
    CASE WHEN c.is_direct THEN op.name ELSE c.title END AS conversation_name
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  -- Membership gate: caller must be in the conversation.
  JOIN public.conversation_members me
    ON me.conversation_id = m.conversation_id AND me.user_id = auth.uid()
  LEFT JOIN public.surfers sp ON sp.user_id = m.sender_id
  -- For directs, the conversation "name" is the other participant's name.
  LEFT JOIN LATERAL (
    SELECT s.name
    FROM public.conversation_members om
    JOIN public.surfers s ON s.user_id = om.user_id
    WHERE om.conversation_id = c.id AND om.user_id <> auth.uid()
    LIMIT 1
  ) op ON c.is_direct
  WHERE m.deleted = false
    AND m.is_system = false
    AND m.body <> ''
    AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
    AND length(trim(p_query)) BETWEEN 2 AND 100
    -- Defensive wildcard escaping (client escapes too).
    AND m.body ILIKE '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

-- SECDEF hygiene (project convention): no PUBLIC/anon execute, explicit
-- grant to authenticated or PostgREST returns 403.
REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_messages(text, uuid, int, int) TO authenticated;
