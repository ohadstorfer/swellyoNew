-- Rollback for 20261101000000_fix_conversations_update_policy_recursion.sql
--
-- Puts the policy back to the live text from 2026-10-28 and drops the helper.
-- WARNING: this brings back the 42P17 recursion on every conversations UPDATE.

begin;

alter policy conversations_update_admin_or_creator on public.conversations
  using ((created_by = (select auth.uid())) or (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversations.id and cm.user_id = (select auth.uid())
      and cm.role = any (array['owner'::text, 'admin'::text])
      and cm.left_at is null)))
  with check ((created_by = (select auth.uid())) or (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversations.id and cm.user_id = (select auth.uid())
      and cm.role = any (array['owner'::text, 'admin'::text])
      and cm.left_at is null)));

drop function if exists public.is_conversation_admin(uuid);

commit;
