-- Commitment-request message support.
--
-- Mirrors the image/video/audio pattern (see add_audio_messaging_support.sql).
-- A 'commitment_request' message renders as a structured bubble in the chat
-- showing the items the member committed to + their optional note. The
-- approval system banner ('X is now marked as committed') still uses
-- postSystemMessage(is_system=true, type='text') and needs no new type.

alter table public.messages
  add column if not exists commitment_metadata jsonb;

comment on column public.messages.commitment_metadata is
  'JSONB shape: { trip_id, request_id, items: string[], note?: string }. Populated only when type = ''commitment_request''.';

-- Extend the type whitelist.
alter table public.messages
  drop constraint if exists messages_type_check;

alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'image', 'video', 'audio', 'commitment_request'));

-- Extend the cross-column consistency constraint. Same shape as audio: the
-- commitment_metadata column must be null for non-commitment rows and is
-- permissive (null or not) for commitment rows.
alter table public.messages
  drop constraint if exists check_message_type;

alter table public.messages
  add constraint check_message_type check (
    (
      type = 'text'
      and image_metadata is null
      and video_metadata is null
      and audio_metadata is null
      and commitment_metadata is null
    )
    or (
      type = 'image'
      and (image_metadata is null or image_metadata is not null)
      and commitment_metadata is null
    )
    or (
      type = 'video'
      and (video_metadata is null or video_metadata is not null)
      and commitment_metadata is null
    )
    or (
      type = 'audio'
      and (audio_metadata is null or audio_metadata is not null)
      and commitment_metadata is null
    )
    or (
      type = 'commitment_request'
      and (commitment_metadata is null or commitment_metadata is not null)
    )
  );

create index if not exists idx_messages_commitment_metadata
  on public.messages using gin (commitment_metadata)
  where commitment_metadata is not null;
