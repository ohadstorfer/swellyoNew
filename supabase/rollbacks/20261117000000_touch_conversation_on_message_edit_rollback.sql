-- Rollback for 20261117000000_touch_conversation_on_message_edit.sql
-- Edits and deletes stop moving conversations.updated_at again.

begin;

drop trigger if exists trg_touch_conversation_on_message_change on public.messages;
drop function if exists public.touch_conversation_on_message_change();

commit;
