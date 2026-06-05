-- Messaging Broadcast migration, follow-up: surface brand-new conversations.
--
-- The message trigger (20260605000000) only fires on `messages` INSERT, so in
-- 'broadcast' mode a conversation created with NO first message would not appear
-- in a member's list until a message arrives. In legacy/shadow mode this was
-- handled by a postgres_changes subscription on conversation_members INSERT
-- (subscribeToNewConversations). This trigger is the broadcast-mode equivalent:
-- on a new conversation_members row, broadcast an `inbox_change` to that member's
-- private inbox topic so the client fetches the new conversation by id.
--
-- Inert until clients subscribe to user-inbox:{id} (i.e. 'broadcast' mode only).
-- Same safety rules as the message trigger: SECURITY DEFINER, pinned search_path,
-- fully-qualified tables, and the broadcast wrapped so it can never block the insert.

create or replace function public.broadcast_new_member()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('conversation_id', NEW.conversation_id, 'op', 'member_added'),
      'inbox_change',
      'user-inbox:' || NEW.user_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_new_member failed for %: %', NEW.user_id, sqlerrm;
  end;
  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_broadcast_new_member on public.conversation_members;
create trigger trg_broadcast_new_member
after insert on public.conversation_members
for each row execute function public.broadcast_new_member();

-- ROLLBACK:
--   drop trigger if exists trg_broadcast_new_member on public.conversation_members;
--   drop function if exists public.broadcast_new_member();
