-- Returns the most recent message for each conversation (one row per conversation).
-- Uses DISTINCT ON so all conversations get their last message regardless of how many
-- recent messages any single conversation has.
--
-- ⚠️ This file is reconciled to the LIVE prod definition (2026-06-17). Prod was AHEAD of
-- the old repo copy: it carries `rendered_body`, is NOT SECURITY DEFINER, and pins
-- search_path. An earlier repo edit had dropped rendered_body, flipped it to SECURITY
-- DEFINER, and re-granted anon — applying that verbatim would have regressed prod.
-- audio_metadata + commitment_metadata were added (additive) so the batched conversation
-- list (WS3 enrichment) can preview audio/commitment last messages.
-- Applied to prod via DROP+CREATE in one transaction (return-type change can't use plain
-- CREATE OR REPLACE), then REVOKE from PUBLIC/anon to keep the authenticated-only posture.

CREATE OR REPLACE FUNCTION public.get_last_messages_per_conversation(conv_ids uuid[])
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
  image_metadata jsonb,
  video_metadata jsonb,
  audio_metadata jsonb,
  commitment_metadata jsonb
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
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
    m.image_metadata,
    m.video_metadata,
    m.audio_metadata,
    m.commitment_metadata
  FROM messages m
  WHERE m.conversation_id = ANY(conv_ids)
    -- Includes deleted messages so they render with a "deleted" placeholder.
  ORDER BY m.conversation_id, m.created_at DESC;
$$;

-- Authenticated-only (function is not SECURITY DEFINER, so RLS on `messages` still applies).
REVOKE EXECUTE ON FUNCTION public.get_last_messages_per_conversation(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_messages_per_conversation(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_last_messages_per_conversation IS 'Returns the most recent message per conversation in the provided array (DISTINCT ON). Includes rendered_body + image/video/audio/commitment metadata for inbox previews.';
