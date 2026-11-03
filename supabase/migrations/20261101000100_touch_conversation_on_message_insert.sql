-- Move the conversations.updated_at "touch" to the server.
--
-- Apply AFTER 20261101000000_fix_conversations_update_policy_recursion.sql,
-- and BEFORE the client that stops touching updated_at reaches anyone.
-- It does not depend on it, but that one is the fix for the 500s.
--
-- Why: today the app updates conversations.updated_at itself after a send
-- (messagingService.sendMessage and ~16 other spots). That can never work for
-- most senders, even once the recursion is fixed: the UPDATE policy only lets
-- the creator or an active owner/admin change the row. In prod every DM has
-- one 'owner' and one 'member', and trip chats are mostly 'member' rows. So
-- for the other side of every DM, and for every trip-chat traveler, the touch
-- updates 0 rows. And the app still uses updated_at:
--   - getConversations(): .order('updated_at').range(...) -> paging order
--   - delta sync: .gt('updated_at', lastSyncDate) -> a chat with new
--     messages but an old updated_at is skipped on reconnect
--
-- No trigger on messages moves updated_at today (checked live 2026-11-01:
-- only send-push-notification, trg_broadcast_message_change,
-- trg_on_message_insert_analytics). Only the surftrip joined/left banner
-- triggers touch it, for their own system messages.
--
-- now(), not new.created_at: a client can send created_at in its insert, and
-- a future value would pin the chat at the top of every list.
-- Upserts that hit on conflict do nothing insert no row, so they do not fire
-- this. conversations is in supabase_realtime and the app listens to it at
-- table scope (subscribeToConversations), so each message now emits one UPDATE
-- to every connected client. Fine at today's volume (1,330 messages in 30 days,
-- real peak 35/min), but the 2026-10-28 load test did NOT cover it: every touch
-- was failing then, so no such event was sent.

begin;

create or replace function public.touch_conversation_on_message_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id
     and updated_at < now();
  return null;
end;
$function$;

-- Trigger functions are not called by users. EXECUTE is checked only at
-- CREATE TRIGGER time (as the owner), not when the trigger fires.
revoke execute on function public.touch_conversation_on_message_insert() from public, anon, authenticated;

drop trigger if exists trg_touch_conversation_on_message_insert on public.messages;
create trigger trg_touch_conversation_on_message_insert
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message_insert();

-- Backfill: chats whose last message is newer than updated_at (about 80 rows
-- on 2026-11-01, going back to January: the chats whose last sender was not
-- allowed to touch the row even before the recursion).
update public.conversations c
   set updated_at = m.last_msg
  from (select conversation_id, max(created_at) as last_msg
          from public.messages
         where created_at <= now()
         group by conversation_id) m
 where m.conversation_id = c.id
   and m.last_msg > c.updated_at;

commit;

-- Verify:
--   select count(*) from public.conversations c
--   join (select conversation_id, max(created_at) last_msg from public.messages group by 1) m
--     on m.conversation_id = c.id
--   where m.last_msg > c.updated_at + interval '1 minute';
--   -- expect 0, and it should stay 0 after new messages
