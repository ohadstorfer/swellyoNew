-- Chat attachments (files) + contacts.
-- Adds two nullable JSONB metadata columns to public.messages, mirroring the
-- existing image_metadata / video_metadata / audio_metadata pattern.
--
--   file_metadata    -> messages of type='file'    (FileMetadata)
--   contact_metadata -> messages of type='contact' (ContactMetadata)
--
-- Apply MANUALLY in the Supabase SQL editor (project convention: never
-- `supabase db push`; remote migration history is frozen).

alter table public.messages add column if not exists file_metadata    jsonb;
alter table public.messages add column if not exists contact_metadata  jsonb;

-- The check_message_type CHECK enumerates allowed `type` values; extend it to
-- accept 'file' and 'contact' (else inserts fail with 23514). Applied to prod
-- 2026-07-08 via SQL. Preserves the original text/image/video/audio/commitment
-- branches verbatim and appends the two new ones.
alter table public.messages drop constraint if exists check_message_type;
alter table public.messages add constraint check_message_type check (
  (((type)::text = 'text'::text) and (image_metadata is null) and (video_metadata is null) and (audio_metadata is null) and (commitment_metadata is null))
  or (((type)::text = 'image'::text) and (commitment_metadata is null))
  or (((type)::text = 'video'::text) and (commitment_metadata is null))
  or (((type)::text = 'audio'::text) and (commitment_metadata is null))
  or (((type)::text = 'commitment_request'::text))
  or (((type)::text = 'file'::text) and (commitment_metadata is null))
  or (((type)::text = 'contact'::text) and (commitment_metadata is null))
);
