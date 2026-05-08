-- Audio (voice message) support.
-- Mirrors the image/video pattern. Two CHECK constraints already live on
-- public.messages (verified via pg_constraint inspection) — both must be
-- extended for type='audio' inserts to be accepted:
--
--   1. messages_type_check  → simple type whitelist
--   2. check_message_type   → consistency between `type` and the per-type
--                             metadata columns (text rows must not have
--                             image/video metadata; image/video rows are
--                             permissive about their own metadata being
--                             null while the upload is in flight)

-- 1) Add the audio_metadata column FIRST so the new constraint can reference it.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS audio_metadata JSONB;

COMMENT ON COLUMN public.messages.audio_metadata IS
  'JSONB shape: { audio_url, storage_path, duration_ms, waveform: number[], mime_type, size_bytes }';

-- 2) Whitelist constraint — extend with 'audio'.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'audio'));

-- 3) Consistency constraint — recreate preserving the EXACT prior shape for
--    text/image/video (text strict, image/video tautologically permissive)
--    and adding an 'audio' branch. We avoid tightening the image/video rules
--    because existing rows may not satisfy stricter cross-column checks, and
--    PostgreSQL validates the new constraint against all existing rows on
--    ALTER TABLE.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS check_message_type;

ALTER TABLE public.messages
  ADD CONSTRAINT check_message_type CHECK (
    (
      type = 'text'
      AND image_metadata IS NULL
      AND video_metadata IS NULL
      AND audio_metadata IS NULL
    )
    OR (
      type = 'image'
      AND (image_metadata IS NULL OR image_metadata IS NOT NULL)
    )
    OR (
      type = 'video'
      AND (video_metadata IS NULL OR video_metadata IS NOT NULL)
    )
    OR (
      type = 'audio'
      AND (audio_metadata IS NULL OR audio_metadata IS NOT NULL)
    )
  );

-- 4) GIN index for queries that filter on audio_metadata fields. Mirrors the
--    image_metadata index — partial so we don''t pay for non-audio rows.
CREATE INDEX IF NOT EXISTS idx_messages_audio_metadata
  ON public.messages USING GIN (audio_metadata)
  WHERE audio_metadata IS NOT NULL;
