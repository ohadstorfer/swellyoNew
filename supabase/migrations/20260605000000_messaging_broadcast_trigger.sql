-- Messaging realtime: Broadcast from the database (Phase 0 of the postgres_changes -> Broadcast migration).
--
-- An AFTER trigger on public.messages broadcasts every change to two PRIVATE topics:
--   1. messages:{conversation_id}  -> full row, for whoever has that chat open
--   2. user-inbox:{member_id}      -> compact event, for each member's list/unread badges
--
-- This is INERT until clients subscribe to those topics. With no subscribers it just
-- inserts a few rows into realtime.messages (the broadcast store) per message — cheap,
-- and fully reversible (drop the trigger + function + policies).
--
-- SAFETY: SECURITY DEFINER with PINNED search_path + fully-qualified tables (per the
-- signup-trigger incident — unqualified tables in a SECURITY DEFINER trigger on a hot
-- write path can break inserts app-wide). Every realtime.send is wrapped so a broadcast
-- failure can NEVER abort the message insert.

create or replace function public.broadcast_message_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_conversation_id uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  v_event text := case TG_OP
                    when 'INSERT' then 'new_message'
                    when 'UPDATE' then 'update_message'
                    else 'delete_message' end;
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_member record;
begin
  -- 1) Full row to the open-chat topic
  begin
    perform realtime.send(
      jsonb_build_object('op', TG_OP, 'message', v_row),
      v_event,
      'messages:' || v_conversation_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_message_change conversation topic failed: %', sqlerrm;
  end;

  -- 2) Compact event to every member's inbox topic
  for v_member in
    select cm.user_id
    from public.conversation_members cm
    where cm.conversation_id = v_conversation_id
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'conversation_id', v_conversation_id,
          'message_id', coalesce(NEW.id, OLD.id),
          'op', TG_OP
        ),
        'inbox_change',
        'user-inbox:' || v_member.user_id::text,
        true   -- private channel
      );
    exception when others then
      raise warning 'broadcast_message_change inbox topic failed for %: %', v_member.user_id, sqlerrm;
    end;
  end loop;

  return null; -- AFTER trigger: return value ignored
end;
$$;

drop trigger if exists trg_broadcast_message_change on public.messages;
create trigger trg_broadcast_message_change
after insert or update or delete on public.messages
for each row execute function public.broadcast_message_change();

-- ---------------------------------------------------------------------------
-- Realtime Authorization: who may SUBSCRIBE to these private topics.
-- Evaluated ONCE per subscription (this is the whole point — no per-message,
-- per-client RLS re-evaluation like postgres_changes does).
-- ---------------------------------------------------------------------------

alter table realtime.messages enable row level security;

drop policy if exists "messaging: read conversation topic" on realtime.messages;
create policy "messaging: read conversation topic"
on realtime.messages for select to authenticated
using (
  (
    realtime.topic() like 'messages:%'
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
        and cm.user_id = auth.uid()
    )
  )
  or realtime.topic() = 'user-inbox:' || auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- ROLLBACK (run if you need to fully remove Phase 0):
--   drop trigger if exists trg_broadcast_message_change on public.messages;
--   drop function if exists public.broadcast_message_change();
--   drop policy if exists "messaging: read conversation topic" on realtime.messages;
-- ---------------------------------------------------------------------------
