-- Realtime Authorization: allow conversation MEMBERS to SEND broadcasts on
-- their conversation topic (messages:{conversationId}).
--
-- Why this is needed
-- ------------------
-- In broadcast mode the per-conversation channel is PRIVATE
-- (messagingService.ts: supabase.channel(conversationTopic(id), { config:{ private:true }})).
-- Client-originated broadcasts — the TYPING indicator and the DM read-receipt
-- ("Seen") event — are sent with channel.send(), which writes a row into
-- realtime.messages and is therefore gated by RLS for INSERT.
--
-- The Phase-0 migration (20260605000000) only created a SELECT policy on
-- realtime.messages ("messaging: read conversation topic"), so clients can
-- RECEIVE the DB-trigger message broadcasts but cannot SEND their own. Result:
-- typing + read receipts are silently dropped in broadcast mode. The DB trigger
-- itself is unaffected because realtime.send() runs server-side and bypasses RLS.
--
-- Scope / safety
-- --------------
-- * INSERT is granted ONLY for the 'messages:%' topic and ONLY to a member of
--   that conversation (same membership check as the read policy).
-- * user-inbox:% is deliberately NOT writable by clients — those topics are
--   trigger-only (a client writing another user's inbox would be a spoof vector).
-- * This is strictly MORE restrictive than the old legacy mode, where the
--   per-conversation channel was PUBLIC (anyone could broadcast). Here only
--   members can.
-- ---------------------------------------------------------------------------

drop policy if exists "messaging: write conversation topic" on realtime.messages;
create policy "messaging: write conversation topic"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'messages:%'
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = nullif(split_part(realtime.topic(), ':', 2), '')::uuid
      and cm.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- VERIFY (after applying):
--   select policyname, cmd from pg_policies
--   where schemaname='realtime' and tablename='messages' order by cmd, policyname;
--   -- expect a new INSERT row: "messaging: write conversation topic"
--
-- ROLLBACK:
--   drop policy if exists "messaging: write conversation topic" on realtime.messages;
-- ---------------------------------------------------------------------------
