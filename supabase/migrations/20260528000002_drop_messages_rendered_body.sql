-- Drop the unused `messages.rendered_body` column.
--
-- The column was added via the dashboard (no creating migration in this repo)
-- as a placeholder for pre-rendered rich content (mentions / markdown / link
-- previews baked into jsonb). It was never written with anything other than
-- NULL (only by optimistic local inserts) and never read anywhere in the
-- client. Selecting it just shipped jsonb NULLs over the wire on every
-- message fetch.
--
-- get_last_messages_per_conversation() returned it, so the function's return
-- type changes — drop + recreate (CREATE OR REPLACE can't change signature).
--
-- Applied 2026-05-28.

drop function if exists public.get_last_messages_per_conversation(uuid[]);

alter table public.messages drop column if exists rendered_body;

create function public.get_last_messages_per_conversation(conv_ids uuid[])
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  attachments jsonb,
  is_system boolean,
  edited boolean,
  deleted boolean,
  created_at timestamptz,
  updated_at timestamptz,
  type varchar,
  image_metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (conversation_id)
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.attachments,
    m.is_system,
    m.edited,
    m.deleted,
    m.created_at,
    m.updated_at,
    m.type,
    m.image_metadata
  from messages m
  where m.conversation_id = any(conv_ids)
    -- Note: we include deleted messages so they can be displayed with the
    -- "deleted" placeholder.
  order by m.conversation_id, m.created_at desc;
$$;

grant execute on function public.get_last_messages_per_conversation(uuid[]) to authenticated;
grant execute on function public.get_last_messages_per_conversation(uuid[]) to anon;

comment on function public.get_last_messages_per_conversation is
  'Returns the most recent (last) message for each conversation in the provided array. Uses DISTINCT ON to guarantee exactly one message per conversation.';
