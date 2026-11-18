-- Move conversations.updated_at when the chat's NEWEST message is edited or
-- deleted, not only when a message is inserted.
--
-- Why: 20261101000100 moved the updated_at touch to the server, but only on
-- INSERT. The client touches in editMessage() / deleteMessage() were removed in
-- the same release, so an edit or delete no longer moves updated_at at all.
-- The reconnect catch-up (MessagingProvider.handleReconnect ->
-- getConversationsUpdatedSince(lastSync)) filters on updated_at > lastSync, so
-- a device that was offline when the last message was deleted keeps showing it
-- as the chat preview. (The live inbox broadcast path reads by id and is fine.)
--
-- Only the newest message: that is the one the chat list previews. Editing an
-- older message must not move the chat to the top on the next full load.
-- Uses idx_messages_conversation_created_at for the "is there a newer one" check.
--
-- now(), not new.updated_at: same reason as the insert trigger.
--
-- ⚠️ REFERENCE COPY — applied BY HAND, never `db push`. Idempotent.
-- Undo: supabase/rollbacks/20261117000000_touch_conversation_on_message_edit_rollback.sql

begin;

create or replace function public.touch_conversation_on_message_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if exists (
    select 1 from public.messages m
    where m.conversation_id = new.conversation_id
      and m.created_at > new.created_at
  ) then
    return null;                       -- not the preview message
  end if;

  update public.conversations
     set updated_at = now()
   where id = new.conversation_id
     and updated_at < now();
  return null;
end;
$function$;

-- Trigger functions are not called by users (see 20261101000100).
revoke execute on function public.touch_conversation_on_message_change() from public, anon, authenticated;

drop trigger if exists trg_touch_conversation_on_message_change on public.messages;
create trigger trg_touch_conversation_on_message_change
  after update of body, deleted on public.messages
  for each row
  when (old.body is distinct from new.body or old.deleted is distinct from new.deleted)
  execute function public.touch_conversation_on_message_change();

commit;

-- Verify (read-only):
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.messages'::regclass and tgname like 'trg_touch%';
--   -- expect both trg_touch_conversation_on_message_insert and _change
