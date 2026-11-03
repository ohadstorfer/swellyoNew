-- Rollback for 20261101000100_touch_conversation_on_message_insert.sql
--
-- The backfill is not undone: it only moved updated_at forward to the real
-- last-message time.

begin;

drop trigger if exists trg_touch_conversation_on_message_insert on public.messages;
drop function if exists public.touch_conversation_on_message_insert();

commit;
