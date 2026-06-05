-- Reactions realtime: Broadcast from the database (postgres_changes -> Broadcast migration for reactions).
--
-- An AFTER trigger on public.message_reactions resolves the parent message's
-- conversation_id and broadcasts a compact event to the PRIVATE topic:
--   reactions:{conversation_id}  -> { op, message_id }, for whoever has that chat open
--
-- The client refetches that message's reactions on receipt (idempotent), so we
-- never ship reaction rows over the wire.
--
-- This is INERT until clients subscribe to reactions:%. With no subscribers it
-- just inserts a row into realtime.messages (the broadcast store) per reaction
-- change — cheap, and fully reversible (drop the trigger + function + policy).
--
-- Replaces the UNFILTERED postgres_changes subscription in useMessageReactions,
-- where every client with a chat open received every reaction change DB-wide and
-- discarded almost all of it client-side.
--
-- SAFETY: SECURITY DEFINER with PINNED search_path + fully-qualified tables (per
-- the signup-trigger incident). The realtime.send is wrapped so a broadcast
-- failure can NEVER abort the reaction insert/delete.

create or replace function public.broadcast_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_message_id uuid := coalesce(NEW.message_id, OLD.message_id);
  v_conversation_id uuid;
begin
  select m.conversation_id into v_conversation_id
  from public.messages m
  where m.id = v_message_id;

  -- Parent message gone (e.g. message deleted -> reactions cascade): the
  -- message-delete broadcast already removes the message and its reactions on
  -- the client, so there's nothing to refresh. Skip.
  if v_conversation_id is null then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('op', TG_OP, 'message_id', v_message_id),
      'reaction_changed',
      'reactions:' || v_conversation_id::text,
      true   -- private channel
    );
  exception when others then
    raise warning 'broadcast_reaction_change failed for message %: %', v_message_id, sqlerrm;
  end;

  return null; -- AFTER trigger: return value ignored
end;
$$;

drop trigger if exists trg_broadcast_reaction_change on public.message_reactions;
create trigger trg_broadcast_reaction_change
after insert or update or delete on public.message_reactions
for each row execute function public.broadcast_reaction_change();

-- This is a trigger-only function; nobody should call it as an RPC. Revoke the
-- default PUBLIC execute so it isn't exposed via PostgREST (/rest/v1/rpc/...).
-- Silences the security advisor 0027/0028 (SECURITY DEFINER function executable
-- by anon/authenticated). The same hardening should be applied to
-- public.broadcast_message_change() if not already done.
revoke execute on function public.broadcast_reaction_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime Authorization: who may SUBSCRIBE to reactions:{conversation_id}.
-- Evaluated ONCE per subscription (no per-row, per-client re-evaluation like
-- postgres_changes). Same membership check as the messages topic.
--
-- realtime.messages RLS is already enabled by 20260605000000_messaging_broadcast_trigger;
-- the enable below is idempotent and keeps this migration self-sufficient if the
-- messaging migration hasn't been applied yet.
-- ---------------------------------------------------------------------------

alter table realtime.messages enable row level security;

drop policy if exists "reactions: read conversation topic" on realtime.messages;
create policy "reactions: read conversation topic"
on realtime.messages for select to authenticated
using (
  realtime.topic() like 'reactions:%'
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
      and cm.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- ROLLBACK (run if you need to fully remove this):
--   drop trigger if exists trg_broadcast_reaction_change on public.message_reactions;
--   drop function if exists public.broadcast_reaction_change();
--   drop policy if exists "reactions: read conversation topic" on realtime.messages;
-- ---------------------------------------------------------------------------
